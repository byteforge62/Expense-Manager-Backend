const notificationService = require("./notification.service");
const events = require("../../infrastructure/events/event-bus");
const EVENTS = require("../../infrastructure/events/event-names");
const logger = require("../../infrastructure/logger");

/**
 * Maps domain events to in-app notifications.
 *
 * Dedupe keys are derived from the identity of the underlying condition (bill,
 * budget period, recurring occurrence) so replayed events and repeated job runs
 * never duplicate an alert for an unchanged situation.
 */

const budgetPriority = (percent) => {
  if (percent >= 100) return "critical";
  if (percent >= 90) return "high";
  if (percent >= 75) return "medium";
  return "low";
};

const handleBudgetThreshold = async (payload) => {
  const percent = Number(payload.utilizationPercent) || 0;

  await notificationService.createNotification({
    userID: payload.userId,
    type: "budget.threshold_reached",
    category: "budget",
    priority: budgetPriority(percent),
    title:
      percent >= 100
        ? "Budget exceeded"
        : `Budget ${payload.threshold}%+ used`,
    message:
      percent >= 100
        ? `You have spent ${percent}% of this budget for the current period.`
        : `You have used ${percent}% of this budget for the current period.`,
    data: {
      budgetId: payload.budgetId,
      threshold: payload.threshold,
      utilizationPercent: percent,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
    },
    dedupeKey: `budget_threshold:${payload.budgetId}:${String(payload.periodStart).slice(0, 10)}:${payload.threshold}`,
  });
};

const handleBudgetPeriodEnded = async (payload) => {
  await notificationService.createNotification({
    userID: payload.userId,
    type: "budget.period_ended",
    category: "budget",
    priority: "low",
    title: "Budget period ended",
    message:
      "A budget period has ended. Review the outcome and set a new budget if you want to keep tracking this category.",
    data: { budgetId: payload.budgetId, periodEnd: payload.periodEnd },
    dedupeKey: `budget_ended:${payload.budgetId}:${String(payload.periodEnd).slice(0, 10)}`,
  });
};

const handleBillDueSoon = async (payload) => {
  const days = Number(payload.daysUntilDue) || 0;

  await notificationService.createNotification({
    userID: payload.userId,
    type: "bill.due_soon",
    category: "bill",
    priority: days <= 1 ? "high" : "medium",
    title: days <= 0 ? "Bill due today" : `Bill due in ${days} day(s)`,
    message: `A bill is due on ${String(payload.dueDate).slice(0, 10)}. It is not marked paid automatically.`,
    data: {
      billId: payload.billId,
      dueDate: payload.dueDate,
      daysUntilDue: days,
    },
    dedupeKey: `bill_due_soon:${payload.billId}:${String(payload.dueDate).slice(0, 10)}`,
  });
};

const handleBillOverdue = async (payload) => {
  await notificationService.createNotification({
    userID: payload.userId,
    type: "bill.overdue",
    category: "bill",
    priority: "high",
    title: "Bill overdue",
    message: `A bill has passed its due date and is still marked pending. Settle it or update it manually.`,
    data: {
      billId: payload.billId,
      dueDate: payload.dueDate,
      daysOverdue: payload.daysOverdue,
    },
    dedupeKey: `bill_overdue:${payload.billId}`,
  });
};

const handleBillSettled = async (payload) => {
  await notificationService.createNotification({
    userID: payload.userId,
    type: "bill.settled",
    category: "bill",
    priority: "low",
    title: "Bill settled",
    message: "A bill was linked to an expense and marked as paid.",
    data: { billId: payload.billId, expenseId: payload.expenseId },
    dedupeKey: `bill_settled:${payload.billId}`,
  });
};

const handleRecurringProcessed = async (payload) => {
  await notificationService.createNotification({
    userID: payload.userId,
    type: "recurring.executed",
    category: "recurring",
    priority: "low",
    title: "Recurring transaction recorded",
    message: `A scheduled recurring ${payload.type === "INCOME" ? "income" : "expense"} was recorded for ${String(payload.occurrenceDate).slice(0, 10)}.`,
    data: {
      recurringId: payload.recurringId,
      occurrenceDate: payload.occurrenceDate,
      transactionId: payload.transactionId,
    },
    dedupeKey: `recurring_processed:${payload.recurringId}:${String(payload.occurrenceDate).slice(0, 10)}`,
  });
};

const handleRecurringFailed = async (payload) => {
  if (!payload.userId) {
    return;
  }

  await notificationService.createNotification({
    userID: payload.userId,
    type: "recurring.failed",
    category: "recurring",
    priority: "high",
    title: "Recurring transaction could not be created",
    message:
      "A scheduled recurring transaction could not be recorded. Check that its category still exists and that the schedule is still valid.",
    data: { recurringId: payload.recurringId, message: payload.message },
    dedupeKey: `recurring_failed:${payload.recurringId}:${String(payload.at).slice(0, 10)}`,
  });
};

const register = () => {
  events.register(EVENTS.BUDGET_THRESHOLD_REACHED, handleBudgetThreshold, {
    id: "notifications:budget.threshold_reached",
  });
  events.register(EVENTS.BUDGET_PERIOD_ENDED, handleBudgetPeriodEnded, {
    id: "notifications:budget.period_ended",
  });
  events.register(EVENTS.BILL_DUE_SOON, handleBillDueSoon, {
    id: "notifications:bill.due_soon",
  });
  events.register(EVENTS.BILL_OVERDUE, handleBillOverdue, {
    id: "notifications:bill.overdue",
  });
  events.register(EVENTS.BILL_SETTLED, handleBillSettled, {
    id: "notifications:bill.settled",
  });
  events.register(EVENTS.RECURRING_TRANSACTION_PROCESSED, handleRecurringProcessed, {
    id: "notifications:recurring.processed",
  });
  events.register(EVENTS.RECURRING_TRANSACTION_FAILED, handleRecurringFailed, {
    id: "notifications:recurring.failed",
  });
};

module.exports = {
  register,
  handleBudgetThreshold,
  handleBillDueSoon,
  handleBillOverdue,
  handleRecurringProcessed,
  logger,
};
