const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Idempotency ledger for financial mutations.
 *
 * Only used when the client sends an `Idempotency-Key` header, so existing
 * frontend behaviour is unchanged. A unique (user, key) index means a retried
 * POST/PUT/PATCH/DELETE replays the stored response instead of creating a
 * second financial record.
 *
 * A TTL index expires entries automatically; the window is intentionally short
 * (24h by default) because clients only retry within seconds or minutes.
 */
const IdempotencyKeySchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    key: {
      type: String,
      required: true,
    },
    method: {
      type: String,
      required: true,
    },
    path: {
      type: String,
      required: true,
    },
    requestHash: {
      type: String,
    },
    status: {
      type: String,
      enum: ["in_progress", "completed"],
      default: "in_progress",
    },
    statusCode: {
      type: Number,
    },
    responseBody: {
      type: Schema.Types.Mixed,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

IdempotencyKeySchema.index(
  { userID: 1, key: 1 },
  { unique: true, name: "unique_idempotency_key" },
);
IdempotencyKeySchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "idempotency_ttl" },
);

module.exports = mongoose.model("idempotency_key", IdempotencyKeySchema);
