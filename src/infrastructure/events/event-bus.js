const crypto = require("crypto");
const OutboxEventModel = require("../../models/OutboxEventModel");
const logger = require("../logger");

/**
 * In-process event bus with a MongoDB-backed outbox.
 *
 * Guarantees:
 * - Publishing never breaks the user-facing write. `emit` swallows transport
 *   failures and leaves the row for the dispatcher to retry.
 * - Delivery is at-least-once. Handlers must be idempotent.
 * - Handler failures are isolated: one failing consumer does not prevent the
 *   others from running.
 */

const HANDLER_TIMEOUT_MS = Number(process.env.EVENT_HANDLER_TIMEOUT_MS) || 10_000;
const MAX_ATTEMPTS = Number(process.env.EVENT_MAX_ATTEMPTS) || 5;

const handlers = new Map(); // event name -> Map(id -> fn)

const withTimeout = (promise, ms, label) => {
  let timer;

  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Handler timed out after ${ms}ms: ${label}`)),
      ms,
    );
    // Never hold the process open for a handler timeout.
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const register = (eventName, handler, options = {}) => {
  if (typeof handler !== "function") {
    throw new TypeError(`Handler for "${eventName}" must be a function`);
  }

  const id = options.id || handler.name || `handler_${crypto.randomUUID()}`;

  if (!handlers.has(eventName)) {
    handlers.set(eventName, new Map());
  }

  handlers.get(eventName).set(id, handler);
  return id;
};

/**
 * Runs every registered handler for an event, isolating failures.
 * Returns a compact result used by the outbox dispatcher for retry decisions.
 */
const dispatch = async (eventName, payload = {}, context = {}) => {
  const registered = handlers.get(eventName);

  if (!registered || registered.size === 0) {
    return { handled: 0, failed: [] };
  }

  const failed = [];
  let handled = 0;

  // Handlers run sequentially on purpose: budget/summary handlers both write
  // aggregates and the ordering keeps the failure surface deterministic.
  for (const [id, handler] of registered) {
    try {
      await withTimeout(
        Promise.resolve(handler(payload, context)),
        HANDLER_TIMEOUT_MS,
        `${eventName}:${id}`,
      );
      handled += 1;
    } catch (error) {
      failed.push({ handlerId: id, error: error.message });
      logger.error("event.handler_failed", {
        event: eventName,
        handlerId: id,
        error,
        requestId: context.requestId,
      });
    }
  }

  return { handled, failed };
};

const backoffMs = (attempts) =>
  Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));

/**
 * Publishes an event.
 *
 * The outbox row is written first (so a crash right after the financial write
 * cannot silently lose the event), then delivery is attempted immediately to
 * keep the common path fast. Any failure is retried by the dispatcher.
 *
 * Never throws.
 */
const emit = async (eventName, payload = {}, options = {}) => {
  const context = {
    requestId: options.requestId,
    source: options.source || "request",
  };

  let event;

  try {
    event = await OutboxEventModel.create({
      eventId: options.eventId || crypto.randomUUID(),
      name: eventName,
      payload,
      dedupeKey: options.dedupeKey,
      status: "pending",
      availableAt: new Date(),
    });
  } catch (error) {
    // A duplicate dedupe key means the event is already queued: that is the
    // idempotent outcome we want, not a failure.
    if (error.code === 11000) {
      logger.debug("event.duplicate_suppressed", { event: eventName });
      return { queued: false, duplicate: true };
    }

    logger.error("event.outbox_write_failed", { event: eventName, error });
    return { queued: false, error: error.message };
  }

  try {
    // The immediate dispatch carries the persisted event id so consumers can
    // claim it in the processed-event ledger (same id used on retry).
    const result = await dispatch(eventName, payload, {
      ...context,
      eventId: event.eventId,
    });

    if (result.failed.length === 0) {
      await OutboxEventModel.updateOne(
        { _id: event._id },
        {
          $set: {
            status: "dispatched",
            processedAt: new Date(),
            attempts: 1,
            lastError: undefined,
          },
        },
      );

      return { queued: true, eventId: event.eventId, dispatched: true };
    }

    await OutboxEventModel.updateOne(
      { _id: event._id },
      {
        $set: {
          status: "failed",
          attempts: 1,
          lastError: result.failed.map((f) => `${f.handlerId}: ${f.error}`).join("; ").slice(0, 500),
          availableAt: new Date(Date.now() + backoffMs(1)),
        },
      },
    );

    return { queued: true, eventId: event.eventId, dispatched: false };
  } catch (error) {
    logger.error("event.immediate_dispatch_failed", { event: eventName, error });
    return { queued: true, eventId: event.eventId, dispatched: false };
  }
};

const getHandlerCount = (eventName) => handlers.get(eventName)?.size || 0;

const clearHandlers = () => handlers.clear();

module.exports = {
  EVENTS_MAX_ATTEMPTS: MAX_ATTEMPTS,
  backoffMs,
  register,
  dispatch,
  emit,
  getHandlerCount,
  clearHandlers,
};
