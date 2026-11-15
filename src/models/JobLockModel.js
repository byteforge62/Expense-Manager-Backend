const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Cross-process mutual exclusion for scheduled work.
 *
 * A TTL-free lease document with a unique job name: acquisition is a single
 * atomic upsert/update, so two application instances can never execute the
 * same scheduled job concurrently. Expired leases are reclaimable, which makes
 * a crashed worker recoverable without manual intervention.
 */
const JobLockSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    owner: {
      type: String,
      required: true,
    },
    acquiredAt: {
      type: Date,
      default: Date.now,
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

JobLockSchema.index({ name: 1 }, { unique: true, name: "unique_job_lock" });
JobLockSchema.index({ expiresAt: 1 }, { name: "job_lock_expiry" });

module.exports = mongoose.model("job_lock", JobLockSchema);
