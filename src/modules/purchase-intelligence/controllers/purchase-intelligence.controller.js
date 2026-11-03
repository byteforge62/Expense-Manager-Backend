const asyncHandler = require("../../../middleware/asyncHandler");
const { sendSuccess } = require("../../../utiles/response");
const service = require("../services/purchase-intelligence.service");
const { resolveProductUrl } = require("../services/product-url.service");

const createProduct = asyncHandler(async (req, res) => {
  const product = await service.createProduct(req.body, req.user.id);
  return sendSuccess(res, 201, "Product added to Purchase Intelligence", product);
});

const listProducts = asyncHandler(async (req, res) => {
  const products = await service.listProducts(req.user.id);
  return sendSuccess(res, 200, "Tracked products fetched successfully", products);
});

const getProduct = asyncHandler(async (req, res) => {
  const product = await service.getProduct(req.params.id, req.user.id);
  return sendSuccess(res, 200, "Tracked product fetched successfully", product);
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await service.updateProduct(req.params.id, req.body, req.user.id);
  return sendSuccess(res, 200, "Tracked product updated successfully", product);
});

const deleteProduct = asyncHandler(async (req, res) => {
  await service.deleteProduct(req.params.id, req.user.id);
  return sendSuccess(res, 200, "Tracked product deleted successfully");
});

const importProductUrl = asyncHandler(async (req, res) => {
  const metadata = await resolveProductUrl(req.body.url);
  return sendSuccess(res, 200, "Available product metadata imported", metadata);
});

const analyzeProduct = asyncHandler(async (req, res) => {
  const { availableCash, purchasePrice } = req.body;
  const result = await service.analyzeProduct(req.params.id, req.user.id, availableCash, purchasePrice);
  return sendSuccess(res, 200, "Purchase affordability analysis completed", result);
});

module.exports = { createProduct, listProducts, getProduct, updateProduct, deleteProduct, analyzeProduct, importProductUrl };
