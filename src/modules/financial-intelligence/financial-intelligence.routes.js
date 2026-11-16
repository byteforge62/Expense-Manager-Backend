const routes = require("express").Router();

const { requireAuth } = require("../../middleware/auth.middleware");
const validate = require("../../middleware/validate.middleware");
const { asyncHandler, sendSuccess } = require("../../utiles/response");

const service = require("./services/financial-intelligence.service");
const { overviewQuerySchema } = require("./financial-intelligence.validation");

/**
 * Financial intelligence endpoints.
 *
 * Router plus its (thin) handler; the analysis itself lives in services/ and
 * engines/.
 */

const getOverview = asyncHandler(async (req, res) => {
  const result = await service.generateFinancialIntelligence({
    userId: req.user.id,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  });

  return sendSuccess(
    res,
    200,
    "Financial intelligence generated successfully",
    result,
  );
});

routes.use(requireAuth);

routes.get("/overview", validate({ query: overviewQuerySchema }), getOverview);

module.exports = routes;
