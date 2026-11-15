const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

if (process.env.NODE_ENV === "e2e") {
  dotenv.config({ path: ".env.e2e", override: true, quiet: true });
}

const validateEnv = require("./src/config/validateEnv");
validateEnv();

const logger = require("./src/infrastructure/logger");
const {
  startInfrastructure,
  stopInfrastructure,
} = require("./src/infrastructure/bootstrap");

const app = require("./app");

const databaseVariable =
  process.env.NODE_ENV === "e2e"
    ? "MONGO_URI_E2E"
    : process.env.NODE_ENV === "test"
      ? "MONGO_URI_TEST"
      : "MONGO_URI";

const mongoUri = process.env[databaseVariable];

const PORT =
  process.env.NODE_ENV === "e2e" ? 3002 : process.env.PORT || 3001;

let server;
let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("server.shutdown_started", { signal });

  // Stop accepting scheduled work first so no new financial records are
  // created while the process is closing.
  await stopInfrastructure().catch((error) =>
    logger.error("server.infrastructure_stop_failed", { error }),
  );

  const forceExit = setTimeout(() => {
    logger.error("server.forced_exit", { signal });
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  await mongoose.connection.close().catch(() => {});

  clearTimeout(forceExit);
  logger.info("server.shutdown_completed", { signal });
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", { error: reason });
});

process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", { error });
  shutdown("uncaughtException");
});

mongoose
  .connect(mongoUri, {
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_MS) || 10_000,
  })
  .then(() => {
    logger.info("database.connected");

    // Build any missing indexes explicitly. `createIndexes` is additive: it
    // never drops an existing index, unlike `syncIndexes`.
    Promise.all(
      mongoose.modelNames().map((name) =>
        mongoose
          .model(name)
          .createIndexes()
          .catch((error) =>
            logger.warn("database.index_create_failed", { model: name, error }),
          ),
      ),
    ).then(() => logger.info("database.indexes_ensured"));

    startInfrastructure();

    server = app.listen(PORT, () => {
      logger.info("server.listening", {
        port: PORT,
        environment: process.env.NODE_ENV || "development",
      });
    });
  })
  .catch((error) => {
    logger.error("database.connection_failed", { error });
    process.exit(1);
  });
