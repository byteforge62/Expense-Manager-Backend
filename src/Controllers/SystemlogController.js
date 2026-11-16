const SystemLog = require("../models/SystemlogModel");
const { asyncHandler } = require("../utiles/response");
const { sendSuccess } = require("../utiles/response");

/**
 * Lists audit log entries.
 *
 * Failures are forwarded to the global error middleware, so the response uses
 * the same `{ success, message, requestId }` envelope as every other endpoint
 * instead of a one-off `{ success: false, error }` body.
 */
const getLogs = asyncHandler(async (req, res) => {
  const logs = await SystemLog.find().sort({ createdAt: -1 }).lean();

  return sendSuccess(res, 200, "Logs fetched successfully", logs);
});

module.exports = {
  getLogs,
};
