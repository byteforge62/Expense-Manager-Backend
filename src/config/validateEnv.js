
/**
 * Base URL used to build absolute links (password reset).
 * Configured via CLIENT_URL; development and test fall back to the local dev
 * server. Production must configure it, so no environment's domain is ever
 * hardcoded in source.
 */
const DEFAULT_CLIENT_URL = "http://localhost:5173";

const getClientBaseUrl = () => {
  const configured = (process.env.CLIENT_URL || "").trim();
  const fallback =
    process.env.NODE_ENV === "production" ? "" : DEFAULT_CLIENT_URL;
  const raw = configured || fallback;

  if (!raw) {
    throw new Error(
      "CLIENT_URL must be set in production so password-reset links are absolute.",
    );
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CLIENT_URL must be a valid absolute URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("CLIENT_URL must use http or https.");
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
};

const validateEnv = () => {
  const isE2E = process.env.NODE_ENV === "e2e";
  const isTest = process.env.NODE_ENV === "test";

  const requiredVariables = [
    "JWT_SECRET",
    "REFRESH_SECRET",
    isE2E ? "MONGO_URI_E2E" : isTest ? "MONGO_URI_TEST" : "MONGO_URI",
  ];

  const missingVariables = requiredVariables.filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVariables.join(", ")}`,
    );
  }

  // Fails fast when reset links could not be built or would point nowhere.
  getClientBaseUrl();

  for (const name of ["JWT_SECRET", "REFRESH_SECRET"]) {
    const secret = process.env[name];

    if (secret.length < 32) {
      throw new Error(`${name} must contain at least 32 characters.`);
    }

    if (["your-secret-key", "secret"].includes(secret)) {
      throw new Error(`${name} must use a strong secret.`);
    }
  }
};

module.exports = validateEnv;
module.exports.getClientBaseUrl = getClientBaseUrl;
