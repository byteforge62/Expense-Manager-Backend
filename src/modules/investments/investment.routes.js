const routes = require("express").Router();
const rateLimit = require("express-rate-limit");

const { requireAuth } = require("../../middleware/auth.middleware");
const validate = require("../../middleware/validate.middleware");
const idempotency = require("../../middleware/idempotency.middleware");
const { asyncHandler, sendSuccess } = require("../../utiles/response");
const { AppError } = require("../../errors/AppError");

const service = require("./investment.service");
const market = require("./market-data.service");
const {
  createHoldingSchema,
  updateHoldingSchema,
  investmentIdParamSchema,
  transactionIdParamSchema,
  createTransactionSchema,
  planSchema,
  quoteQuerySchema,
  searchQuerySchema,
} = require("./investment.validation");

/**
 * Investments: a paper portfolio valued with public market data, plus a
 * goal planner driven by the user's own recorded cash flow.
 */

const getPortfolio = asyncHandler(async (req, res) => {
  const portfolio = await service.getPortfolio(req.user.id);
  return sendSuccess(res, 200, "Portfolio fetched successfully", portfolio);
});

const getOverview = asyncHandler(async (req, res) => {
  const indices = await market.marketOverview();
  return sendSuccess(res, 200, "Market overview fetched successfully", {
    indices,
    source: "Yahoo Finance (delayed quotes, cached about a minute)",
    fetchedAt: new Date().toISOString(),
  });
});

const searchAssets = asyncHandler(async (req, res) => {
  const results = await market.searchAssets(req.query.q);
  return sendSuccess(res, 200, "Assets fetched successfully", results);
});

const getQuote = asyncHandler(async (req, res) => {
  try {
    const quote = await market.quote({
      kind: req.query.kind,
      symbol: req.query.symbol,
    });

    return sendSuccess(res, 200, "Quote fetched successfully", quote);
  } catch {
    throw new AppError(
      "Live market data is unavailable for this instrument right now.",
      502,
    );
  }
});

/**
 * Market data is proxied to keyless public providers and cached in-process, so
 * an unthrottled client could fill the cache and spend the free upstream quota
 * for everyone else. Quote and search share one budget per authenticated user:
 * keying by user rather than by IP keeps one person's loop from locking out a
 * shared network.
 */
const marketLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.INVESTMENT_MARKET_RATE_LIMIT) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.user?.id
      ? `user:${req.user.id}`
      : rateLimit.ipKeyGenerator(req.ip),
  message: {
    success: false,
    message: "Too many market data requests. Wait a minute and try again.",
  },
});

const plan = asyncHandler(async (req, res) => {
  const result = await service.planInvestment(req.user.id, req.body);
  return sendSuccess(res, 200, "Investment plan prepared successfully", result);
});

const createHolding = asyncHandler(async (req, res) => {
  const holding = await service.createHolding(req.user.id, req.body, {
    requestId: req.id,
  });

  return sendSuccess(res, 201, "Holding recorded successfully", holding);
});

const updateHolding = asyncHandler(async (req, res) => {
  const holding = await service.updateHolding(
    req.params.id,
    req.body,
    req.user.id,
    { requestId: req.id },
  );

  return sendSuccess(res, 200, "Holding updated successfully", holding);
});

const getTransactions = asyncHandler(async (req, res) => {
  const result = await service.listTransactions(req.params.id, req.user.id);
  return sendSuccess(res, 200, "Transactions fetched successfully", result);
});

const createTransaction = asyncHandler(async (req, res) => {
  const result = await service.addTransaction(
    req.params.id,
    req.user.id,
    req.body,
    { requestId: req.id },
  );

  return sendSuccess(res, 201, "Transaction recorded successfully", result);
});

const deleteTransaction = asyncHandler(async (req, res) => {
  const result = await service.removeTransaction(
    req.params.id,
    req.params.transactionId,
    req.user.id,
    { requestId: req.id },
  );

  return sendSuccess(res, 200, "Transaction removed successfully", result);
});

const deleteHolding = asyncHandler(async (req, res) => {
  await service.deleteHolding(req.params.id, req.user.id, {
    requestId: req.id,
  });

  return sendSuccess(res, 200, "Holding removed successfully");
});

routes.use(requireAuth);

routes.get("/", getPortfolio);
routes.get("/market/overview", getOverview);
routes.get(
  "/market/search",
  marketLimiter,
  validate({ query: searchQuerySchema }),
  searchAssets,
);
routes.get(
  "/market/quote",
  marketLimiter,
  validate({ query: quoteQuerySchema }),
  getQuote,
);
routes.post("/plan", validate({ body: planSchema }), plan);
routes.get(
  "/:id/transactions",
  validate({ params: investmentIdParamSchema }),
  getTransactions,
);
routes.post(
  "/:id/transactions",
  validate({ params: investmentIdParamSchema, body: createTransactionSchema }),
  idempotency(),
  createTransaction,
);
routes.delete(
  "/:id/transactions/:transactionId",
  validate({ params: transactionIdParamSchema }),
  idempotency(),
  deleteTransaction,
);
routes.post("/", validate({ body: createHoldingSchema }), idempotency(), createHolding);
routes.put(
  "/:id",
  validate({ params: investmentIdParamSchema, body: updateHoldingSchema }),
  idempotency(),
  updateHolding,
);
routes.delete(
  "/:id",
  validate({ params: investmentIdParamSchema }),
  idempotency(),
  deleteHolding,
);

module.exports = routes;
