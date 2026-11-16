const BudgetModel = require("../../models/BudgetModel");
const BudgetUtilizationModel = require("../../models/BudgetUtilizationModel");
const ExpenseModel = require("../../models/ExpenseModel");
const events = require("../../infrastructure/events/event-bus");
const EVENTS = require("../../infrastructure/events/event-names");
const { mapWithConcurrency } = require("../../infrastructure/work-queue");
const { startOfUtcDay, startOfUtcMonth } = require("../summaries/summaries.service");
const logger = require("../../infrastructure/logger");

/**
 * Budget monitoring.
 *
 * Utilization is always derived from expense records, never from a cached
 * total, and the snapshot it stores is only a read optimisation.
 *
 * Period handling: budgets may or may not define dates. A dated budget uses
 * exactly its window; an undated budget is treated as the current UTC calendar
 * month. That is an explicit interpretation (documented) rather than an
 * assumption about a user's timezone, which the data model does not store.
 */

const THRESHOLDS = String(process.env.BUDGET_ALERT_THRESHOLDS || "50,75,90,100")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0 && value <= 1000)
  .sort((a, b) => a - b);

const BATCH_SIZE = 100;
const CONCURRENCY = 5;
const EXPIRED_LOOKBACK_DAYS = 7;

const endOfUtcMonth = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1);

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);

const resolveBudgetPeriod = (budget, now) => {
  const start = budget.start_date
    ? new Date(budget.start_date)
    : startOfUtcMonth(now);
  const end = budget.end_date ? new Date(budget.end_date) : endOfUtcMonth(now);

  return { start, end };
};

const getSpent = async ({ userID, categoryID, start, end }) => {
  const [result] = await ExpenseModel.aggregate([
    {
      $match: {
        userID,
        categoryID,
        date: { $gte: start, $lte: end },
      },
    },
    { $group: { _id: null, spent: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);

  return { spent: result?.spent || 0, count: result?.count || 0 };
};

const evaluateBudget = async (budget, now) => {
  const { start, end } = resolveBudgetPeriod(budget, now);
  const { spent, count } = await getSpent({
    userID: budget.userID,
    categoryID: budget.categoryID,
    start,
    end,
  });

  const limit = Number(budget.amount) || 0;
  const utilization = limit > 0 ? spent / limit : 0;
  const percent = Math.round(utilization * 1000) / 10;
  const highestThresholdReached = THRESHOLDS.filter(
    (threshold) => percent >= threshold,
  ).pop();

  await BudgetUtilizationModel.updateOne(
    { budgetID: budget._id, periodStart: start },
    {
      $set: {
        userID: budget.userID,
        categoryID: budget.categoryID,
        periodEnd: end,
        limit,
        spent,
        utilization: Math.round(utilization * 10000) / 10000,
        highestThresholdReached: highestThresholdReached || 0,
        computedAt: new Date(),
      },
    },
    { upsert: true },
  );

  // Only the highest crossed band raises an alert. Notifying 50/75/90/100 for
  // one large purchase would be noise; the notification still states the real
  // utilization, so no information is lost.
  if (highestThresholdReached) {
    await events.emit(
      EVENTS.BUDGET_THRESHOLD_REACHED,
      {
        userId: String(budget.userID),
        budgetId: String(budget._id),
        categoryID: budget.categoryID ? String(budget.categoryID) : null,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        limit,
        spent,
        utilizationPercent: percent,
        threshold: highestThresholdReached,
        transactionCount: count,
      },
      { dedupeKey: `budget_threshold:${budget._id}:${dateKey(start)}:${highestThresholdReached}` },
    );
  }

  return { spent, utilizationPercent: percent, highestThresholdReached: highestThresholdReached || 0 };
};

const scanActiveBudgets = async (now, startedAt) => {
  let lastId = null;
  let processed = 0;
  let evaluated = 0;
  const failures = [];

  for (;;) {
    const filter = {
      $or: [
        { end_date: { $exists: false } },
        { end_date: null },
        { end_date: { $gte: startOfUtcDay(now) } },
      ],
    };

    if (lastId) {
      filter._id = { $gt: lastId };
    }
    const batch = await BudgetModel.find(filter)
      .select("_id userID categoryID amount start_date end_date")
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .lean();

    if (batch.length === 0) {
      break;
    }

    lastId = batch[batch.length - 1]._id;
    processed += batch.length;
    const outcome = await mapWithConcurrency(batch, CONCURRENCY, async (budget) => {
      const result = await evaluateBudget(budget, now);

      if (result.highestThresholdReached) {
        evaluated += 1;
      }

      return result;
    });

    for (const failure of outcome.failures) {
      failures.push({ message: failure.error?.message });
      logger.error("budget.evaluation_failed", { error: failure.error });
    }

    if (batch.length < BATCH_SIZE) {
      break;
    }
  }

  return { processed, thresholdCrossings: evaluated, failures, durationMs: Date.now() - startedAt };
};

const notifyExpiredBudgets = async (now) => {
  const since = new Date(now.getTime() - EXPIRED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const expired = await BudgetModel.find({
    end_date: { $gte: since, $lt: now },
  })
    .select("_id userID categoryID amount end_date")
    .limit(BATCH_SIZE)
    .lean();

  for (const budget of expired) {
    await events.emit(
      EVENTS.BUDGET_PERIOD_ENDED,
      {
        userId: String(budget.userID),
        budgetId: String(budget._id),
        categoryID: budget.categoryID ? String(budget.categoryID) : null,
        limit: Number(budget.amount) || 0,
        periodEnd: new Date(budget.end_date).toISOString(),
      },
      { dedupeKey: `budget_ended:${budget._id}:${dateKey(budget.end_date)}` },
    );
  }

  return expired.length;
};

/**
 * Scheduled entry point.
 */
const runBudgetMonitor = async ({ now = new Date() } = {}) => {
  const startedAt = Date.now();
  const active = await scanActiveBudgets(now, startedAt);
  const expiredNotified = await notifyExpiredBudgets(now);

  return {
    budgetsProcessed: active.processed,
    thresholdCrossings: active.thresholdCrossings,
    expiredNotified,
    failures: active.failures.length,
    durationMs: Date.now() - startedAt,
  };
};

module.exports = {
  THRESHOLDS,
  resolveBudgetPeriod,
  evaluateBudget,
  runBudgetMonitor,
};
