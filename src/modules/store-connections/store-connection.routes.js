const routes = require("express").Router();

const { requireAuth } = require("../../middleware/auth.middleware");
const validate = require("../../middleware/validate.middleware");
const { asyncHandler, sendSuccess } = require("../../utiles/response");

const service = require("./services/store-connection.service");
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

module.exports = routes;
