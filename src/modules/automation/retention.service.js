const JobRunModel = require("../../models/JobRunModel");
const OutboxEventModel = require("../../models/OutboxEventModel");
const notificationService = require("../notifications/notification.service");

/**
 * Housekeeping.
 *
 * Bounded retention keeps operational collections from growing without limit.
 * Financial records themselves are never touched: only derived/operational
 * documents (notifications, job history, delivered events) are pruned.
 */

const JOB_HISTORY_DAYS = Number(process.env.JOB_HISTORY_RETENTION_DAYS) || 30;
const OUTBOX_RETENTION_DAYS = Number(process.env.OUTBOX_RETENTION_DAYS) || 7;

const runNotificationRetention = async ({ now = new Date() } = {}) => {
  const result = await notificationService.purgeExpired(now);
  return { deleted: result.deleted };
};

const runOperationalRetention = async ({ now = new Date() } = {}) => {
  const jobCutoff = new Date(now.getTime() - JOB_HISTORY_DAYS * 86_400_000);
  const outboxCutoff = new Date(now.getTime() - OUTBOX_RETENTION_DAYS * 86_400_000);

  const [jobs, outbox] = await Promise.all([
    JobRunModel.deleteMany({ startedAt: { $lt: jobCutoff } }),
    OutboxEventModel.deleteMany({
      createdAt: { $lt: outboxCutoff },
      status: { $in: ["dispatched", "dead"] },
    }),
  ]);

  return {
    jobRunsDeleted: jobs.deletedCount,
    outboxEventsDeleted: outbox.deletedCount,
  };
};

module.exports = {
  runNotificationRetention,
  runOperationalRetention,
};
