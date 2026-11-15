/**
 * Structured JSON logger.
 *
 * Goals:
 * - Machine-readable single-line JSON so logs can be shipped/aggregated.
 * - Stable fields: level, time, msg, plus bound context.
 * - Redaction of credentials and financial identifiers before they ever
 *   reach stdout.
 *
 * This is intentionally dependency free: the deployment target is a single
 * container and adding a logging framework gives no operational benefit.
 */

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const REDACTED = "[redacted]";

// Keys whose values must never be logged. Compared lowercased.
const REDACT_KEYS = new Set([
  "password",
  "currentpassword",
  "newpassword",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "setcookie",
  "secret",
  "jwt",
  "jwtsecret",
  "refreshsecret",
  "apikey",
  "api_key",
  "idempotencykey",
  "cardnumber",
  "cvv",
  "ssn",
  "accountnumber",
  "email",
]);

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 4000;

const shouldRedact = (key) => REDACT_KEYS.has(String(key).toLowerCase());

const scrub = (value, depth = 0) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code,
      // Stack traces stay in the log stream, never in API responses.
      stack: value.stack,
    };
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (depth >= MAX_DEPTH) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => scrub(item, depth + 1));
  }

  const result = {};

  for (const [key, nested] of Object.entries(value)) {
    result[key] = shouldRedact(key) ? REDACTED : scrub(nested, depth + 1);
  }

  return result;
};

const currentLevel = () => {
  const configured = String(process.env.LOG_LEVEL || "").toLowerCase();

  if (configured && LEVELS[configured] !== undefined) {
    return LEVELS[configured];
  }

  return process.env.NODE_ENV === "test" ? LEVELS.silent : LEVELS.info;
};

const write = (level, message, context) => {
  if (LEVELS[level] < currentLevel()) {
    return;
  }

  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(context && typeof context === "object" ? scrub(context) : {}),
  };

  const line = JSON.stringify(entry);

  if (LEVELS[level] >= LEVELS.error) {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
};

const createLogger = (bound = {}) => ({
  child: (extra = {}) => createLogger({ ...bound, ...extra }),
  debug: (message, context) => write("debug", message, { ...bound, ...context }),
  info: (message, context) => write("info", message, { ...bound, ...context }),
  warn: (message, context) => write("warn", message, { ...bound, ...context }),
  error: (message, context) => write("error", message, { ...bound, ...context }),
});

const logger = createLogger();

module.exports = logger;
module.exports.LEVELS = LEVELS;
module.exports.scrub = scrub;
module.exports.createLogger = createLogger;
