const OutboxEventModel = require("../../models/OutboxEventModel");
const { dispatch, backoffMs, EVENTS_MAX_ATTEMPTS } = require("./event-bus");
const { mapWithConcurrency } = require("../queues/work-queue");
const logger = require("../logger");

/**
 * Drains the outbox.
 *
 * Safe to run on every instance: claiming is a single atomic
 * findOneAndUpdate that moves the row to `processing` and stamps a lease, so
 * exactly one worker owns an event at a time. Expired leases are reclaimed,
 * which covers a worker that crashed mid-delivery.
 */
const LEASE_MS = Number(process.env.OUTBOX_LEASE_MS) || 30_000;
const CONCURRENCY = Number(process.env.OUTBOX_CONCURRENCY) || 5;

const stats = {
  lastRunAt: null,
  dispatched: 0,
  failed: 0,
  deadLettered: 0,
  reclaimed: 0,
  running: false,
};

const claimOne = async (now) => {
  return OutboxEventModel.findOneAndUpdate(
    {
      status: { $in: ["pending", "failed", "processing"] },
      availableAt: { $lte: now },
      $or: [
        { lockedUntil: { $exists: false } },
        { lockedUntil: null },
        { lockedUntil: { $lt: now } },
      ],
    },
    {
      $set: {
        status: "processing",
        lockedUntil: new Date(now.getTime() + LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
    {
      new: true,
      sort: { availableAt: 1 },
    },
  );
};

const settle = async (event, outcome) => {
  if (outcome.ok) {
    stats.dispatched += 1;
    await OutboxEventModel.updateOne(
      { _id: event._id },
      {
        $set: {
          status: "dispatched",
          processedAt: new Date(),
          lockedUntil: undefined,
          lastError: undefined,
        },
      },
    );
    return;
  }

  const exhausted = event.attempts >= EVENTS_MAX_ATTEMPTS;

  if (exhausted) {
    stats.deadLettered += 1;
    logger.error("outbox.dead_lettered", {
      event: event.name,
      eventId: event.eventId,
      attempts: event.attempts,
      error: outcome.error,
    });
  } else {
    stats.failed += 1;
  }

  await OutboxEventModel.updateOne(
    { _id: event._id },
    {
      $set: {
        status: exhausted ? "dead" : "failed",
        availableAt: new Date(Date.now() + backoffMs(event.attempts)),
        lockedUntil: undefined,
        lastError: String(outcome.error || "").slice(0, 500),
      },
    },
  );
};

const drainOnce = async (limit = 50) => {
  const now = new Date();
  const claimed = [];

  for (let i = 0; i < limit; i += 1) {
    const event = await claimOne(now);

    if (!event) {
      break;
    }

    claimed.push(event);
  }

  if (claimed.length === 0) {
    return { claimed: 0, dispatched: 0, failed: 0 };
  }

  stats.running = true;
  stats.lastRunAt = now;

  try {
    const outcome = await mapWithConcurrency(claimed, CONCURRENCY, async (event) => {
      const result = await dispatch(event.name, event.payload, {
        source: "outbox",
        eventId: event.eventId,
      });

      const ok = result.failed.length === 0;
      await settle(event, {
        ok,
        error: result.failed.map((f) => `${f.handlerId}: ${f.error}`).join("; "),
      });

      return ok;
    });

    return {
      claimed: claimed.length,
      dispatched: outcome.succeeded,
      failed: outcome.failures.length,
    };
  } finally {
    stats.running = false;
  }
};

let timer = null;

const start = (intervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 5_000) => {
  if (timer) {
    return;
  }

  const tick = async () => {
    try {
      await drainOnce();
    } catch (error) {
      logger.error("outbox.drain_failed", { error });
    } finally {
      timer = setTimeout(tick, intervalMs);
      timer.unref?.();
    }
  };

  timer = setTimeout(tick, intervalMs);
  timer.unref?.();
  logger.info("outbox.dispatcher_started", { intervalMs });
};

const stop = () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};

const getStats = () => ({ ...stats, intervalActive: Boolean(timer) });

module.exports = {
  drainOnce,
  start,
  stop,
  getStats,
};
