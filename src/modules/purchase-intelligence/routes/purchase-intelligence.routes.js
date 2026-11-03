const routes = require("express").Router();
const { requireAuth } = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/validate.middleware");
const controller = require("../controllers/purchase-intelligence.controller");
const {
  createPurchaseProductSchema,
  updatePurchaseProductSchema,
  analyzePurchaseSchema,
  resolveProductUrlSchema,
  purchaseIdParamSchema,
} = require("../validations/purchase.validation");

routes.use(requireAuth);
routes.get("/", controller.listProducts);
routes.post("/", validate({ body: createPurchaseProductSchema }), controller.createProduct);
routes.post("/resolve-url", validate({ body: resolveProductUrlSchema }), controller.importProductUrl);
routes.get("/:id", validate({ params: purchaseIdParamSchema }), controller.getProduct);
routes.patch("/:id", validate({ params: purchaseIdParamSchema, body: updatePurchaseProductSchema }), controller.updateProduct);
routes.delete("/:id", validate({ params: purchaseIdParamSchema }), controller.deleteProduct);
routes.post("/:id/analyze", validate({ params: purchaseIdParamSchema, body: analyzePurchaseSchema }), controller.analyzeProduct);

module.exports = routes;
