
require("dotenv").config({
  path: ".env.e2e",
  quiet: true,
});

const mongoose = require("mongoose");

beforeAll(async () => {
  const mongoUri = process.env.MONGO_URI_E2E;

  if (!mongoUri) {
    throw new Error("MONGO_URI_E2E not defined in .env.e2e");
  }

  await mongoose.connect(mongoUri);
}, 30000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
