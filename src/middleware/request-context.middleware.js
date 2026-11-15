const crypto = require("crypto");
const logger = require("../infrastructure/logger");

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Assigns every request a correlation id, exposes it to handlers/logs and
 * emits one structured access log line when the response finishes.
 *
 * The id is echoed in the X-Request-Id response header so a user report can be
 * tied to server logs without exposing internals.
 */
const requestContext = (req, res, next) => {
  const incoming = req.get("x-request-id");
  const requestId =
    incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();

  req.id = requestId;
  req.startTime = process.hrtime.bigint();
  req.log = logger.child({ requestId, method: req.method, path: req.path });

  res.setHeader("X-Request-Id", requestId);

  const slowThresholdMs = Number(process.env.SLOW_REQUEST_MS) || 500;

  res.on("finish", () => {
    const durationMs =
      Number(process.hrtime.bigint() - req.startTime) / 1_000_000;

    const log = {
      requestId,
      method: req.method,
      // Query strings are excluded on purpose: they can contain user search
      // terms and other personal data.
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      userId: req.user?.id,
      // Never log the request body: it contains financial records.
    };

    if (res.statusCode >= 500) {
      req.log.error("request.completed", log);
    } else if (durationMs >= slowThresholdMs) {
      req.log.warn("request.slow", log);
    } else {
      req.log.info("request.completed", log);
    }
  });

  next();
};

module.exports = requestContext;
