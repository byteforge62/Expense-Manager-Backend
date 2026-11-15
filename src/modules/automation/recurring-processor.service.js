const {
  processDueRecurringTransactions,
} = require("../../services/recurring-engine.service");
const events = require("../../infrastructure/events/event-bus");
const EVENTS = require("../../infrastructure/events/event-names");
const logger = require("../../infrastructure/logger");

/**
 * Recurring transaction automation.
 *
 * The money-moving work stays in `recurring-engine.service` (already atomic and
 * idempotent: an occurrence is upserted behind a unique index and the schedule
 * is advanced with a conditional update). This module adds the automation
 * concerns around it: publishing one event per generated occurrence so
 * summaries, notifications and connected clients stay in sync, and reporting
 * failures per schedule instead of silently skipping them.
 *
 * Dedupe key per occurrence means a retried run cannot emit the same event
 * twice even if the engine is invoked again.
 */

const dateKey = (date) => new Date(date).toISOString();

const runRecurringProcessor = async ({ now = new Date() } = {}) => {
  const startedAt = Date.now();
  const occurrences = [];

  const result = await processDueRecurringTransactions(now, {
    onOccurrence: (occurrence) => occurrences.push(occurrence),
  });

  let emitted = 0;
  let emitFailures = 0;

  for (const occurrence of occurrences) {
    try {
      await events.emit(
        EVENTS.RECURRING_TRANSACTION_PROCESSED,
        {
          userId: String(occurrence.userId),
          recurringId: String(occurrence.recurringId),
          type: occurrence.type,
          amount: occurrence.amount,
          title: occurrence.title,
          categoryID: occurrence.categoryID ? String(occurrence.categoryID) : null,
          occurrenceDate: dateKey(occurrence.occurrenceDate),
          transactionId: occurrence.transactionId
            ? String(occurrence.transactionId)
            : null,
        },
        {
          dedupeKey: `recurring_processed:${occurrence.recurringId}:${dateKey(occurrence.occurrenceDate)}`,
          source: "job",
        },
      );
      emitted += 1;
    } catch (error) {
      emitFailures += 1;
      logger.error("recurring.event_emit_failed", { error });
    }
  }

  for (const failure of result.failures) {
    try {
      await events.emit(
        EVENTS.RECURRING_TRANSACTION_FAILED,
        {
          userId: failure.userId ? String(failure.userId) : null,
          recurringId: failure.recurringId,
          message: failure.message,
          at: now.toISOString(),
        },
        { source: "job" },
      );
    } catch (error) {
      emitFailures += 1;
      logger.error("recurring.failure_event_emit_failed", { error });
    }
  }

  return {
    schedulesChecked: result.schedulesChecked,
    occurrencesGenerated: result.occurrencesGenerated,
    eventsEmitted: emitted,
    failures: result.failures.length,
    emitFailures,
    durationMs: Date.now() - startedAt,
  };
};

module.exports = {
  runRecurringProcessor,
};
