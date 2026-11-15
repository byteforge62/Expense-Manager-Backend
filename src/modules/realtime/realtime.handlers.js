const realtime = require("./realtime.service");
const events = require("../../infrastructure/events/event-bus");
const EVENTS = require("../../infrastructure/events/event-names");

/**
 * Pushes domain changes to connected clients.
 *
 * Only user-scoped events are forwarded, and only to that user's connections.
 * Payloads carry identifiers and timestamps rather than full financial
 * records, so a client is told what changed and refetches through the normal
 * authenticated API.
 */

const USER_SCOPED_EVENTS = [
  EVENTS.EXPENSE_CREATED,
  EVENTS.EXPENSE_UPDATED,
  EVENTS.EXPENSE_DELETED,
  EVENTS.INCOME_CREATED,
  EVENTS.INCOME_DELETED,
  EVENTS.BUDGET_THRESHOLD_REACHED,
  EVENTS.BUDGET_PERIOD_ENDED,
  EVENTS.BILL_DUE_SOON,
  EVENTS.BILL_OVERDUE,
  EVENTS.BILL_SETTLED,
  EVENTS.RECURRING_TRANSACTION_PROCESSED,
  EVENTS.FINANCIAL_SUMMARY_UPDATED,
  EVENTS.FINANCIAL_INTELLIGENCE_GENERATED,
  EVENTS.NOTIFICATION_CREATED,
];

const register = () => {
  for (const eventName of USER_SCOPED_EVENTS) {
    events.register(
      eventName,
      async (payload) => {
        if (!payload?.userId) {
          return;
        }

        realtime.publishToUser(payload.userId, eventName, {
          ...payload,
          // Never forward large nested analytics payloads over the stream.
          recommendations: undefined,
          rules: undefined,
        });
      },
      { id: `realtime:${eventName}` },
    );
  }
};

module.exports = {
  USER_SCOPED_EVENTS,
  register,
};
