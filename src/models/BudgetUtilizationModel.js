const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Derived budget utilization per budget period.
 *
 * Recalculated by the budget monitor from authoritative expense records; used
 * only to avoid recomputing utilization on every dashboard read. It is never
 * the source of truth and is fully rebuildable.
 */
const BudgetUtilizationSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    budgetID: {
      type: Schema.Types.ObjectId,
      ref: "budget",
      required: true,
    },
    categoryID: {
      type: Schema.Types.ObjectId,
      ref: "category",
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    limit: {
      type: Number,
      default: 0,
    },
    spent: {
      type: Number,
      default: 0,
    },
    utilization: {
      type: Number,
      default: 0,
    },
    highestThresholdReached: {
      type: Number,
      default: 0,
    },
    computedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

BudgetUtilizationSchema.index(
  { budgetID: 1, periodStart: 1 },
  { unique: true, name: "unique_budget_utilization_period" },
);
BudgetUtilizationSchema.index(
  { userID: 1, periodStart: -1 },
  { name: "budget_utilization_by_user" },
);

module.exports = mongoose.model("budget_utilization", BudgetUtilizationSchema);
