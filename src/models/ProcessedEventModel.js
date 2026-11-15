const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Consumer ledger for at-least-once event delivery.
 *
 * The outbox can deliver an event more than once (worker crash after commit,
 * retry after a partial failure). A unique (eventId, consumer) row lets each
 * consumer run at most once per event. The row is removed when the consumer
 * fails, so a retry is still able to make progress.
 */
const ProcessedEventSchema = new Schema(
  {
    eventId: {
      type: String,
      required: true,
    },
    consumer: {
      type: String,
      required: true,
    },
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  },
);

ProcessedEventSchema.index(
  { eventId: 1, consumer: 1 },
  { unique: true, name: "unique_processed_event_consumer" },
);
ProcessedEventSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30, name: "processed_event_ttl" },
);

module.exports = mongoose.model("processed_event", ProcessedEventSchema);
