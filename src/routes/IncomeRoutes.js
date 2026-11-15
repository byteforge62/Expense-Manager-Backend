const routes = require("express").Router();
const IncomeController = require("../Controllers/IncomeController");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const idempotency = require("../middleware/idempotency.middleware");
const { createIncomeSchema } = require("../validations/income.validation");
const { idParamSchema } = require("../validations/common.validation");
const { incomeListQuerySchema } = require("../validations/query.validation");

routes.post(
  "/income",
  requireAuth,
  validate({ body: createIncomeSchema }),
  idempotency(),
  IncomeController.AddIncome,
);

routes.get(
  "/incomes",
  requireAuth,
  requireRole("Admin"),
  validate({ query: incomeListQuerySchema }),
  IncomeController.GetAllincome,
);

routes.delete(
  "/income/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  idempotency(),
  IncomeController.DeleteIncome,
);

routes.get(
  "/income/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  IncomeController.GetIncomebyID,
);

routes.get(
  "/incomes/me",
  requireAuth,
  validate({ query: incomeListQuerySchema }),
  IncomeController.GetIncomebyUserID,
);

module.exports = routes;
