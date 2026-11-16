const express = require("express");
const { requireAuth } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { z } = require("zod");

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

// Chat payload validation (single consumer: this router).
const askAISchema = z
  .object({
    message: z
      .string({ error: "Message must be a string" })
      .trim()
      .min(1, "Message cannot be empty")
      .max(3000, "Message cannot exceed 3000 characters"),
  })
  .strict();

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
