const express = require("express");
const { requireAuth } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { askAISchema } = require("../validations/ai.validation");

const {
  askAI,
  getExpenseInsights,
  generateBudgetPlan,
  detectSpendingRisk,
  getFinancialForecast,
  detectSavingOpportunities,
  getFinancialHealthScore,
  getAllInsights,
} = require("../Controllers/aiController");

const router = express.Router();

// General chat assistant
router.post("/ask", requireAuth, validate({ body: askAISchema }), askAI);

// Data analysis and planning
router.get("/expense-insights", requireAuth, getExpenseInsights);
router.get("/budget-plan", requireAuth, generateBudgetPlan);
router.get("/spending-risk", requireAuth, detectSpendingRisk);
router.get("/financial-forecast", requireAuth, getFinancialForecast);
router.get("/saving-opportunities", requireAuth, detectSavingOpportunities);
router.get("/financial-health", requireAuth, getFinancialHealthScore);

// History and metadata
router.get("/insights", requireAuth, getAllInsights);

module.exports = router;
