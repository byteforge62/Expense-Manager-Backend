const BillModel = require("../../models/BillModel");
const events = require("../../infrastructure/events/event-bus");
const EVENTS = require("../../infrastructure/events/event-names");
const { startOfUtcDay } = require("../summaries/summaries.service");
const logger = require("../../infrastructure/logger");

/**
 * Automatic bill reminders.
 *
 * Explicit non-goal: a passed due date never marks a bill paid and never
 * creates an expense. Settlement stays a user action (`PATCH /bill/:id/settle`),
 * which is what keeps the ledger truthful.
 *
 * Idempotency:
 * - due-soon alerts are keyed by bill + due date, so each bill occurrence
 *   alerts at most once;
 * - overdue alerts are keyed by bill only, so an unchanged overdue bill does
 *   not generate a new notification every day.
 */

const REMINDER_DAYS = Number(process.env.BILL_REMINDER_DAYS) || 3;
const BATCH_SIZE = 200;
const MAX_BATCHES = 25;

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);

const daysBetween = (from, to) =>
  Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / 86_400_000);

const findPendingBills = async ({ from, to, afterId, limit = BATCH_SIZE }) => {
  const filter = {
    status: "pending",
    dueDate: { $gte: from, $lte: to },
  };

  if (afterId) {
    filter._id = { $gt: afterId };
  }

  return BillModel.find(filter)
    .select("_id userID name amount dueDate")
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
};

const emitDueSoon = async (bill, now) => {
  const dueDate = new Date(bill.dueDate);
  const daysUntilDue = daysBetween(now, dueDate);

  await events.emit(
    EVENTS.BILL_DUE_SOON,
    {
      userId: String(bill.userID),
      billId: String(bill._id),
      name: bill.name,
      amount: Number(bill.amount) || 0,
      dueDate: dueDate.toISOString(),
      daysUntilDue,
    },
    { dedupeKey: `bill_due_soon:${bill._id}:${dateKey(dueDate)}` },
  );
};

const emitOverdue = async (bill, now) => {
  const dueDate = new Date(bill.dueDate);
  const daysOverdue = Math.max(0, daysBetween(dueDate, now));

  await events.emit(
    EVENTS.BILL_OVERDUE,
    {
      userId: String(bill.userID),
      billId: String(bill._id),
      name: bill.name,
      amount: Number(bill.amount) || 0,
      dueDate: dueDate.toISOString(),
      daysOverdue,
    },
    { dedupeKey: `bill_overdue:${bill._id}` },
  );
};

const runBillReminders = async ({ now = new Date() } = {}) => {
  const startedAt = Date.now();
  const todayStart = startOfUtcDay(now);
  const horizon = new Date(todayStart.getTime() + REMINDER_DAYS * 86_400_000 + 86_399_999);

  let dueSoon = 0;
  let overdue = 0;
  let failures = 0;
  let lastId = null;

  // Due soon (today .. horizon).
  for (let batchIndex = 0; batchIndex < MAX_BATCHES; batchIndex += 1) {
    const batch = await findPendingBills({ from: todayStart, to: horizon, afterId: lastId });

    if (batch.length === 0) {
      break;
    }

    lastId = batch[batch.length - 1]._id;

    for (const bill of batch) {
      try {
        await emitDueSoon(bill, now);
        dueSoon += 1;
      } catch (error) {
        failures += 1;
        logger.error("bill.due_soon_failed", { billId: String(bill._id), error });
      }
    }

    if (batch.length < BATCH_SIZE) {
      break;
    }
  }

  // Overdue (anything strictly before today).
  lastId = null;

  for (let batchIndex = 0; batchIndex < MAX_BATCHES; batchIndex += 1) {
    const batch = await findPendingBills({
      from: new Date(0),
      to: new Date(todayStart.getTime() - 1),
      afterId: lastId,
    });

    if (batch.length === 0) {
      break;
    }

    lastId = batch[batch.length - 1]._id;

    for (const bill of batch) {
      try {
        await emitOverdue(bill, now);
        overdue += 1;
      } catch (error) {
        failures += 1;
        logger.error("bill.overdue_failed", { billId: String(bill._id), error });
      }
    }

    if (batch.length < BATCH_SIZE) {
      break;
    }
  }

  return {
    dueSoonDetected: dueSoon,
    overdueDetected: overdue,
    failures,
    durationMs: Date.now() - startedAt,
  };
};

module.exports = {
  REMINDER_DAYS,
  runBillReminders,
};
