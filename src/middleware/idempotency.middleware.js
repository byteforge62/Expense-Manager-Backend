const crypto = require("crypto");
const IdempotencyKeyModel = require("../models/IdempotencyKeyModel");
const logger = require("../infrastructure/logger");

/**
 * Idempotent financial mutations.
 *
 * Opt-in: only activates when the client sends `Idempotency-Key`, so existing
 * frontend requests are unchanged.
 *
 * Replaying a completed request returns the stored status and body instead of
 * creating a second financial record. A concurrent duplicate is rejected with
 * 409 rather than silently racing.
 */

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const TTL_MS = Number(process.env.IDEMPOTENCY_TTL_MS) || 24 * 60 * 60 * 1000;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const hashRequest = (req) =>
  crypto
    .createHash("sha256")
    .update(`${req.method}:${req.baseUrl}${req.path}:${JSON.stringify(req.body || {})}`)
    .digest("hex");

const idempotency = () => async (req, res, next) => {
  const key = req.get("Idempotency-Key");

  if (!key || !MUTATING_METHODS.has(req.method) || !req.user?.id) {
    return next();
  }

  if (!KEY_PATTERN.test(key)) {
    return res.status(400).json({
      success: false,
      message: "Idempotency-Key must be 8-128 characters of [A-Za-z0-9._:-]",
      requestId: req.id,
    });
  }

  const userID = req.user.id;
  const requestHash = hashRequest(req);
  const existing = await IdempotencyKeyModel.findOne({ userID, key }).lean();

  if (existing) {
    if (existing.requestHash && existing.requestHash !== requestHash) {
      return res.status(422).json({
        success: false,
        message:
          "Idempotency-Key was already used for a different request payload",
        requestId: req.id,
      });
    }

    if (existing.status === "completed") {
      res.setHeader("Idempotency-Replayed", "true");
      return res.status(existing.statusCode || 200).json(existing.responseBody);
    }

    return res.status(409).json({
      success: false,
      message: "A request with this Idempotency-Key is already in progress",
      requestId: req.id,
    });
  }

  try {
    await IdempotencyKeyModel.create({
      userID,
      key,
      method: req.method,
      path: `${req.baseUrl}${req.path}`,
      requestHash,
      status: "in_progress",
      expiresAt: new Date(Date.now() + TTL_MS),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A request with this Idempotency-Key is already in progress",
        requestId: req.id,
      });
    }

    // Never block a financial mutation because the ledger is unavailable.
    logger.error("idempotency.ledger_write_failed", { error, requestId: req.id });
    return next();
  }

  const originalJson = res.json.bind(res);
  let responded = false;

  res.json = (body) => {
    // Only definitive outcomes are replayed. A 5xx releases the key so the
    // client can retry the operation.
    const persist = res.statusCode < 500;

    if (!persist) {
      IdempotencyKeyModel.deleteOne({ userID, key }).catch(() => {});
      responded = true;
      return originalJson(body);
    }

    // The completion record is written *before* the response is flushed.
    // Otherwise an immediate client retry can observe `in_progress` and be
    // rejected even though the first request succeeded.
    const completion = IdempotencyKeyModel.updateOne(
      { userID, key },
      {
        $set: {
          status: "completed",
          statusCode: res.statusCode,
          responseBody: body,
        },
      },
    );

    Promise.resolve(completion)
      .catch((error) =>
        logger.warn("idempotency.complete_failed", { error, requestId: req.id }),
      )
      .finally(() => {
        responded = true;
        originalJson(body);
      });

    return res;
  };

  res.on("close", () => {
    // Client disconnected before a response was produced: free the key so the
    // operation can be retried. Never runs after a successful write.
    if (!responded && !res.writableEnded) {
      IdempotencyKeyModel.deleteOne({ userID, key }).catch(() => {});
    }
  });

  return next();
};

module.exports = idempotency;
