const mongoose = require("mongoose");
require("dotenv").config({ quiet: true });

jest.setTimeout(30000);

beforeAll(async () => {
  const mongoUri = process.env.MONGO_URI_TEST;

  if (!mongoUri) {
    throw new Error("MONGO_URI_TEST not defined");
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  });
});

afterAll(async () => {
  try {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
});
