const mongoose = require("mongoose");
const { Schema } = mongoose;

const retailerListingSchema = new Schema(
  {
    platform: { type: String, trim: true, maxlength: 80, required: true },
    url: { type: String, trim: true, maxlength: 2048 },
    price: { type: Number, min: 0, required: true },
    currency: { type: String, uppercase: true, default: "INR", maxlength: 3 },
    observedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ["USER_ENTERED"], default: "USER_ENTERED" },
  },
  { _id: true },
);

const priceObservationSchema = new Schema(
  {
    price: { type: Number, min: 0, required: true },
    platform: { type: String, trim: true, maxlength: 80 },
    observedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ["USER_ENTERED"], default: "USER_ENTERED" },
  },
  { _id: false },
);

const analysisSchema = new Schema(
  {
    availableCash: { type: Number, min: 0, required: true },
    purchasePrice: { type: Number, min: 0, required: true },
    result: { type: Schema.Types.Mixed, required: true },
    analyzedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const purchaseProductSchema = new Schema(
  {
    userID: { type: Schema.Types.ObjectId, ref: "users", required: true, index: true },
    name: { type: String, trim: true, required: true, maxlength: 160 },
    category: { type: String, trim: true, maxlength: 80, default: "Other" },
    brand: { type: String, trim: true, maxlength: 100 },
    model: { type: String, trim: true, maxlength: 100 },
    productUrl: { type: String, trim: true, maxlength: 2048 },
    imageUrl: { type: String, trim: true, maxlength: 2048 },
    status: {
      type: String,
      enum: ["CONSIDERING", "WATCHLIST", "PURCHASED", "CANCELLED"],
      default: "CONSIDERING",
      index: true,
    },
    currentPrice: { type: Number, min: 0, required: true },
    targetPrice: { type: Number, min: 0 },
    currency: { type: String, uppercase: true, default: "INR", maxlength: 3 },
    listings: { type: [retailerListingSchema], default: [] },
    priceHistory: { type: [priceObservationSchema], default: [] },
    purchasePrice: { type: Number, min: 0 },
    purchaseDate: { type: Date },
    paymentMethod: { type: String, trim: true, maxlength: 60 },
    notes: { type: String, trim: true, maxlength: 1000 },
    lastAnalysis: { type: analysisSchema, default: null },
  },
  { timestamps: true },
);

purchaseProductSchema.index({ userID: 1, updatedAt: -1 });
purchaseProductSchema.index({ userID: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model("PurchaseProduct", purchaseProductSchema);
