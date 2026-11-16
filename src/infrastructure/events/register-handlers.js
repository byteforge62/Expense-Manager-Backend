const summaryHandlers = require("../../modules/summaries/summary.handlers");
const notificationHandlers = require("../../modules/notifications/notification.handlers");
const realtimeService = require("../../modules/realtime/realtime.service");
const analyticsHandlers = require("../../modules/automation/analytics.handlers");
const logger = require("../logger");

let registered = false;

/**
 * Registers all consumers exactly once per process.
 *
 * Order is not significant: the outbox guarantees delivery, and each consumer
 * is independent and idempotent.
 */
const registerHandlers = () => {
  if (registered) {
    return;
  }

  summaryHandlers.register();
  notificationHandlers.register();
  analyticsHandlers.register();
  realtimeService.register();

  registered = true;
  logger.info("events.handlers_registered");
};

module.exports = registerHandlers;
