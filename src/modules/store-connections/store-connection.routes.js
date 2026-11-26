const routes = require("express").Router();
const rateLimit = require("express-rate-limit");

const { requireAuth } = require("../../middleware/auth.middleware");
const { ForbiddenError } = require("../../errors/AppError");
const validate = require("../../middleware/validate.middleware");
const { asyncHandler, sendSuccess } = require("../../utiles/response");

const service = require("./services/store-connection.service");
const storeFetch = require("./services/store-fetch.service");
const {
  linkStoreSchema,
  importOrdersSchema,
  storeConnectionIdParamSchema,
} = require("./store-connection.validation");

/**
 * Store connections: link a store account, list what is linked, import that
 * store's orders into the purchase log, and unlink when the user is done.
 */

const listConnections = asyncHandler(async (req, res) => {
  const data = await service.listStoreConnections(req.user.id);
  return sendSuccess(res, 200, "Store connections fetched successfully", data);
});

const linkConnection = asyncHandler(async (req, res) => {
  const connection = await service.linkStoreAccount(req.user.id, req.body, {
    requestId: req.id,
  });

  return sendSuccess(res, 201, "Store account linked successfully", connection);
});

const unlinkConnection = asyncHandler(async (req, res) => {
  await service.unlinkStoreAccount(req.params.id, req.user.id, {
    requestId: req.id,
  });

  return sendSuccess(res, 200, "Store account unlinked successfully");
});

const importOrders = asyncHandler(async (req, res) => {
  const result = await service.importStoreOrders(
    req.params.id,
    req.user.id,
    req.body.orders,
    { requestId: req.id },
  );

  return sendSuccess(res, 200, "Store orders imported successfully", result);
});

/**
 * A fetch launches a real browser and walks several pages, so it is the most
 * expensive endpoint in the app. Five runs per ten minutes is plenty for a
 * person and stops a client from using it as a browser-spawning loop.
 */
const fetchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.STORE_FETCH_RATE_LIMIT) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many store fetches. Wait a few minutes and try again.",
  },
});

const fetchOrders = asyncHandler(async (req, res) => {
  if (!storeFetch.isLocalClient(req)) {
    throw new ForbiddenError(
      "Automatic fetch reads the store session of the computer running FinTrack, so it only works from a browser on that computer.",
    );
  }

  const data = await storeFetch.fetchStoreOrders(req.params.id, req.user.id, {
    requestId: req.id,
  });

  return sendSuccess(res, 200, "Store orders fetched successfully", data);
});

routes.use(requireAuth);

routes.get("/", listConnections);
routes.post("/", validate({ body: linkStoreSchema }), linkConnection);
routes.delete(
  "/:id",
  validate({ params: storeConnectionIdParamSchema }),
  unlinkConnection,
);
routes.post(
  "/:id/import",
  validate({ params: storeConnectionIdParamSchema, body: importOrdersSchema }),
  importOrders,
);
routes.post(
  "/:id/fetch",
  fetchLimiter,
  validate({ params: storeConnectionIdParamSchema }),
  fetchOrders,
);

module.exports = routes;
