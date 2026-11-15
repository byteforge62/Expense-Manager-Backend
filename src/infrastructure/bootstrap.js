const registerHandlers = require("./events/register-handlers");
const outboxDispatcher = require("./events/outbox-dispatcher");
const Scheduler = require("./jobs/scheduler");
const { buildJobDefinitions, JOBS_ENABLED } = require("./jobs/job-definitions");
const { getInstanceId } = require("./jobs/job-runner");
const realtime = require("../modules/realtime/realtime.service");
const cache = require("./cache/memory-cache");
const logger = require("./logger");

/**
 * Composition root for all background infrastructure.
 *
 * Started from server.js only, after the Mongo connection is established, and
 * never from app.js, so unit/API tests do not spawn timers.
 */

let scheduler = null;
let started = false;

const startInfrastructure = () => {
  if (started) {
    return;
  }

  registerHandlers();

  outboxDispatcher.start();

  scheduler = new Scheduler(buildJobDefinitions());

  if (JOBS_ENABLED) {
    scheduler.start();
  } else {
    logger.info("scheduler.disabled", { reason: "JOBS_ENABLED is false" });
  }

  started = true;
};

const stopInfrastructure = async () => {
  if (!started) {
    return;
  }

  outboxDispatcher.stop();

  if (scheduler) {
    await scheduler.stop();
    scheduler = null;
  }

  realtime.closeAll();
  cache.clear();

  started = false;
  logger.info("infrastructure.stopped");
};

const getRuntimeStatus = () => {
  const mongoose = require("mongoose");

  return {
    instanceId: getInstanceId(),
    jobsEnabled: JOBS_ENABLED,
    infrastructureStarted: started,
    database: {
      connected: mongoose.connection.readyState === 1,
      state: mongoose.STATES[mongoose.connection.readyState] || "unknown",
    },
    scheduler: scheduler ? scheduler.status() : { started: false, jobs: [] },
    outbox: outboxDispatcher.getStats(),
    realtime: realtime.getStats(),
    cache: cache.getStats(),
  };
};

module.exports = {
  startInfrastructure,
  stopInfrastructure,
  getRuntimeStatus,
};
