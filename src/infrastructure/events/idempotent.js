const ProcessedEventModel = require("../../models/ProcessedEventModel");

/**
 * Wraps a consumer so it executes at most once per (event, consumer).
 *
 * If the consumer throws, the ledger row is removed so the event can be
 * retried. Consumers must therefore be either idempotent or transactional
 * within themselves; the summary/budget handlers use atomic $inc upserts.
 */
const runOnce = async (consumer, eventId, fn) => {
  if (!eventId) {
    // Events emitted synchronously without a persisted id are best-effort.
    return fn();
  }

  try {
    await ProcessedEventModel.create({ eventId, consumer });
  } catch (error) {
    if (error.code === 11000) {
      return { skipped: true, reason: "already_processed" };
    }

    throw error;
  }

  try {
    return await fn();
  } catch (error) {
    await ProcessedEventModel.deleteOne({ eventId, consumer }).catch(() => {});
    throw error;
  }
};

module.exports = { runOnce };
