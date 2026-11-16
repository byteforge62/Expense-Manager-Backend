const crypto = require("crypto");
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
 * The stream token is deliberately narrow: 60s lifetime, its own token type
 * and audience, and it is signed with a secret derived from JWT_SECRET that no
 * other issuer uses. An API access token therefore cannot open a stream, and a
 * stream token (which travels in a URL and may end up in proxy logs) cannot be
 * replayed as an API credential.
 */

const STREAM_TOKEN_TTL_SECONDS = 60;
const STREAM_TOKEN_TYPE = "realtime_stream";
const STREAM_TOKEN_AUDIENCE = "realtime";
const STREAM_SECRET_CONTEXT = "fintrack:realtime-stream-token:v1";

/** Domain-separated signing key: never the API JWT secret itself. */
const getStreamSecret = () =>
  crypto
    .createHmac("sha256", String(process.env.JWT_SECRET || ""))
    .update(STREAM_SECRET_CONTEXT)
    .digest("hex");

const signStreamToken = (userId) =>
  jwt.sign(
    {
      sub: String(userId),
      typ: STREAM_TOKEN_TYPE,
      scope: "realtime",
    },
    getStreamSecret(),
    {
      algorithm: "HS256",
      audience: STREAM_TOKEN_AUDIENCE,
      expiresIn: STREAM_TOKEN_TTL_SECONDS,
    },
  );

/**
 * Verifies a stream token.
 *
 * Throws on anything that is not a live, correctly-audienced stream token —
 * including a valid API access token, which fails both the signature check and
 * the `typ` check.
 */
const verifyStreamToken = (token) => {
  const decoded = jwt.verify(token, getStreamSecret(), {
    algorithms: ["HS256"],
    audience: STREAM_TOKEN_AUDIENCE,
  });

  if (decoded?.typ !== STREAM_TOKEN_TYPE || !decoded.sub) {
    const error = new Error("Realtime token is not authorised for streaming");
    error.statusCode = 403;
    throw error;
  }

  return decoded;
};

const issueToken = async (req, res) => {
  const token = signStreamToken(req.user.id);

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
    decoded = verifyStreamToken(token);
  } catch (error) {
    // Never echo the token itself back or into logs.
    return res.status(error.statusCode === 403 ? 403 : 401).json({
      success: false,
      message:
        error.statusCode === 403
          ? "Realtime token is not authorised for streaming"
          : "Invalid or expired realtime token",
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
module.exports.signStreamToken = signStreamToken;
module.exports.verifyStreamToken = verifyStreamToken;
module.exports.STREAM_TOKEN_TTL_SECONDS = STREAM_TOKEN_TTL_SECONDS;
module.exports.STREAM_TOKEN_TYPE = STREAM_TOKEN_TYPE;
module.exports.STREAM_TOKEN_AUDIENCE = STREAM_TOKEN_AUDIENCE;
