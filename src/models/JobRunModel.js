const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Execution history for every background job run. One document per attempt
 * batch, keyed by an optional idempotency key so a retried job cannot run the
 * same work twice.
 */
const JobRunSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    trigger: {
      type: String,
      enum: ["schedule", "manual", "startup", "retry"],
      default: "schedule",
    },
    status: {
      type: String,
      enum: ["running", "succeeded", "failed", "skipped", "dead"],
      default: "running",
    },
    idempotencyKey: {
      type: String,
      default: undefined,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    finishedAt: {
      type: Date,
    },
    durationMs: {
      type: Number,
    },
    error: {
      type: String,
    },
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

JobRunSchema.index({ name: 1, startedAt: -1 }, { name: "job_history_by_name" });
JobRunSchema.index({ status: 1, startedAt: -1 }, { name: "job_history_by_status" });
JobRunSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
    name: "unique_job_idempotency_key",
  },
);
JobRunSchema.index({ createdAt: 1 }, { name: "job_history_retention" });

module.exports = mongoose.model("job_run", JobRunSchema);
