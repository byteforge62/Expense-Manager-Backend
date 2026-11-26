const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * A recorded product purchase.
 *
 * This is the durable purchase log (what was bought, from whom, for how much),
 * separate from PurchaseProduct (which is a watchlist / affordability tool).
 * A purchase may be linked to exactly one expense record so the same spend is
 * never counted twice: `linkedExpenseId` is unique when present.
 */
const purchaseSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    name: { type: String, trim: true, required: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000 },

    category: { type: String, trim: true, maxlength: 80, default: "Other" },
    merchant: { type: String, trim: true, maxlength: 120 },
    sourceWebsite: { type: String, trim: true, maxlength: 200 },
    productUrl: { type: String, trim: true, maxlength: 2048 },
    imageUrl: { type: String, trim: true, maxlength: 2048 },

    unitPrice: { type: Number, min: 0, required: true },
    quantity: { type: Number, min: 1, default: 1, required: true },
    // Stored (rather than derived on read) so aggregation and sorting stay
    // indexable and a later unit-price edit cannot silently rewrite history.
    totalAmount: { type: Number, min: 0, required: true },
    currency: { type: String, uppercase: true, trim: true, default: "INR", maxlength: 3 },

    purchaseDate: { type: Date, default: Date.now, required: true },

    orderId: { type: String, trim: true, maxlength: 120 },
    paymentMethod: { type: String, trim: true, maxlength: 60 },
    warrantyUntil: { type: Date },
    notes: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["ORDERED", "SHIPPED", "DELIVERED", "RETURNED", "CANCELLED"],
      default: "DELIVERED",
      index: true,
    },

    linkedExpenseId: {
      type: Schema.Types.ObjectId,
      ref: "expense",
      default: undefined,
    },

    // Where the record came from. STORE rows are written by a linked-store
    // import, so "only store purchases" needs no text matching and stays
    // indexable. Existing rows default to MANUAL.
    origin: {
      type: String,
      enum: ["MANUAL", "STORE"],
      default: "MANUAL",
      required: true,
    },
    storeConnectionId: {
      type: Schema.Types.ObjectId,
      ref: "StoreConnection",
      default: undefined,
    },
  },
  { timestamps: true },
);

purchaseSchema.index({ userID: 1, purchaseDate: -1, _id: -1 });
purchaseSchema.index({ userID: 1, category: 1, purchaseDate: -1 });
purchaseSchema.index({ userID: 1, merchant: 1, purchaseDate: -1 });
// Serves the "linked stores only" preference without scanning the log.
purchaseSchema.index({ userID: 1, origin: 1, purchaseDate: -1 });

// One purchase per order per user. Partial so the many purchases without an
// order id are unaffected (a unique index on a missing field would collide).
purchaseSchema.index(
  { userID: 1, orderId: 1 },
  {
    unique: true,
    partialFilterExpression: { orderId: { $type: "string" } },
    name: "unique_purchase_order_per_user",
  },
);

// An expense can back at most one purchase, which is what makes duplicate
// expense creation impossible rather than merely unlikely.
purchaseSchema.index(
  { linkedExpenseId: 1 },
  {
    unique: true,
    partialFilterExpression: { linkedExpenseId: { $type: "objectId" } },
    name: "unique_purchase_linked_expense",
  },
);

module.exports = mongoose.model("Purchase", purchaseSchema);
