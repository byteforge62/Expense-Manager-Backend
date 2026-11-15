const routes = require("express").Router();

const BillController = require("../Controllers/BillController");

const {
  requireAuth,
  requireRole,
} = require("../middleware/auth.middleware");

const validate = require("../middleware/validate.middleware");
const idempotency = require("../middleware/idempotency.middleware");

const {
  createBillSchema,
  settleBillSchema,
} = require("../validations/bill.validation");

const {
  idParamSchema,
} = require("../validations/common.validation");

const { billsListQuerySchema } = require("../validations/query.validation");

routes.post(
  "/bill",
  requireAuth,
  validate({ body: createBillSchema }),
  idempotency(),
  BillController.AddBill,
);

routes.get(
  "/bills",
  requireAuth,
  requireRole("Admin"),
  validate({ query: billsListQuerySchema }),
  BillController.GetAllBills,
);

routes.delete(
  "/bill/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  idempotency(),
  BillController.DeleteBill,
);

routes.get(
  "/bill/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  BillController.GetBillbyID,
);

routes.patch(
  "/bill/:id/settle",
  requireAuth,
  validate({
    params: idParamSchema,
    body: settleBillSchema,
  }),
  idempotency(),
  BillController.SettleBill,
);

routes.get(
  "/bills/me",
  requireAuth,
  validate({ query: billsListQuerySchema }),
  BillController.GetBillbyUserID,
);

module.exports = routes;
