const router = require("express").Router();
const mongoose = require("mongoose");
const JobRunModel = require("../models/JobRunModel");
const OutboxEventModel = require("../models/OutboxEventModel");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const asyncHandler = require("../middleware/asyncHandler");
const { sendSuccess } = require("../utiles/response");
const { getRuntimeStatus } = require("../infrastructure/bootstrap");

/**
 * Operational status for administrators.
 *
 * Deliberately shallow: health, job recency and queue depth. No connection
 * strings, secrets, payloads or financial data are exposed.
 */

const recentJobRuns = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const runs = await JobRunModel.find()
    .select("name trigger status attempts startedAt finishedAt durationMs error meta")
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();

  return sendSuccess(res, 200, "Recent job runs fetched successfully", runs);
});

const failedEvents = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const items = await OutboxEventModel.find({ status: { $in: ["failed", "dead"] } })
    .select("eventId name status attempts lastError availableAt createdAt")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return sendSuccess(res, 200, "Undelivered events fetched successfully", items);
});

const runtimeStatus = asyncHandler(async (req, res) =>
  sendSuccess(res, 200, "Runtime status fetched successfully", {
    ...getRuntimeStatus(),
    version: process.env.npm_package_version || "unknown",
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    mongodbDriver: mongoose.version,
  }),
);

router.use("/ops", requireAuth, requireRole("Admin"));

router.get("/ops/runtime", runtimeStatus);
router.get("/ops/jobs", recentJobRuns);
router.get("/ops/events", failedEvents);

module.exports = router;
