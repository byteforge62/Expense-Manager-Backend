const ExpenseModel = require("../../models/ExpenseModel");
const IncomeModel = require("../../models/IncomeModel");
const summaries = require("./summaries.service");
const { mapWithConcurrency } = require("../../infrastructure/queues/work-queue");
const logger = require("../../infrastructure/logger");

/**
 * Reconciliation keeps derived summaries trustworthy.
 *
 * Incremental updates are fast but can drift (a lost consumer run, a manual
 * database edit, an unresolved partial failure). This job rebuilds the
 * affected windows from authoritative records for users with recent activity.
 * A full rebuild for every user is deliberately not scheduled; it is available
 * on demand through `rebuildAllForUser`.
 */

const LOOKBACK_DAYS = Number(process.env.SUMMARY_RECONCILE_LOOKBACK_DAYS) || 2;
const CONCURRENCY = 3;
const MAX_USERS = Number(process.env.SUMMARY_RECONCILE_MAX_USERS) || 200;

const runSummaryReconciliation = async ({ now = new Date() } = {}) => {
  const startedAt = Date.now();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [expenseUsers, incomeUsers] = await Promise.all([
    ExpenseModel.distinct("userID", { updatedAt: { $gte: since } }),
    IncomeModel.distinct("userID", { updatedAt: { $gte: since } }),
  ]);

  const userIds = [...new Set([...expenseUsers, ...incomeUsers].map(String))]
    .slice(0, MAX_USERS);

  if (userIds.length === 0) {
    return { usersReconciled: 0, failures: 0, durationMs: Date.now() - startedAt };
  }

  const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const outcome = await mapWithConcurrency(userIds, CONCURRENCY, (userID) =>
    summaries.rebuildSummaries({ userID, from, to: now }),
  );

  for (const failure of outcome.failures) {
    logger.error("summaries.reconcile_failed", { error: failure.error });
  }

  return {
    usersReconciled: outcome.succeeded,
    failures: outcome.failures.length,
    durationMs: Date.now() - startedAt,
  };
};

module.exports = {
  runSummaryReconciliation,
};
