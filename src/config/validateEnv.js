
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
