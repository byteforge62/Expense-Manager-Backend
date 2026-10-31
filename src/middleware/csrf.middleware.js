const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const createCsrfProtection = (allowedOrigins) => {
  const trustedOrigins = new Set(allowedOrigins);

  return (req, res, next) => {
    // Safe HTTP methods do not change server-side state.
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    // Only enforce this check when authentication cookies are present.
    const hasAuthCookie = Boolean(
      req.cookies?.accessToken || req.cookies?.refreshToken,
    );

    if (!hasAuthCookie) {
      return next();
    }

    const origin = req.get("Origin");

    // Cookie-authenticated mutations must come from a trusted browser origin.
    if (!origin || !trustedOrigins.has(origin)) {
      return res.status(403).json({
        success: false,
        message: "Request origin not allowed",
      });
    }

    return next();
  };
};

module.exports = createCsrfProtection;
