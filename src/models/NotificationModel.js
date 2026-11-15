const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * In-app notifications.
 *
 * `dedupeKey` makes creation idempotent: a unique partial index plus an upsert
 * guarantees that re-running a job (or retrying an event consumer) can never
 * produce the same alert twice for the same user.
 */
const NotificationSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: [
        "budget",
        "bill",
        "recurring",
        "anomaly",
        "recommendation",
        "system",
      ],
      default: "system",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    title: {
      type: String,
      required: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
    dedupeKey: {
      type: String,
      default: undefined,
    },
    readAt: {
      type: Date,
      default: undefined,
    },
    expiresAt: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

NotificationSchema.index(
  { userID: 1, createdAt: -1 },
  { name: "notification_inbox" },
);
NotificationSchema.index(
  { userID: 1, readAt: 1, createdAt: -1 },
  { name: "notification_unread" },
);
NotificationSchema.index(
  { userID: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { type: "string" } },
    name: "unique_notification_dedupe",
  },
);
NotificationSchema.index({ expiresAt: 1 }, { name: "notification_expiry" });

module.exports = mongoose.model("notification", NotificationSchema);
