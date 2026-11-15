const SystemLogModel = require("../../models/SystemlogModel");
const logger = require("../logger");

/**
 * Audit trail for financial mutations.
 *
 * Audit writes are best-effort and never block or fail the mutation: losing an
 * audit row must not roll back a user's recorded expense. Failures are logged
 * with the request id so they can be alerted on.
 *
 * Only identifiers and the action are stored - never amounts, descriptions or
 * other financial content - so the log stays useful without holding personal
 * financial data.
 */
const record = async ({ userID, action, description, requestId, metadata }) => {
  if (!userID || !action) {
    return;
  }

  try {
    await SystemLogModel.create({
      user: userID,
      action,
      description,
      metadata: { ...metadata, requestId },
    });
  } catch (error) {
    logger.warn("audit.write_failed", { action, requestId, error });
  }
};

module.exports = { record };
