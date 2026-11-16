const routes = require("express").Router();
const TransactionController = require("../Controllers/TransactionController");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const idempotency = require("../middleware/idempotency.middleware");
const { createTransactionSchema } = require("../validations/financial.validation");
const { idParamSchema } = require("../validations/common.validation");
const { transactionsListQuerySchema } = require("../validations/query.validation");

routes.post(
  "/transaction",
  requireAuth,
  validate({ body: createTransactionSchema }),
  idempotency(),
  TransactionController.AddTransaction,
);

routes.get(
  "/transactions",
  requireAuth,
  requireRole("Admin"),
  validate({ query: transactionsListQuerySchema }),
  TransactionController.GetAlltransaction,
);

routes.get(
  "/transaction/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  TransactionController.GettransactionbyID,
);

routes.delete(
  "/transaction/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  idempotency(),
  TransactionController.DeleteTransaction,
);

routes.get(
  "/transactions/me",
  requireAuth,
  validate({ query: transactionsListQuerySchema }),
  TransactionController.TransactionByUserId,
);

module.exports = routes;
