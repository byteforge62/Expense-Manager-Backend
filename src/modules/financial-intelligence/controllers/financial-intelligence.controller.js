const asyncHandler = require("../../../middleware/asyncHandler");
const { sendSuccess } = require("../../../utiles/response");
const service = require("../services/financial-intelligence.service");

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

module.exports = {
  getOverview,
};
