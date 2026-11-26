const { spawn } = require("child_process");
const path = require("path");

const StoreConnectionModel = require("../models/StoreConnectionModel");
const { findProvider } = require("../store-catalog");
const audit = require("../../../infrastructure/audit.service");
const logger = require("../../../infrastructure/logger");
const {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} = require("../../../errors/AppError");

/**
 * Automatic store import.
 *
 * No marketplace offers a consumer order API, so the only honest automatic
 * read is the account holder's own signed-in browser. This service runs
 * `scripts/fetch-store-orders.js`, which opens Chrome on the machine running
 * the API, reads the order cards the store renders, and prints them as JSON.
 * Nothing is written here: the orders go back to the app, and the user imports
 * them explicitly through `importStoreOrders` (same dedupe by order id).
 *
 * Store cookies never leave that local Chrome profile.
 */

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..", "..");
const SCRIPT_PATH = path.join(PROJECT_ROOT, "scripts", "fetch-store-orders.js");

const WAIT_SECONDS = Number(process.env.STORE_FETCH_WAIT_SECONDS) || 180;
const RUN_TIMEOUT_MS = (WAIT_SECONDS + 90) * 1000;
const MAX_STDOUT = 5 * 1024 * 1024;

// One browser run per connection at a time: a second Chrome window would race
// for the same profile and confuse the user.
const running = new Set();

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * The fetch reads the browser session of whoever is signed in on the machine
 * running this API. Offering it to a remote client would hand one account the
 * store session (and orders) of the person sitting at the computer, so it is
 * limited to a client on the same machine.
 *
 * Only the socket address is trusted: `X-Forwarded-For` and similar headers are
 * client-controlled and are deliberately ignored.
 */
const isLocalClient = (request) => {
  const raw = String(request?.socket?.remoteAddress || request?.ip || "");
  const address = raw.startsWith("::ffff:") ? raw.slice(7) : raw;

  return address === "127.0.0.1" || address === "::1" || address === "localhost";
};

const lastJsonLine = (output) => {
  const lines = output.split(/\r?\n/).filter((line) => line.trim());

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();

    if (!line.startsWith("{")) continue;

    try {
      return JSON.parse(line);
    } catch {
      /* not the payload line */
    }
  }

  return null;
};

const runFetcher = (provider) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        SCRIPT_PATH,
        "--store",
        provider,
        "--fetch-only",
        "--json",
        "--wait",
        String(WAIT_SECONDS),
      ],
      {
        cwd: PROJECT_ROOT,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(
        new AppError(
          `The store page could not be read within ${WAIT_SECONDS}s. Sign in to the store in the Chrome window it opened, then try again.`,
          504,
        ),
      );
    }, RUN_TIMEOUT_MS);

    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();

      if (stdout.length > MAX_STDOUT) {
        child.kill();
        finish(new AppError("The store returned more data than expected.", 502));
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on("error", (error) =>
      finish(
        new AppError(
          `The store fetch helper could not start: ${error.message}`,
          502,
        ),
      ),
    );

    child.on("close", () => {
      const payload = lastJsonLine(stdout);

      if (Array.isArray(payload?.orders)) {
        finish(null, payload.orders);
        return;
      }

      if (payload?.error) {
        finish(new AppError(payload.error, 400));
        return;
      }

      logger.warn("store_fetch.no_payload", { provider, stderr });
      finish(
        new AppError(
          stderr.trim().split(/\r?\n/).pop() ||
            "The store fetch did not return any orders.",
          502,
        ),
      );
    });
  });

const cleanOrder = (order) => ({
  orderId: String(order.orderId).slice(0, 120),
  name: String(order.name).slice(0, 160),
  unitPrice: roundMoney(order.unitPrice),
  quantity: Math.min(Math.max(Number(order.quantity) || 1, 1), 9999),
  ...(order.purchaseDate ? { purchaseDate: order.purchaseDate } : {}),
});

const fetchStoreOrders = async (connectionId, userId, context = {}) => {
  const connection = await StoreConnectionModel.findOne({
    _id: connectionId,
    userID: userId,
  });

  if (!connection) {
    throw new NotFoundError("Connected store account not found");
  }

  const store = findProvider(connection.provider);

  if (!store) {
    throw new ValidationError("This store is no longer supported");
  }

  const key = String(connection._id);

  if (running.has(key)) {
    throw new ConflictError(
      "This store is already being read. Finish the Chrome window it opened, or close it and try again.",
    );
  }

  running.add(key);

  try {
    const raw = await runFetcher(store.key);

    const orders = raw
      .map(cleanOrder)
      .filter(
        (order) =>
          order.orderId.length > 0 &&
          order.name.length >= 2 &&
          Number.isFinite(order.unitPrice) &&
          order.unitPrice >= 0,
      );

    // Persisted fetch state: the page can show "read N orders" after a reload
    // instead of the result vanishing with the dialog. Nothing is imported here.
    connection.lastError = undefined;
    connection.lastFetchedAt = new Date();
    connection.lastFetchCount = orders.length;
    await connection.save();

    audit.record({
      userID: userId,
      action: "store_connection.fetched",
      description: `Read ${orders.length} orders from ${store.name}`,
      requestId: context.requestId,
      metadata: { provider: store.key, found: orders.length },
    });

    return {
      store: { key: store.key, name: store.name },
      connection: { ...connection.toObject(), providerName: store.name },
      orders,
      total: roundMoney(
        orders.reduce(
          (sum, order) => sum + order.unitPrice * (order.quantity || 1),
          0,
        ),
      ),
    };
  } catch (error) {
    connection.lastError = error.message;

    await connection.save().catch(() => {});

    throw error;
  } finally {
    running.delete(key);
  }
};

module.exports = { fetchStoreOrders, isLocalClient, SCRIPT_PATH };
