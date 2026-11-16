const { mapWithConcurrency } = require("../../infrastructure/work-queue");

const mongoose = require("mongoose");
const FinancialSummaryModel = require("../../models/FinancialSummaryModel");
const { CategorySummaryModel } = require("../../models/FinancialSummaryModel");
const ExpenseModel = require("../../models/ExpenseModel");
const IncomeModel = require("../../models/IncomeModel");
const logger = require("../../infrastructure/logger");

/**
 * Derived financial summaries.
 *
 * Maintained incrementally by event consumers ($inc upserts, atomic per
 * document) and rebuildable from the authoritative collections at any time.
 * Reads of summaries are always labelled as derived; anything that must be
 * exact (reports, analytics) queries the transaction collections directly.
 */

const PERIOD_TYPES = ["daily", "monthly"];

const startOfUtcDay = (date) => {
  const value = new Date(date);
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
};

const startOfUtcMonth = (date) => {
  const value = new Date(date);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
};

const periodStartFor = (periodType, date) =>
  periodType === "monthly" ? startOfUtcMonth(date) : startOfUtcDay(date);

const isValidAmount = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

/**
 * Applies one authoritative change to every maintained period bucket.
 *
 * `kind`: "expense" | "income"; `direction`: 1 for create, -1 for delete.
 * Update payloads and reversal payloads are exact opposites, so a
 * create+delete pair nets to zero even if they arrive out of order.
 */
const applyDelta = async ({
  userID,
  kind,
  amount,
  categoryID,
  date,
  direction = 1,
}) => {
  if (!userID || !["expense", "income"].includes(kind) || !isValidAmount(amount)) {
    throw new TypeError("A valid userID, kind and positive amount are required");
  }

  const occurredAt = date ? new Date(date) : new Date();

  if (Number.isNaN(occurredAt.getTime())) {
    throw new TypeError("A valid transaction date is required");
  }

  const signed = Number(amount) * (direction >= 0 ? 1 : -1);
  const isExpense = kind === "expense";

  const operations = [];

  for (const periodType of PERIOD_TYPES) {
    const periodStart = periodStartFor(periodType, occurredAt);
    const summaryFilter = { userID, periodType, periodStart };

    operations.push({
      updateOne: {
        filter: summaryFilter,
        update: {
          $inc: isExpense
            ? { totalExpense: signed, expenseCount: direction, net: -signed }
            : { totalIncome: signed, incomeCount: direction, net: signed },
          $setOnInsert: { userID, periodType, periodStart },
        },
        upsert: true,
      },
    });

    // Category breakdown only exists for expenses: income records have no
    // category in the current data model.
    if (isExpense && categoryID) {
      operations.push({
        updateOne: {
          filter: { userID, periodType, periodStart, categoryID },
          update: {
            $inc: { amount: signed, count: direction },
            $setOnInsert: { userID, periodType, periodStart, categoryID },
          },
          upsert: true,
        },
      });
    }
  }

  await FinancialSummaryModel.bulkWrite(
    operations.filter((op) => op.updateOne.filter.categoryID === undefined),
    { ordered: false },
  );

  const categoryOps = operations.filter(
    (op) => op.updateOne.filter.categoryID !== undefined,
  );

  if (categoryOps.length > 0) {
    await CategorySummaryModel.bulkWrite(categoryOps, { ordered: false });
  }

  return { periodsUpdated: PERIOD_TYPES.length };
};

const buildDateWindow = (from, to) => {
  const end = to ? new Date(to) : new Date();
  const start = from
    ? new Date(from)
    : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new TypeError("A valid date range is required");
  }

  if (start > end) {
    throw new TypeError("`from` must be before or equal to `to`");
  }

  return { start, end };
};

const getSummaries = async (userID, { periodType, from, to, limit = 31 }) => {
  const { start, end } = buildDateWindow(from, to);

  const summaries = await FinancialSummaryModel.find({
    userID,
    periodType,
    periodStart: { $gte: periodStartFor(periodType, start), $lte: end },
  })
    .select("-userID -__v")
    .sort({ periodStart: -1 })
    .limit(limit)
    .lean();

  return summaries;
};

const getCategoryBreakdown = async (userID, { periodType, from, to }) => {
  const { start } = buildDateWindow(from, to);

  return CategorySummaryModel.find({
    userID,
    periodType,
    periodStart: start,
  })
    .select("-userID -__v")
    .sort({ amount: -1 })
    .lean();
};

const formatFor = (periodType) => (periodType === "monthly" ? "%Y-%m" : "%Y-%m-%d");

const aggregatePeriods = async (Model, userID, from, to, periodType, withCategory) => {
  const groupId = {
    period: {
      $dateToString: { format: formatFor(periodType), date: "$date", timezone: "UTC" },
    },
  };

  if (withCategory) {
    groupId.categoryID = "$categoryID";
  }

  // Aggregations bypass Mongoose casting, so the id is converted explicitly.
  // A string here would silently match nothing.
  const userObjectId = new mongoose.Types.ObjectId(String(userID));

  return Model.aggregate([
    { $match: { userID: userObjectId, date: { $gte: from, $lte: to } } },
    { $group: { _id: groupId, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
};

const periodKeyToDate = (periodType, key) => {
  if (periodType === "monthly") {
    const [year, month] = key.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, 1));
  }

  return new Date(`${key}T00:00:00.000Z`);
};

/**
 * Rebuilds summaries for a user and range from authoritative records.
 *
 * Idempotent: upserts every recomputed bucket, then prunes buckets that no
 * longer have transactions. Safe to run concurrently with incremental updates
 * because it writes the authoritative totals for the covered range.
 */
const rebuildSummaries = async ({ userID, from, to }) => {
  const { start, end } = buildDateWindow(from, to);
  const startedAt = Date.now();

  const results = {};

  for (const periodType of PERIOD_TYPES) {
    const [expenses, incomes, categoryTotals] = await Promise.all([
      aggregatePeriods(ExpenseModel, userID, start, end, periodType, false),
      aggregatePeriods(IncomeModel, userID, start, end, periodType, false),
      aggregatePeriods(ExpenseModel, userID, start, end, periodType, true),
    ]);

    const buckets = new Map();

    const ensure = (key) => {
      if (!buckets.has(key)) {
        buckets.set(key, {
          totalIncome: 0,
          totalExpense: 0,
          incomeCount: 0,
          expenseCount: 0,
        });
      }

      return buckets.get(key);
    };

    for (const row of expenses) {
      const bucket = ensure(row._id.period);
      bucket.totalExpense += row.amount;
      bucket.expenseCount += row.count;
    }

    for (const row of incomes) {
      const bucket = ensure(row._id.period);
      bucket.totalIncome += row.amount;
      bucket.incomeCount += row.count;
    }

    const periodStarts = [];

    const summaryOps = [];

    for (const [key, bucket] of buckets) {
      const periodStart = periodKeyToDate(periodType, key);
      periodStarts.push(periodStart);

      summaryOps.push({
        updateOne: {
          filter: { userID, periodType, periodStart },
          update: {
            $set: {
              ...bucket,
              net: bucket.totalIncome - bucket.totalExpense,
              rebuiltAt: new Date(),
            },
            $setOnInsert: { userID, periodType, periodStart, version: 1 },
          },
          upsert: true,
        },
      });
    }

    if (summaryOps.length > 0) {
      await FinancialSummaryModel.bulkWrite(summaryOps, { ordered: false });
    }

    await FinancialSummaryModel.deleteMany({
      userID,
      periodType,
      periodStart: { $gte: start, $lte: end, $nin: periodStarts },
    });

    // Category breakdown: replace the recomputed buckets wholesale.
    const categoryPeriodStarts = [
      ...new Set(categoryTotals.map((row) => row._id.period)),
    ].map((key) => periodKeyToDate(periodType, key));

    await CategorySummaryModel.deleteMany({
      userID,
      periodType,
      periodStart: { $gte: start, $lte: end },
    });

    if (categoryTotals.length > 0) {
      await CategorySummaryModel.insertMany(
        categoryTotals.map((row) => ({
          userID,
          periodType,
          periodStart: periodKeyToDate(periodType, row._id.period),
          categoryID: row._id.categoryID,
          amount: row.amount,
          count: row.count,
        })),
        { ordered: false },
      );
    }

    results[periodType] = {
      periods: buckets.size,
      categoryPeriods: categoryPeriodStarts.length,
    };
  }

  logger.info("summaries.rebuilt", {
    userID: String(userID),
    durationMs: Date.now() - startedAt,
    results,
  });

  return results;
};

/**
 * Rebuilds a user's summaries from the beginning of their first record.
 * Used for manual repair and after schema/index changes.
 */
const rebuildAllForUser = async (userID) => {
  const [oldestExpense, oldestIncome] = await Promise.all([
    ExpenseModel.findOne({ userID }).select("date").sort({ date: 1 }).lean(),
    IncomeModel.findOne({ userID }).select("date").sort({ date: 1 }).lean(),
  ]);

  const candidates = [oldestExpense?.date, oldestIncome?.date].filter(Boolean);

  const from = candidates.length
    ? new Date(Math.min(...candidates.map((date) => new Date(date).getTime())))
    : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  return rebuildSummaries({ userID, from, to: new Date() });
};

// --- Reconciliation ---

const RECONCILE_LOOKBACK_DAYS = Number(process.env.SUMMARY_RECONCILE_LOOKBACK_DAYS) || 2;
const RECONCILE_CONCURRENCY = 3;
const RECONCILE_MAX_USERS = Number(process.env.SUMMARY_RECONCILE_MAX_USERS) || 200;

/**
 * Reconciliation keeps derived summaries trustworthy.
 *
 * Incremental updates are fast but can drift (a lost consumer run, a manual
 * database edit, an unresolved partial failure). This job rebuilds the
 * affected windows from authoritative records for users with recent activity.
 * A full rebuild for every user is deliberately not scheduled; it is available
 * on demand through `rebuildAllForUser`.
 */
const runSummaryReconciliation = async ({ now = new Date() } = {}) => {
  const startedAt = Date.now();
  const from = new Date(
    now.getTime() - RECONCILE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );

  const [expenseUsers, incomeUsers] = await Promise.all([
    ExpenseModel.distinct("userID", { updatedAt: { $gte: from } }),
    IncomeModel.distinct("userID", { updatedAt: { $gte: from } }),
  ]);

  const userIds = [...new Set([...expenseUsers, ...incomeUsers].map(String))].slice(
    0,
    RECONCILE_MAX_USERS,
  );

  if (userIds.length === 0) {
    return { usersReconciled: 0, failures: 0, durationMs: Date.now() - startedAt };
  }

  const outcome = await mapWithConcurrency(
    userIds,
    RECONCILE_CONCURRENCY,
    (userID) => rebuildSummaries({ userID, from, to: now }),
  );

  for (const failure of outcome.failures) {
    logger.error("summaries.reconcile_failed", { error: failure.error });
  }

  return {
    usersReconciled: outcome.succeeded,
    failures: outcome.failures.length,
    durationMs: Date.now() - startedAt,
  };
};

module.exports = {
  PERIOD_TYPES,
  startOfUtcDay,
  startOfUtcMonth,
  periodStartFor,
  applyDelta,
  getSummaries,
  getCategoryBreakdown,
  rebuildSummaries,
  rebuildAllForUser,
  runSummaryReconciliation,
};
