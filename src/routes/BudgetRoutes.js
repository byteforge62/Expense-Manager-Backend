const routes = require("express").Router();
const BudgetController = require("../Controllers/BudgetController");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { createBudgetSchema } = require("../validations/budget.validation");
const { idParamSchema } = require("../validations/common.validation");

routes.post(
  "/budget",
  requireAuth,
  validate({ body: createBudgetSchema }),
  BudgetController.AddBudget
);

routes.get("/budgets", requireAuth, requireRole("Admin"), BudgetController.GetAllbudget);

routes.get(
  "/budget/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  BudgetController.GetBudgetbyID
);

routes.delete(
  "/budget/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  BudgetController.DeleteBudget
);

routes.get("/budgets/me", requireAuth, BudgetController.GetBudgetbyUserID);

module.exports = routes;