const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * One dated buy or sell in a holding's ledger.
 *
 * A holding's units and average cost are derived from these rows, so the
 * history is the source of truth and a sale can report realized gain. Rows are
 * never edited: a mistake is corrected by removing the trade and recording it
 * again, which keeps the arithmetic reproducible.
 */
const investmentTransactionSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    investmentID: {
      type: Schema.Types.ObjectId,
      ref: "Investment",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["BUY", "SELL"],
      required: true,
    },
    units: { type: Number, required: true, min: 0 },
    // Price per unit on the trade date, not the total value of the trade.
    price: { type: Number, required: true, min: 0 },
    tradedAt: { type: Date, required: true, default: Date.now },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

// The ledger is always read for one holding in date order.
investmentTransactionSchema.index({ userID: 1, investmentID: 1, tradedAt: 1 });

module.exports = mongoose.model(
  "InvestmentTransaction",
  investmentTransactionSchema,
);
