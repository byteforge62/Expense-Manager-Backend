const { asyncHandler } = require("../utiles/response");
const { sendSuccess } = require("../utiles/response");
const AIService = require("../services/ai.service");

const askAI = asyncHandler(async (req, res) => {
  const reply = await AIService.askAI(req.user.id, req.body.message);

  return sendSuccess(res, 200, "AI response generated successfully", {
    reply,
  });
});

const getExpenseInsights = asyncHandler(async (req, res) => {
  const insights = await AIService.getExpenseInsights(req.user.id);

  return sendSuccess(
    res,
    200,
    "Expense insights generated successfully",
    insights,
  );
});

const generateBudgetPlan = asyncHandler(async (req, res) => {
  const budgetPlan = await AIService.generateBudgetPlan(req.user.id);

  return sendSuccess(
    res,
    200,
    "Budget plan generated successfully",
    budgetPlan,
  );
});

const detectSpendingRisk = asyncHandler(async (req, res) => {
  const risk = await AIService.detectSpendingRisk(req.user.id);

  return sendSuccess(
    res,
    200,
    "Spending risk generated successfully",
    risk,
  );
});

const getFinancialForecast = asyncHandler(async (req, res) => {
  const forecast = await AIService.getFinancialForecast(req.user.id);

  return sendSuccess(
    res,
    200,
    "Financial forecast generated successfully",
    forecast,
  );
});

const detectSavingOpportunities = asyncHandler(async (req, res) => {
  const opportunities =
    await AIService.detectSavingOpportunities(req.user.id);

  return sendSuccess(
    res,
    200,
    "Saving opportunities generated successfully",
    opportunities,
  );
});

const getFinancialHealthScore = asyncHandler(async (req, res) => {
  const healthScore =
    await AIService.getFinancialHealthScore(req.user.id);

  return sendSuccess(
    res,
    200,
    "Financial health score generated successfully",
    healthScore,
  );
});

const getAllInsights = asyncHandler(async (req, res) => {
  const insights = await AIService.getAllInsights(req.user.id);

  return sendSuccess(
    res,
    200,
    "Insights fetched successfully",
    insights,
  );
});

module.exports = {
  askAI,
  getExpenseInsights,
  generateBudgetPlan,
  detectSpendingRisk,
  getFinancialForecast,
  detectSavingOpportunities,
  getFinancialHealthScore,
  getAllInsights,
};