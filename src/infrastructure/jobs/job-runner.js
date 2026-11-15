const os = require("os");
const crypto = require("crypto");
const JobRunModel = require("../../models/JobRunModel");
const JobLockModel = require("../../models/JobLockModel");
const logger = require("../logger");

/**
 * Background job runner.
 *
 * - Cross-instance exclusion through a leased lock document.
 * - One JobRun document per execution for history/observability.
 * - Co-operative timeout: the handler receives an AbortSignal; work that
 *   ignores it is still recorded and retried, which is why every financial
 *   handler is idempotent.
 * - Idempotency keys let restart-safe jobs (daily digests, retention) run at
 *   most once per key even across instances and restarts.
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS) || 60_000;
const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;

const sleep = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
});

const acquireLock = async (name, ttlMs) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const existing = await JobLockModel.findOneAndUpdate(
    { name, expiresAt: { $lte: now } },
    { $set: { owner: INSTANCE_ID, acquiredAt: now, expiresAt } },
    { new: true },
  );

  if (existing) {
    return true;
  }

  try {
    await JobLockModel.create({ name, owner: INSTANCE_ID, acquiredAt: now, expiresAt });
    return true;
  } catch (error) {
    // Another instance holds a live lease.
    if (error.code === 11000) {
      return false;
    }

    throw error;
  }
};

const releaseLock = async (name) => {
  try {
    await JobLockModel.deleteOne({ name, owner: INSTANCE_ID });
  } catch (error) {
    // The lease expires on its own; releasing is best-effort.
    logger.warn("job.lock_release_failed", { job: name, error });
  }
};

const executeWithTimeout = async (handler, context, timeoutMs) => {
  const controller = new AbortController();
  let timer;

  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Job timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([
      Promise.resolve(handler({ ...context, signal: controller.signal })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Executes one job definition and records the run.
 * Returns { status, result } where status is succeeded|failed|skipped.
 */
const runJob = async ({
  name,
  handler,
  payload = {},
  trigger = "schedule",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  idempotencyKey,
  requestId,
}) => {
  let run;

  try {
    run = await JobRunModel.create({
      name,
      trigger,
      status: "running",
      idempotencyKey,
      attempts: 1,
      startedAt: new Date(),
    });
  } catch (error) {
    if (error.code === 11000 && idempotencyKey) {
      logger.debug("job.already_ran_for_key", { job: name, idempotencyKey });
      return { status: "skipped", reason: "idempotency_key_exists" };
    }

    throw error;
  }

  const startedAt = Date.now();

  try {
    const result = await executeWithTimeout(
      handler,
      { runId: run._id, requestId, trigger, payload },
      timeoutMs,
    );
    const durationMs = Date.now() - startedAt;

    await JobRunModel.updateOne(
      { _id: run._id },
      {
        $set: {
          status: "succeeded",
          finishedAt: new Date(),
          durationMs,
          meta: summarizeResult(result),
        },
      },
    );

    logger.info("job.succeeded", { job: name, durationMs });
    return { status: "succeeded", result };
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    await JobRunModel.updateOne(
      { _id: run._id },
      {
        $set: {
          status: "failed",
          finishedAt: new Date(),
          durationMs,
          error: String(error.message || error).slice(0, 1000),
        },
      },
    ).catch(() => {});

    logger.error("job.failed", { job: name, durationMs, error });
    return { status: "failed", error: error.message };
  }
};

const summarizeResult = (result) => {
  if (!result || typeof result !== "object") {
    return {};
  }

  // Keep history compact: only primitive counters are stored.
  const summary = {};

  for (const [key, value] of Object.entries(result)) {
    if (["number", "boolean", "string"].includes(typeof value)) {
      summary[key] = value;
    } else if (Array.isArray(value)) {
      summary[`${key}Count`] = value.length;
    }
  }

  return summary;
};

const backoffFor = (attempt) => Math.min(5 * 60_000, 2_000 * 2 ** attempt);

/**
 * Runs a scheduled job under the distributed lock, with bounded retries.
 * A lost lock race is a normal skip, not a failure.
 */
const runScheduledJob = async (definition, { trigger = "schedule", now = new Date() } = {}) => {
  const {
    name,
    handler,
    payload,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 0,
    idempotencyKeyFactory,
  } = definition;

  const lockTtl = timeoutMs + 30_000;
  const acquired = await acquireLock(name, lockTtl);

  if (!acquired) {
    logger.debug("job.lock_not_acquired", { job: name });
    return { status: "skipped", reason: "locked" };
  }

  try {
    const idempotencyKey = idempotencyKeyFactory
      ? idempotencyKeyFactory(now)
      : undefined;

    let lastResult;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      lastResult = await runJob({
        name,
        handler,
        payload,
        trigger: attempt === 0 ? trigger : "retry",
        timeoutMs,
        idempotencyKey,
      });

      if (lastResult.status !== "failed") {
        return lastResult;
      }

      if (attempt < retries) {
        const delay = backoffFor(attempt);
        logger.warn("job.retrying", { job: name, attempt: attempt + 1, delayMs: delay });
        await sleep(delay);
      }
    }

    return lastResult;
  } finally {
    await releaseLock(name);
  }
};

const getInstanceId = () => INSTANCE_ID;

module.exports = {
  DEFAULT_TIMEOUT_MS,
  acquireLock,
  releaseLock,
  runJob,
  runScheduledJob,
  getInstanceId,
  INSTANCE_ID,
};
