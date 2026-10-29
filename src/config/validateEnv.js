
const validateEnv = () => {
  const requiredVariables = [
    "JWT_SECRET",
    "REFRESH_SECRET",
    "MONGO_URI",
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
      throw new Error(
        `${name} must contain at least 32 characters.`,
      );
    }
  }

  if (
    process.env.JWT_SECRET === "your-secret-key" ||
    process.env.JWT_SECRET === "secret"
  ) {
    throw new Error(
      "JWT_SECRET must be configured with a strong secret.",
    );
  }
};

module.exports = validateEnv;
