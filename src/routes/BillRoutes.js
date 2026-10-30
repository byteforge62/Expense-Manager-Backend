const routes = require("express").Router();
const BillController = require("../Controllers/BillController");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { createBillSchema } = require("../validations/bill.validation");
const { idParamSchema } = require("../validations/common.validation");

routes.post(
  "/bill",
  requireAuth,
  validate({ body: createBillSchema }),
  BillController.AddBill
);

routes.get("/bills", requireAuth, requireRole("Admin"), BillController.GetAllBills);

routes.delete(
  "/bill/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  BillController.DeleteBill
);

routes.get(
  "/bill/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  BillController.GetBillbyID
);

routes.get("/bills/me", requireAuth, BillController.GetBillbyUserID);

module.exports = routes;