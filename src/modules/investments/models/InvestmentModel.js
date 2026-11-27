const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * A holding in the user's paper portfolio.
 *
 * FinTrack never places an order: a holding records what the user already
 * owns (units and average cost), and live prices are read from public market
 * data. Money stays in the ledger; this is tracking, not brokerage.
 */
const investmentSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ["STOCK", "FUND"],
      required: true,
    },
    // Yahoo Finance symbol for a stock/ETF (e.g. RELIANCE.NS) or the MFAPI
    // scheme code for a mutual fund. Kept as text so both fit one field.
    symbol: { type: String, trim: true, required: true, maxlength: 40 },
    name: { type: String, trim: true, required: true, maxlength: 160 },
    exchange: { type: String, trim: true, maxlength: 40 },

    units: { type: Number, required: true, min: 0 },
    avgCost: { type: Number, required: true, min: 0 },
    investedAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

investmentSchema.index({ userID: 1, createdAt: -1 });

// One row per instrument per user: adding the same stock again updates the
// existing holding instead of silently double-counting it.
investmentSchema.index(
  { userID: 1, kind: 1, symbol: 1 },
  { unique: true, name: "unique_investment_per_user" },
);

module.exports = mongoose.model("Investment", investmentSchema);
