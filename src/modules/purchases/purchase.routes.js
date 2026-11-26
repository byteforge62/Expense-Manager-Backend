const routes = require("express").Router();

const { requireAuth } = require("../../middleware/auth.middleware");
const validate = require("../../middleware/validate.middleware");
const idempotency = require("../../middleware/idempotency.middleware");
const { upload, validateImageSignature } = require("../../middleware/upload.middleware");
const { asyncHandler, sendSuccess } = require("../../utiles/response");

const service = require("./services/purchase.service");
const {
  uploadPurchaseImage,
  verifyImageToken,
  openPurchaseImage,
  signStoredImageUrl,
} = require("./services/purchase-image.service");
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

/** Absolute origin used to mint image links for this request. */
const baseUrlOf = (req) => `${req.protocol}://${req.get("host")}`;

/** Replaces the stored, token-free image reference with a fresh signed link. */
const withImageUrl = (purchase, req) =>
  purchase && {
    ...purchase,
    imageUrl: signStoredImageUrl(purchase.imageUrl, {
      userId: req.user.id,
      baseUrl: baseUrlOf(req),
    }),
  };

const listPurchases = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listPurchases(req.user.id, {
    ...req.query,
    requestId: req.id,
  });

  return sendSuccess(
    res,
    200,
    "Purchases fetched successfully",
    items.map((purchase) => withImageUrl(purchase, req)),
    meta,
  );
});

const getSummary = asyncHandler(async (req, res) => {
  const summary = await service.getPurchaseSummary(req.user.id, req.query);

  return sendSuccess(res, 200, "Purchase analytics fetched successfully", {
    ...summary,
    largest: (summary.largest || []).map((row) => withImageUrl(row, req)),
    recent: (summary.recent || []).map((row) => withImageUrl(row, req)),
  });
});

const getPurchase = asyncHandler(async (req, res) => {
  const purchase = await service.getPurchase(req.params.id, req.user.id);
  return sendSuccess(
    res,
    200,
    "Purchase fetched successfully",
    withImageUrl(purchase, req),
  );
});

const createPurchase = asyncHandler(async (req, res) => {
  const { purchase, warnings } = await service.createPurchase(
    req.body,
    req.user.id,
    { requestId: req.id },
  );

  return sendSuccess(res, 201, "Purchase recorded successfully", {
    ...withImageUrl(purchase, req),
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
    ...withImageUrl(purchase, req),
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

/**
 * Reads a product image through its signed, expiring link. The token is the
 * credential: `<img>` cannot send an Authorization header, and the signature
 * is bound to the owner and the exact storage key. There is no directory
 * listing and no unsigned read path.
 */
const serveImage = asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (typeof token !== "string" || !token) {
    return res.status(401).json({
      success: false,
      message: "A signed image link is required",
      requestId: req.id,
    });
  }

  let claim;

  try {
    claim = verifyImageToken(token);
  } catch (error) {
    const forbidden = error?.statusCode === 403;

    return res.status(forbidden ? 403 : 401).json({
      success: false,
      message: forbidden
        ? "This image link is not authorised"
        : "Invalid or expired image link",
      requestId: req.id,
    });
  }

  const image = await openPurchaseImage({
    userId: claim.userId,
    key: claim.key,
    file: req.params.file,
  });

  const stream = image.stream();

  // A file removed between the stat and the read, or a dropped object-storage
  // stream, must not take the process down with an unhandled 'error'.
  stream.on("error", () => {
    if (!res.headersSent) {
      return res.status(404).json({
        success: false,
        message: "Image not found",
        requestId: req.id,
      });
    }

    res.destroy();
  });

  res.setHeader("Content-Type", image.contentType);
  res.setHeader("Cache-Control", "private, max-age=300");
  // The SPA runs on a different origin, and only this signed route is meant to
  // be embedded cross-origin.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  if (image.contentLength != null) {
    res.setHeader("Content-Length", image.contentLength);
  }

  stream.pipe(res);
});

// Public only in the sense that it authenticates with the signed token.
routes.get("/images/:file", serveImage);

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
