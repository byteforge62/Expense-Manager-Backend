const routes = require("express").Router();
const ExpenseController = require("../Controllers/ExepenseController");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const idempotency = require("../middleware/idempotency.middleware");
const { createExpenseSchema, updateExpenseSchema } = require("../validations/expense.validation");
const { idParamSchema } = require("../validations/common.validation");
const { expensesListQuerySchema } = require("../validations/query.validation");

routes.post(
  "/expense",
  requireAuth,
  validate({ body: createExpenseSchema }),
  idempotency(),
  ExpenseController.AddExpense,
);

routes.get(
  "/expenses",
  requireAuth,
  requireRole("Admin"),
  validate({ query: expensesListQuerySchema }),
  ExpenseController.GetAllExpenses,
);

routes.get(
  "/expense/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  ExpenseController.GetExpensebyID,
);

routes.put(
  "/expense/:id",
  requireAuth,
  validate({ params: idParamSchema, body: updateExpenseSchema }),
  idempotency(),
  ExpenseController.UpdateExpense,
);

routes.delete(
  "/expense/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  idempotency(),
  ExpenseController.DeleteExpense,
);

routes.get(
  "/expenses/me",
  requireAuth,
  validate({ query: expensesListQuerySchema }),
  ExpenseController.GetExpensebyUserId,
);

routes.get(
  "/expenses/recent",
  requireAuth,
  ExpenseController.GetRecentExpenses,
);

module.exports = routes;
