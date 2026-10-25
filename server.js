const mongoose = require("mongoose");
require("dotenv").config();
const validateEnv = require("./src/config/validateEnv");
validateEnv();
const jwtSecret = process.env.JWT_SECRET;

if (
  !jwtSecret ||
  jwtSecret.length < 32 ||
  jwtSecret === "your-secret-key" ||
  jwtSecret === "secret"
) {
  throw new Error(
    "JWT_SECRET must be configured with a strong secret of at least 32 characters.",
  );
}
require("./src/utiles/recurringCron");

const app = require("./app");

const mongoUri =
  process.env.NODE_ENV === "test"
    ? process.env.MONGO_URI_TEST
    : process.env.MONGO_URI;

mongoose
  .connect(mongoUri)
  .then(() => {
    console.log("🚀 Database connected successfully!");

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`✅ Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Failed to connect to the database:", err);
  });

