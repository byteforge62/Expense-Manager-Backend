const logger = require("../logger");
const { runScheduledJob } = require("./job-runner");

/**
 * Interval scheduler for background work.
 *
 * Replaces the previous bare `node-cron` call for financial processing:
 * - every tick goes through a leased job lock, so N instances never run the
 *   same job twice;
 * - ticks are scheduled after the previous run finishes, so slow work cannot
 *   pile up;
 * - jobs are described declaratively and can be enabled/disabled per
 *   environment (all financial automation is off by default in tests).
 *
 * UTC is used for every calendar-derived key. No user timezone is assumed:
 * the data model does not store one.
 */
class Scheduler {
  constructor(jobs = []) {
    this.jobs = jobs.filter((job) => job.enabled !== false);
    this.timers = new Map();
    this.inFlight = new Set();
    this.started = false;
    this.lastRun = new Map();
  }

  start() {
    if (this.started) {
      return this;
    }

    this.started = true;

    for (const job of this.jobs) {
      this.schedule(job, job.runOnStart ? 1_000 : job.initialDelayMs ?? 5_000);
    }

    logger.info("scheduler.started", {
      jobs: this.jobs.map((job) => ({ name: job.name, intervalMs: job.intervalMs })),
    });

    return this;
  }

  schedule(job, delayMs) {
    const jitter = Math.floor(Math.random() * 250);
    const timer = setTimeout(() => this.runTick(job), delayMs + jitter);
    timer.unref?.();
    this.timers.set(job.name, timer);
  }

  async runTick(job) {
    if (!this.started) {
      return;
    }

    this.inFlight.add(job.name);

    try {
      const result = await runScheduledJob(job, { trigger: "schedule" });
      this.lastRun.set(job.name, {
        at: new Date().toISOString(),
        status: result.status,
        reason: result.reason,
      });
    } catch (error) {
      // runScheduledJob already records failures; this covers lock/db errors.
      logger.error("scheduler.tick_failed", { job: job.name, error });
      this.lastRun.set(job.name, {
        at: new Date().toISOString(),
        status: "error",
        reason: error.message,
      });
    } finally {
      this.inFlight.delete(job.name);

      if (this.started) {
        this.schedule(job, job.intervalMs);
      }
    }
  }

  async stop({ drainTimeoutMs = 15_000 } = {}) {
    this.started = false;

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();

    const drain = (async () => {
      const deadline = Date.now() + drainTimeoutMs;
      while (this.inFlight.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();

    await drain;
    logger.info("scheduler.stopped", { stillRunning: [...this.inFlight] });
  }

  status() {
    return {
      started: this.started,
      jobs: this.jobs.map((job) => ({
        name: job.name,
        intervalMs: job.intervalMs,
        running: this.inFlight.has(job.name),
        lastRun: this.lastRun.get(job.name) || null,
      })),
    };
  }
}

module.exports = Scheduler;
