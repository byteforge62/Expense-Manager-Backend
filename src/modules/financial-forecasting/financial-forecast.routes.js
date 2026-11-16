const routes = require("express").Router();

const { requireAuth } = require("../../middleware/auth.middleware");
const validate = require("../../middleware/validate.middleware");
const { asyncHandler, sendSuccess } = require("../../utiles/response");

const service = require("./services/financial-forecast.service");
const { createForecastSchema } = require("./financial-forecast.validation");

/**
 * Financial forecasting endpoints.
 *
 * The handler is thin by design (validate -> service -> envelope), so it lives
 * with the router it belongs to instead of in a separate one-function module.
 */

const generateForecast = asyncHandler(async (req, res) => {
  const result = await service.generateFinancialForecast({
    userId: req.user.id,
    openingCash: req.body.openingCash,
    horizonMonths: req.body.horizonMonths,
  });

  return sendSuccess(
    res,
    200,
    "Financial forecast generated successfully",
    result,
  );
});

routes.use(requireAuth);

routes.post(
  "/",
  validate({ body: createForecastSchema }),
  generateForecast,
);

module.exports = routes;
