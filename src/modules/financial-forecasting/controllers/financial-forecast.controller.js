const asyncHandler = require("../../../middleware/asyncHandler");
const { sendSuccess } = require("../../../utiles/response");

const service = require("../services/financial-forecast.service");

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

module.exports = {
  generateForecast,
};
