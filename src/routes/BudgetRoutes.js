const routes = require("express").Router();
const BudgetController = require("../Controllers/BudgetController");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const idempotency = require("../middleware/idempotency.middleware");
const { createBudgetSchema } = require("../validations/financial.validation");
const { idParamSchema, objectIdSchema } = require("../validations/common.validation");
const { budgetsListQuerySchema } = require("../validations/query.validation");
const { z } = require("zod");

const utilizationQuerySchema = z.object({
  budgetId: objectIdSchema.optional(),
});

routes.post(
  "/budget",
  requireAuth,
  validate({ body: createBudgetSchema }),
  idempotency(),
  BudgetController.AddBudget,
);

routes.get(
  "/budgets",
  requireAuth,
  requireRole("Admin"),
  validate({ query: budgetsListQuerySchema }),
  BudgetController.GetAllbudget,
);

routes.get(
  "/budgets/utilization",
  requireAuth,
  validate({ query: utilizationQuerySchema }),
  BudgetController.GetBudgetUtilization,
);

routes.get(
  "/budget/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  BudgetController.GetBudgetbyID,
);

routes.delete(
  "/budget/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  idempotency(),
  BudgetController.DeleteBudget,
);

routes.get(
  "/budgets/me",
  requireAuth,
  validate({ query: budgetsListQuerySchema }),
  BudgetController.GetBudgetbyUserID,
);

module.exports = routes;
