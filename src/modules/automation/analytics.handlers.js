const intelligenceRefresh = require("./intelligence-refresh.service");
const events = require("../../infrastructure/events/event-bus");
const EVENTS = require("../../infrastructure/events/event-names");
const logger = require("../../infrastructure/logger");

/**
 * Coalescing consumers.
 *
 * A financial write marks the user's analytics dirty instead of triggering a
 * full-history recomputation inside the request. The scheduled
 * `intelligence.refresh` job then evaluates each dirty user once.
 */

const markUserDirty = async (payload) => {
  if (!payload?.userId) {
    return;
  }

  await intelligenceRefresh.markDirty(payload.userId, 1);
};

const register = () => {
  for (const eventName of [
    EVENTS.EXPENSE_CREATED,
    EVENTS.EXPENSE_UPDATED,
    EVENTS.EXPENSE_DELETED,
    EVENTS.INCOME_CREATED,
    EVENTS.INCOME_DELETED,
    EVENTS.RECURRING_TRANSACTION_PROCESSED,
  ]) {
    events.register(eventName, markUserDirty, {
      id: `analytics:${eventName}`,
    });
  }
};

module.exports = {
  register,
  markUserDirty,
  logger,
};
