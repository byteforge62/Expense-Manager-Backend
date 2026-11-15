const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Transactional outbox.
 *
 * Domain writes and event publication cannot share a MongoDB transaction on
 * every supported deployment (a standalone mongod has no replica set), so the
 * event row is written immediately after the primary financial write and a
 * dispatcher drains it at-least-once. Consumers are idempotent, therefore
 * redelivery is safe.
 */
const OutboxEventSchema = new Schema(
  {
    eventId: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ["pending", "processing", "dispatched", "failed", "dead"],
      default: "pending",
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastError: {
      type: String,
    },
    availableAt: {
      type: Date,
      default: Date.now,
    },
    lockedUntil: {
      type: Date,
    },
    processedAt: {
      type: Date,
    },
    dedupeKey: {
      type: String,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

OutboxEventSchema.index({ eventId: 1 }, { unique: true, name: "unique_outbox_event" });

OutboxEventSchema.index(
  { dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: "string" } },
    name: "unique_outbox_dedupe_key",
  },
);

OutboxEventSchema.index({ status: 1, availableAt: 1 }, { name: "outbox_dispatch_scan" });
OutboxEventSchema.index({ createdAt: 1 }, { name: "outbox_retention" });

module.exports = mongoose.model("outbox_event", OutboxEventSchema);
