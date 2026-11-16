const { runRecurringProcessor } = require("../../modules/automation/recurring-processor.service");
const { runBillReminders } = require("../../modules/automation/bill-reminder.service");
const { runBudgetMonitor } = require("../../modules/automation/budget-monitor.service");
const { runIntelligenceRefresh } = require("../../modules/automation/intelligence-refresh.service");
const {
  runNotificationRetention,
  runOperationalRetention,
} = require("../../modules/automation/retention.service");
const {
  runSummaryReconciliation,
} = require("../../modules/summaries/summaries.service");

/**
 * Background job catalogue.
 *
 * All schedules are expressed as intervals in UTC. Calendar-scoped jobs use an
 * idempotency key derived from the UTC date, so restarts and multiple instances
 * cannot run them twice for the same day.
 *
 * `JOBS_ENABLED=false` disables all automation (tests). Individual jobs can be
 * disabled with `JOB_<NAME>_ENABLED=false`.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const JOBS_ENABLED = process.env.JOBS_ENABLED
  ? process.env.JOBS_ENABLED === "true"
  : process.env.NODE_ENV !== "test";

const utcDateKey = (date) => date.toISOString().slice(0, 10);

const jobEnabled = (name) => {
  const flag = process.env[`JOB_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_ENABLED`];
  return flag === undefined ? true : flag === "true";
};

const buildJobDefinitions = () => {
  const definitions = [
    {
      name: "recurring.process",
      handler: runRecurringProcessor,
      intervalMs: 10 * MINUTE,
      timeoutMs: 120_000,
      retries: 1,
      initialDelayMs: 20_000,
      // No date idempotency key: the engine itself is idempotent per
      // occurrence, and running more than once a day picks up new schedules
      // promptly. Concurrent runs are excluded by the job lock.
    },
    {
      name: "bills.reminders",
      handler: runBillReminders,
      intervalMs: HOUR,
      timeoutMs: 120_000,
      initialDelayMs: 45_000,
    },
    {
      name: "budgets.monitor",
      handler: runBudgetMonitor,
      intervalMs: 15 * MINUTE,
      timeoutMs: 120_000,
      initialDelayMs: 60_000,
    },
    {
      name: "intelligence.refresh",
      handler: runIntelligenceRefresh,
      intervalMs: 15 * MINUTE,
      timeoutMs: 180_000,
      initialDelayMs: 90_000,
    },
    {
      name: "summaries.reconcile",
      handler: runSummaryReconciliation,
      intervalMs: 6 * HOUR,
      timeoutMs: 300_000,
      idempotencyKeyFactory: (now) => `summaries.reconcile:${utcDateKey(now)}`,
    },
    {
      name: "notifications.retention",
      handler: runNotificationRetention,
      intervalMs: 6 * HOUR,
      timeoutMs: 60_000,
      idempotencyKeyFactory: (now) => `notifications.retention:${utcDateKey(now)}`,
    },
    {
      name: "operations.retention",
      handler: runOperationalRetention,
      intervalMs: 6 * HOUR,
      timeoutMs: 60_000,
      idempotencyKeyFactory: (now) => `operations.retention:${utcDateKey(now)}`,
    },
  ];

  return definitions.map((definition) => ({
    ...definition,
    enabled: JOBS_ENABLED && jobEnabled(definition.name),
  }));
};

module.exports = {
  JOBS_ENABLED,
  buildJobDefinitions,
  utcDateKey,
};
