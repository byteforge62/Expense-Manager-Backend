const jwt = require("jsonwebtoken");
const UserModel = require("../models/UserModel");

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    const token = authHeader
      ? /^Bearer\s+(\S+)$/i.exec(authHeader)?.[1]
      : req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // SSE stream tokens are scoped to /api/realtime/stream and must never
    // be accepted as ordinary API credentials.
    if (decoded?.typ === "realtime_stream" || decoded?.aud === "realtime") {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    // The purchase preference travels with the session lookup that already
    // happens on every request, so enforcing it costs no extra query.
    const user = await UserModel.findById(decoded.id).select(
      "_id role is_active purchasePreferences",
    );

    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    req.user = {
      id: user._id.toString(),
      role: user.role,
      purchasePreferences: user.purchasePreferences || {},
    };

    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    next();
  };
};

module.exports = {
  requireAuth,
  requireRole,
};
