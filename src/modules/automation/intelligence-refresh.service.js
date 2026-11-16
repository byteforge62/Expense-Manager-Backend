const {
  FinancialInsightSnapshotModel,
  AnalyticsRefreshStateModel,
} = require("../../models/FinancialIntelligenceStateModel");
const {
  generateFinancialIntelligence,
} = require("../financial-intelligence/services/financial-intelligence.service");
const notificationService = require("../notifications/notification.service");
const events = require("../../infrastructure/events/event-bus");
const EVENTS = require("../../infrastructure/events/event-names");
const { mapWithConcurrency } = require("../../infrastructure/work-queue");
const logger = require("../../infrastructure/logger");

/**
 * Event-triggered intelligence refresh.
 *
 * Financial writes mark the user dirty; this job coalesces any number of
 * writes into one evaluation. That avoids recomputing full history on every
 * transaction while keeping the dashboard's analysis reasonably fresh.
 *
 * Recommendation lifecycle: recommendations are identified by the engine's
 * stable `id`. Comparing against the previous snapshot yields
 * new / persisted / resolved, which is what makes "stale" recommendations
 * disappear instead of accumulating forever.
 */

const BATCH_SIZE = Number(process.env.INTELLIGENCE_REFRESH_BATCH) || 10;
const CONCURRENCY = 3;
const NOTIFY_PRIORITIES = new Set(["high", "critical"]);

const markDirty = async (userID, count = 1) => {
  if (!userID) {
    return;
  }

  await AnalyticsRefreshStateModel.updateOne(
    { userID },
    {
      $set: { dirtyAt: new Date() },
      $inc: { pendingEvents: count },
    },
    { upsert: true },
  );
};

const claimDirtyUsers = async (limit = BATCH_SIZE) => {
  const candidates = await AnalyticsRefreshStateModel.find({ dirtyAt: { $ne: null } })
    .select("userID")
    .sort({ dirtyAt: 1 })
    .limit(limit)
    .lean();

  const claimed = [];

  for (const candidate of candidates) {
    // Conditional claim: only one worker can clear a given dirty marker.
    const state = await AnalyticsRefreshStateModel.findOneAndUpdate(
      { userID: candidate.userID, dirtyAt: { $ne: null } },
      { $set: { dirtyAt: null, pendingEvents: 0 }, $currentDate: { lastEvaluatedAt: true } },
      { new: true },
    );

    if (state) {
      claimed.push(state);
    }
  }

  return claimed;
};

const lifecycleFor = (previous = [], current = [], now) => {
  const nowIso = now.toISOString();
  const previousById = new Map(
    previous.filter((item) => item && item.id).map((item) => [item.id, item]),
  );
  const currentIds = new Set(current.filter((item) => item && item.id).map((item) => item.id));

  const merged = current
    .filter((item) => item && item.id)
    .map((item) => {
      const seen = previousById.get(item.id);

      return {
        id: item.id,
        title: item.title,
        priority: item.priority,
        type: item.type,
        confidenceLevel: item.confidenceLevel,
        status: seen ? "persisted" : "new",
        firstSeenAt: seen?.firstSeenAt || nowIso,
        lastSeenAt: nowIso,
        resolvedAt: null,
      };
    });

  for (const item of previous) {
    if (item?.id && !currentIds.has(item.id)) {
      merged.push({
        id: item.id,
        title: item.title,
        priority: item.priority,
        type: item.type,
        confidenceLevel: item.confidenceLevel,
        status: "resolved",
        firstSeenAt: item.firstSeenAt,
        lastSeenAt: nowIso,
        resolvedAt: nowIso,
      });
    }
  }

  return merged;
};

const refreshUser = async (userID, now) => {
  const intelligence = await generateFinancialIntelligence({ userId: userID, now });

  const previousSnapshot = await FinancialInsightSnapshotModel.findOne({ userID })
    .select("recommendations")
    .lean();

  const recommendations = intelligence.recommendations || [];
  const lifecycle = lifecycleFor(
    previousSnapshot?.recommendations || [],
    recommendations,
    now,
  );

  const healthScore =
    typeof intelligence.financialHealth?.score === "number"
      ? intelligence.financialHealth.score
      : null;

  await FinancialInsightSnapshotModel.updateOne(
    { userID },
    {
      $set: {
        generatedAt: now,
        periodStart: new Date(intelligence.metrics?.period?.startDate || now),
        periodEnd: new Date(intelligence.metrics?.period?.endDate || now),
        healthScore,
        confidenceLevel: intelligence.dataConfidence?.level || "low",
        recommendations: lifecycle,
        rules: intelligence.rules || [],
        anomalyCount: (intelligence.anomalies || []).length,
      },
    },
    { upsert: true },
  );

  // Notify only for genuinely new, actionable recommendations.
  const newActionable = lifecycle.filter(
    (item) => item.status === "new" && NOTIFY_PRIORITIES.has(item.priority),
  );

  // High-severity anomalies are surfaced at most once per type per day.
  const anomalies = (intelligence.anomalies || []).filter(
    (anomaly) => anomaly?.severity === "high",
  );

  for (const anomaly of anomalies.slice(0, 3)) {
    await notificationService
      .createNotification({
        userID,
        type: "anomaly.detected",
        category: "anomaly",
        priority: "high",
        title: anomaly.title || "Unusual financial activity detected",
        message:
          "An unusual pattern was detected in your recent transactions. This is a statistical signal, not a confirmed error.",
        data: { anomalyType: anomaly.type, severity: anomaly.severity },
        dedupeKey: `anomaly:${anomaly.type || "unknown"}:${now.toISOString().slice(0, 10)}`,
      })
      .catch((error) => logger.error("intelligence.anomaly_notify_failed", { error }));
  }

  for (const recommendation of newActionable) {
    await notificationService
      .createNotification({
        userID,
        type: "recommendation.new",
        category: "recommendation",
        priority: recommendation.priority,
        title: recommendation.title || "New financial recommendation",
        message:
          "A new recommendation is available in your financial intelligence overview. It is a heuristic based on your recorded history, not a guarantee.",
        data: { recommendationId: recommendation.id },
        dedupeKey: `recommendation:${recommendation.id}`,
      })
      .catch((error) => logger.error("intelligence.notify_failed", { error }));
  }

  await events.emit(
    EVENTS.FINANCIAL_INTELLIGENCE_GENERATED,
    {
      userId: String(userID),
      generatedAt: now.toISOString(),
      healthScore,
      recommendationCount: recommendations.length,
      newRecommendations: newActionable.length,
      anomalyCount: (intelligence.anomalies || []).length,
    },
    { source: "job" },
  );

  return {
    healthScore,
    recommendationCount: recommendations.length,
    newRecommendations: newActionable.length,
    resolved: lifecycle.filter((item) => item.status === "resolved").length,
  };
};

const runIntelligenceRefresh = async ({ now = new Date() } = {}) => {
  const startedAt = Date.now();
  const claimed = await claimDirtyUsers();

  if (claimed.length === 0) {
    return {
      usersProcessed: 0,
      failures: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const outcome = await mapWithConcurrency(claimed, CONCURRENCY, (state) =>
    refreshUser(state.userID, now),
  );

  for (const failure of outcome.failures) {
    logger.error("intelligence.refresh_failed", { error: failure.error });
  }

  return {
    usersProcessed: outcome.succeeded,
    failures: outcome.failures.length,
    durationMs: Date.now() - startedAt,
  };
};

const getSnapshot = async (userID) =>
  FinancialInsightSnapshotModel.findOne({ userID })
    .select("-userID -__v")
    .lean();

module.exports = {
  markDirty,
  claimDirtyUsers,
  refreshUser,
  runIntelligenceRefresh,
  getSnapshot,
  lifecycleFor,
};
