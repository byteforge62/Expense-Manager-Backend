const summaries = require("./summaries.service");
const { runOnce } = require("../../infrastructure/events/idempotent");
const events = require("../../infrastructure/events/event-bus");
const EVENTS = require("../../infrastructure/events/event-names");
const logger = require("../../infrastructure/logger");

/**
 * Summary consumers.
 *
 * A create applies +delta, a delete applies -delta, and an update applies
 * -before +after. Every consumer is wrapped in the processed-event ledger, so
 * an at-least-once redelivery cannot double count.
 */

const CONSUMER = "financial-summaries";

const publishSummaryUpdate = async (userID, reason) => {
  if (!userID) {
    return;
  }

  await events.emit(
    EVENTS.FINANCIAL_SUMMARY_UPDATED,
    { userId: String(userID), reason, at: new Date().toISOString() },
    { source: "consumer" },
  );
};

const handleExpenseCreated = async (payload, context) => {
  await runOnce(CONSUMER, context.eventId, async () => {
    await summaries.applyDelta({
      userID: payload.userId,
      kind: "expense",
      amount: payload.amount,
      categoryID: payload.categoryID,
      date: payload.date,
      direction: 1,
    });
  });

  await publishSummaryUpdate(payload.userId, "expense.created");
};

const handleExpenseDeleted = async (payload, context) => {
  await runOnce(CONSUMER, context.eventId, async () => {
    await summaries.applyDelta({
      userID: payload.userId,
      kind: "expense",
      amount: payload.amount,
      categoryID: payload.categoryID,
      date: payload.date,
      direction: -1,
    });
  });

  await publishSummaryUpdate(payload.userId, "expense.deleted");
};

const handleExpenseUpdated = async (payload, context) => {
  await runOnce(CONSUMER, context.eventId, async () => {
    const before = payload.before || {};
    const after = payload.after || {};

    // Reversal then re-application. Same-bucket updates net to zero, and the
    // processed-event ledger keeps the whole pair idempotent.
    if (before.amount && before.categoryID) {
      await summaries.applyDelta({
        userID: payload.userId,
        kind: "expense",
        amount: before.amount,
        categoryID: before.categoryID,
        date: before.date,
        direction: -1,
      });
    }

    if (after.amount && after.categoryID) {
      await summaries.applyDelta({
        userID: payload.userId,
        kind: "expense",
        amount: after.amount,
        categoryID: after.categoryID,
        date: after.date || before.date,
        direction: 1,
      });
    }
  });

  await publishSummaryUpdate(payload.userId, "expense.updated");
};

const handleIncomeCreated = async (payload, context) => {
  await runOnce(CONSUMER, context.eventId, async () => {
    await summaries.applyDelta({
      userID: payload.userId,
      kind: "income",
      amount: payload.amount,
      date: payload.date,
      direction: 1,
    });
  });

  await publishSummaryUpdate(payload.userId, "income.created");
};

const handleIncomeDeleted = async (payload, context) => {
  await runOnce(CONSUMER, context.eventId, async () => {
    await summaries.applyDelta({
      userID: payload.userId,
      kind: "income",
      amount: payload.amount,
      date: payload.date,
      direction: -1,
    });
  });

  await publishSummaryUpdate(payload.userId, "income.deleted");
};

/**
 * Recurring occurrences are written by the engine, not through the HTTP
 * service, so they are only reflected in summaries through this event.
 */
const handleRecurringProcessed = async (payload, context) => {
  await runOnce(CONSUMER, context.eventId, async () => {
    const kind = payload.type === "INCOME" ? "income" : "expense";

    await summaries.applyDelta({
      userID: payload.userId,
      kind,
      amount: payload.amount,
      categoryID: payload.categoryID,
      date: payload.occurrenceDate,
      direction: 1,
    });
  });

  await publishSummaryUpdate(payload.userId, "recurring_transaction.processed");
};

const register = () => {
  events.register(EVENTS.EXPENSE_CREATED, handleExpenseCreated, { id: `${CONSUMER}:expense.created` });
  events.register(EVENTS.EXPENSE_DELETED, handleExpenseDeleted, { id: `${CONSUMER}:expense.deleted` });
  events.register(EVENTS.EXPENSE_UPDATED, handleExpenseUpdated, { id: `${CONSUMER}:expense.updated` });
  events.register(EVENTS.INCOME_CREATED, handleIncomeCreated, { id: `${CONSUMER}:income.created` });
  events.register(EVENTS.INCOME_DELETED, handleIncomeDeleted, { id: `${CONSUMER}:income.deleted` });
  events.register(
    EVENTS.RECURRING_TRANSACTION_PROCESSED,
    handleRecurringProcessed,
    { id: `${CONSUMER}:recurring.processed` },
  );
};

module.exports = {
  CONSUMER,
  register,
  handleExpenseCreated,
  handleExpenseDeleted,
  handleExpenseUpdated,
  handleIncomeCreated,
  handleIncomeDeleted,
  handleRecurringProcessed,
  logger,
};
