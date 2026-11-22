const routes = require("express").Router();

const { requireAuth } = require("../../middleware/auth.middleware");
const validate = require("../../middleware/validate.middleware");
const idempotency = require("../../middleware/idempotency.middleware");
const { upload, validateImageSignature } = require("../../middleware/upload.middleware");
const { asyncHandler, sendSuccess } = require("../../utiles/response");

const service = require("./services/purchase.service");
const { uploadPurchaseImage } = require("./services/purchase-image.service");
const {
  createPurchaseSchema,
  updatePurchaseSchema,
  purchaseListQuerySchema,
  purchaseSummaryQuerySchema,
  purchaseIdParamSchema,
} = require("./purchase.validation");

/**
 * Purchase records: the purchase log, its analytics, product-image upload and
 * the optional link to a matching expense. Handlers stay thin; the financial
 * rules live in services/purchase.service.js.
 */

const listPurchases = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listPurchases(req.user.id, {
    ...req.query,
    requestId: req.id,
  });

  return sendSuccess(
    res,
    200,
    "Purchases fetched successfully",
    items,
    meta,
  );
});

const getSummary = asyncHandler(async (req, res) => {
  const summary = await service.getPurchaseSummary(req.user.id, req.query);
  return sendSuccess(res, 200, "Purchase analytics fetched successfully", summary);
});

const getPurchase = asyncHandler(async (req, res) => {
  const purchase = await service.getPurchase(req.params.id, req.user.id);
  return sendSuccess(res, 200, "Purchase fetched successfully", purchase);
});

const createPurchase = asyncHandler(async (req, res) => {
  const { purchase, warnings } = await service.createPurchase(
    req.body,
    req.user.id,
    { requestId: req.id },
  );

  return sendSuccess(res, 201, "Purchase recorded successfully", {
    ...purchase,
    warnings,
  });
});

const updatePurchase = asyncHandler(async (req, res) => {
  const { purchase, warnings } = await service.updatePurchase(
    req.params.id,
    req.body,
    req.user.id,
    { requestId: req.id },
  );

  return sendSuccess(res, 200, "Purchase updated successfully", {
    ...purchase,
    warnings,
  });
});

const deletePurchase = asyncHandler(async (req, res) => {
  await service.deletePurchase(req.params.id, req.user.id, {
    requestId: req.id,
  });

  return sendSuccess(res, 200, "Purchase deleted successfully");
});

const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Select an image to upload",
      requestId: req.id,
    });
  }

  const stored = await uploadPurchaseImage(req.file, {
    userId: req.user.id,
    baseUrl: `${req.protocol}://${req.get("host")}`,
  });

  return sendSuccess(res, 201, "Product image uploaded successfully", stored);
});

routes.use(requireAuth);

routes.get("/me", validate({ query: purchaseListQuerySchema }), listPurchases);
routes.get(
  "/summary",
  validate({ query: purchaseSummaryQuerySchema }),
  getSummary,
);
routes.post(
  "/upload-image",
  upload.single("image"),
  validateImageSignature,
  uploadImage,
);
routes.post(
  "/",
  validate({ body: createPurchaseSchema }),
  idempotency(),
  createPurchase,
);
routes.get("/:id", validate({ params: purchaseIdParamSchema }), getPurchase);
routes.put(
  "/:id",
  validate({ params: purchaseIdParamSchema, body: updatePurchaseSchema }),
  idempotency(),
  updatePurchase,
);
routes.delete(
  "/:id",
  validate({ params: purchaseIdParamSchema }),
  idempotency(),
  deletePurchase,
);

module.exports = routes;
