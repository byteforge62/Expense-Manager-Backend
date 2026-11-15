/**
 * Canonical internal event names.
 *
 * Events are facts about something that already happened. Consumers must
 * tolerate duplicate delivery (at-least-once), so every handler is written to
 * be idempotent.
 */
const EVENTS = Object.freeze({
  EXPENSE_CREATED: "expense.created",
  EXPENSE_UPDATED: "expense.updated",
  EXPENSE_DELETED: "expense.deleted",
  INCOME_CREATED: "income.created",
  INCOME_DELETED: "income.deleted",
  BUDGET_THRESHOLD_REACHED: "budget.threshold_reached",
  BUDGET_PERIOD_ENDED: "budget.period_ended",
  BILL_DUE_SOON: "bill.due_soon",
  BILL_OVERDUE: "bill.overdue",
  BILL_SETTLED: "bill.settled",
  RECURRING_TRANSACTION_PROCESSED: "recurring_transaction.processed",
  RECURRING_TRANSACTION_FAILED: "recurring_transaction.failed",
  FINANCIAL_SUMMARY_UPDATED: "financial_summary.updated",
  FINANCIAL_INTELLIGENCE_GENERATED: "financial_intelligence.generated",
  NOTIFICATION_CREATED: "notification.created",
});

module.exports = EVENTS;
