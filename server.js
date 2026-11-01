
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

if (process.env.NODE_ENV === "e2e") {
  dotenv.config({ path: ".env.e2e", override: true });
}

const validateEnv = require("./src/config/validateEnv");
validateEnv();

require("./src/utiles/recurringCron");

const app = require("./app");

const databaseVariable =
  process.env.NODE_ENV === "e2e"
    ? "MONGO_URI_E2E"
    : process.env.NODE_ENV === "test"
      ? "MONGO_URI_TEST"
      : "MONGO_URI";

const mongoUri = process.env[databaseVariable];

const PORT = process.env.NODE_ENV === "e2e"
  ? 3002
  : process.env.PORT || 3001;

mongoose
  .connect(mongoUri)
  .then(() => {
    console.log("Database connected successfully.");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  });
