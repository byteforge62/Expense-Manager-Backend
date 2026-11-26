const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * A store account the user has linked to their purchase log.
 *
 * Only the label the user typed and the sync bookkeeping are stored here: no
 * store password, token or cookie is ever collected. One account per store per
 * user, which makes "link" idempotent at the database level.
 */
const storeConnectionSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 60,
    },
    // What the user called the account at that store (email or phone). A label,
    // not a credential.
    accountLabel: { type: String, trim: true, maxlength: 160, required: true },

    status: {
      type: String,
      enum: ["LINKED", "ERROR"],
      default: "LINKED",
    },
    lastError: { type: String, trim: true, maxlength: 500 },

    lastSyncedAt: { type: Date },
    lastImportCount: { type: Number, min: 0, default: 0 },
    // The last successful automatic read, kept so the page can show the
    // "fetched" state after a reload instead of losing it with the dialog.
    lastFetchedAt: { type: Date },
    lastFetchCount: { type: Number, min: 0 },
    totalImported: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

storeConnectionSchema.index(
  { userID: 1, provider: 1 },
  { unique: true, name: "unique_store_connection_per_user" },
);

module.exports = mongoose.model("StoreConnection", storeConnectionSchema);
