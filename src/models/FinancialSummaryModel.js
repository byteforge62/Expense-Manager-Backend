const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Derived per-user period aggregates.
 *
 * These documents are a read-optimisation layer only. They are maintained
 * incrementally from financial events and can be rebuilt from the authoritative
 * expense/income collections at any time (see summaries.reconcile job), so a
 * lost or corrupted summary never becomes a source of truth.
 */
const FinancialSummarySchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    periodType: {
      type: String,
      enum: ["daily", "monthly"],
      required: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    totalIncome: {
      type: Number,
      default: 0,
    },
    totalExpense: {
      type: Number,
      default: 0,
    },
    net: {
      type: Number,
      default: 0,
    },
    incomeCount: {
      type: Number,
      default: 0,
    },
    expenseCount: {
      type: Number,
      default: 0,
    },
    version: {
      type: Number,
      default: 1,
    },
    rebuiltAt: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

FinancialSummarySchema.index(
  { userID: 1, periodType: 1, periodStart: 1 },
  { unique: true, name: "unique_financial_summary_period" },
);

/**
 * Per-category breakdown for a period, updated with $inc so concurrent writes
 * are atomic at the document level.
 */
const CategorySummarySchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    periodType: {
      type: String,
      enum: ["daily", "monthly"],
      required: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    categoryID: {
      type: Schema.Types.ObjectId,
      ref: "category",
      required: true,
    },
    amount: {
      type: Number,
      default: 0,
    },
    count: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

CategorySummarySchema.index(
  { userID: 1, periodType: 1, periodStart: 1, categoryID: 1 },
  { unique: true, name: "unique_category_summary_period" },
);

module.exports = mongoose.model("financial_summary", FinancialSummarySchema);
module.exports.CategorySummaryModel = mongoose.model(
  "category_summary",
  CategorySummarySchema,
);
