const StoreConnectionModel = require("../models/StoreConnectionModel");
const PurchaseModel = require("../../purchases/models/PurchaseModel");
const { STORE_PROVIDERS, findProvider } = require("../store-catalog");

const audit = require("../../../infrastructure/audit.service");
const logger = require("../../../infrastructure/logger");
const {
  ConflictError,
  NotFoundError,
  ValidationError,
} = require("../../../errors/AppError");

/**
 * Store connection service.
 *
 * A connection is bookkeeping, not a credential: it says "this user linked
 * their Amazon account label" and remembers what was imported. Orders arrive
 * through `importOrders`, which writes ordinary Purchase records, so imported
 * purchases behave exactly like manually recorded ones (analytics, filters,
 * expense links) and are deduplicated by the store's order id.
 */

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const getConnectionDocument = async (connectionId, userId) => {
  const connection = await StoreConnectionModel.findOne({
    _id: connectionId,
    userID: userId,
  });

  if (!connection) {
    throw new NotFoundError("Connected store account not found");
  }

  return connection;
};

const listStoreConnections = async (userId) => {
  const connections = await StoreConnectionModel.find({ userID: userId })
    .sort({ createdAt: 1 })
    .lean();

  return {
    stores: STORE_PROVIDERS,
    connections: connections.map((connection) => ({
      ...connection,
      providerName: findProvider(connection.provider)?.name || connection.provider,
    })),
  };
};

const linkStoreAccount = async (userId, { provider, accountLabel }, context = {}) => {
  const store = findProvider(provider);

  if (!store) {
    throw new ValidationError("Choose a supported store");
  }

  let connection;

  try {
    connection = await StoreConnectionModel.create({
      userID: userId,
      provider: store.key,
      accountLabel,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new ConflictError("This store is already linked to your account");
    }

    throw error;
  }

  audit.record({
    userID: userId,
    action: "store_connection.linked",
    description: `Linked ${store.name}`,
    requestId: context.requestId,
    metadata: { provider: store.key },
  });

  return { ...connection.toObject(), providerName: store.name };
};

const unlinkStoreAccount = async (connectionId, userId, context = {}) => {
  const connection = await StoreConnectionModel.findOneAndDelete({
    _id: connectionId,
    userID: userId,
  });

  if (!connection) {
    throw new NotFoundError("Connected store account not found");
  }

  audit.record({
    userID: userId,
    action: "store_connection.unlinked",
    description: `Unlinked ${connection.provider}`,
    requestId: context.requestId,
    metadata: { provider: connection.provider },
  });

  return connection;
};

/**
 * Imports store orders into the purchase log.
 *
 * Rows whose order id is already recorded are skipped, so linking a store and
 * importing the same export twice never double-counts spending. Imported rows
 * are inserted in one write; a partial failure still reports how many landed.
 */
const importStoreOrders = async (connectionId, userId, orders, context = {}) => {
  const connection = await getConnectionDocument(connectionId, userId);
  const store = findProvider(connection.provider);

  if (!store) {
    throw new ValidationError("This store is no longer supported");
  }

  const candidates = orders.map((order) => ({
    userID: userId,
    name: order.name,
    category: order.category || "Other",
    merchant: store.name,
    sourceWebsite: store.website || store.key,
    productUrl: order.productUrl,
    unitPrice: roundMoney(order.unitPrice),
    quantity: order.quantity ?? 1,
    totalAmount: roundMoney(order.unitPrice * (order.quantity ?? 1)),
    purchaseDate: order.purchaseDate ?? new Date(),
    orderId: order.orderId,
    status: order.status || "DELIVERED",
    notes: `Imported from ${store.name}`,
  }));

  const orderIds = [...new Set(candidates.map((order) => order.orderId))];
  const existing = await PurchaseModel.find({
    userID: userId,
    orderId: { $in: orderIds },
  })
    .select("orderId")
    .lean();
  const recorded = new Set(existing.map((row) => row.orderId));

  const fresh = candidates.filter((order) => !recorded.has(order.orderId));
  let imported = 0;

  if (fresh.length > 0) {
    try {
      const inserted = await PurchaseModel.insertMany(fresh, { ordered: false });
      imported = inserted.length;
    } catch (error) {
      // ordered:false keeps every valid row; duplicates are the expected race.
      imported = error?.insertedDocs?.length ?? error?.result?.insertedCount ?? 0;

      logger.warn("store_connection.import_partial", {
        provider: store.key,
        attempted: fresh.length,
        imported,
        error,
      });

      if (error?.code !== 11000 && !error?.writeErrors) {
        throw error;
      }
    }
  }

  connection.status = "LINKED";
  connection.lastError = undefined;
  connection.lastSyncedAt = new Date();
  connection.lastImportCount = imported;
  connection.totalImported = (connection.totalImported || 0) + imported;
  await connection.save();

  audit.record({
    userID: userId,
    action: "store_connection.imported",
    description: `Imported ${imported} orders from ${store.name}`,
    requestId: context.requestId,
    metadata: { provider: store.key, imported },
  });

  return {
    imported,
    duplicates: orders.length - imported,
    connection: { ...connection.toObject(), providerName: store.name },
  };
};

module.exports = {
  listStoreConnections,
  linkStoreAccount,
  unlinkStoreAccount,
  importStoreOrders,
};
