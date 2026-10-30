const routes = require("express").Router();
const TransactionController = require("../Controllers/TransactionController");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const {
  createTransactionSchema,
} = require("../validations/transaction.validation");
const { idParamSchema } = require("../validations/common.validation");

routes.post(
  "/transaction",
  requireAuth,
  validate({ body: createTransactionSchema }),
  TransactionController.AddTransaction
);

routes.get(
  "/transactions",
  requireAuth,
  requireRole("Admin"),
  TransactionController.GetAlltransaction
);

routes.get(
  "/transaction/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  TransactionController.GettransactionbyID
);

routes.delete(
  "/transaction/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  TransactionController.DeleteTransaction
);

routes.get(
  "/transactions/me",
  requireAuth,
  TransactionController.TransactionByUserId
);

module.exports = routes;