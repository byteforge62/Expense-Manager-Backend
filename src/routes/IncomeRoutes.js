const routes = require("express").Router();
const IncomeController = require("../Controllers/IncomeController");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { createIncomeSchema } = require("../validations/income.validation");
const { idParamSchema } = require("../validations/common.validation");

routes.post(
  "/income",
  requireAuth,
  validate({ body: createIncomeSchema }),
  IncomeController.AddIncome,
);

routes.get(
  "/incomes",
  requireAuth,
  requireRole("Admin"),
  IncomeController.GetAllincome,
);

routes.delete(
  "/income/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  IncomeController.DeleteIncome,
);

routes.get(
  "/income/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  IncomeController.GetIncomebyID,
);

routes.get("/incomes/me", requireAuth, IncomeController.GetIncomebyUserID);

module.exports = routes;
