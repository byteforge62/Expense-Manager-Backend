const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Latest computed financial-intelligence snapshot per user.
 *
 * Exists so recommendations gain a lifecycle (new / persisted / resolved)
 * instead of being regenerated from scratch on every request. It stores
 * derived analytics only; the authoritative financial data stays in the
 * expense/income/budget collections.
 */
const FinancialInsightSnapshotSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    generatedAt: {
      type: Date,
      required: true,
    },
    periodStart: {
      type: Date,
    },
    periodEnd: {
      type: Date,
    },
    healthScore: {
      type: Number,
      default: null,
    },
    confidenceLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low",
    },
    recommendations: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    rules: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    anomalyCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

FinancialInsightSnapshotSchema.index(
  { userID: 1 },
  { unique: true, name: "unique_insight_snapshot_user" },
);

/**
 * Dirty marker used to coalesce event-triggered analytics refreshes: many
 * transactions in a short window collapse into one scheduled evaluation,
 * instead of recomputing full history on every write.
 */
const AnalyticsRefreshStateSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    dirtyAt: {
      type: Date,
      default: undefined,
    },
    pendingEvents: {
      type: Number,
      default: 0,
    },
    lastEvaluatedAt: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

AnalyticsRefreshStateSchema.index(
  { userID: 1 },
  { unique: true, name: "unique_analytics_refresh_user" },
);
AnalyticsRefreshStateSchema.index({ dirtyAt: 1 }, { name: "analytics_refresh_pending" });

module.exports = mongoose.model(
  "financial_insight_snapshot",
  FinancialInsightSnapshotSchema,
);
module.exports.AnalyticsRefreshStateModel = mongoose.model(
  "analytics_refresh_state",
  AnalyticsRefreshStateSchema,
);
