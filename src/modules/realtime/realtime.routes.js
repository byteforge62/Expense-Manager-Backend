const router = require("express").Router();
const jwt = require("jsonwebtoken");
const { requireAuth } = require("../../middleware/auth.middleware");
const realtime = require("./realtime.service");

/**
 * SSE endpoints.
 *
 * `EventSource` cannot send an Authorization header, so the flow is:
 *   1. POST /api/realtime/token  (normal Bearer auth) -> short-lived token
 *   2. GET  /api/realtime/stream?token=...             -> SSE stream
 *
 * The stream token is deliberately narrow: 60s lifetime, `scope: realtime`,
 * and it can only read that user's own event stream. The long-lived access
 * token never appears in URLs or proxy logs.
 */

const STREAM_TOKEN_TTL_SECONDS = 60;

const issueToken = async (req, res) => {
  const token = jwt.sign(
    { sub: req.user.id, scope: "realtime" },
    process.env.JWT_SECRET,
    { expiresIn: STREAM_TOKEN_TTL_SECONDS },
  );

  return res.status(200).json({
    success: true,
    message: "Realtime token issued",
    data: { token, expiresIn: STREAM_TOKEN_TTL_SECONDS },
  });
};

const openStream = (req, res) => {
  const { token } = req.query;

  if (typeof token !== "string" || token.length === 0) {
    return res.status(401).json({
      success: false,
      message: "Realtime token required",
    });
  }

  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired realtime token",
    });
  }

  if (decoded.scope !== "realtime" || !decoded.sub) {
    return res.status(403).json({
      success: false,
      message: "Realtime token is not authorised for streaming",
    });
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const entry = realtime.addConnection(decoded.sub, res);

  realtime.startHeartbeat();

  res.write(
    `event: ready\ndata: ${JSON.stringify({
      userId: decoded.sub,
      at: new Date().toISOString(),
    })}\n\n`,
  );

  req.on("close", () => {
    realtime.removeConnection(decoded.sub, entry);
    res.end();
  });

  return undefined;
};

router.post("/token", requireAuth, issueToken);
router.get("/stream", openStream);

module.exports = router;
