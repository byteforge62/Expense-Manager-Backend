
const asyncHandler = require("../middleware/asyncHandler");
const BillService = require("../services/bill.service");
const { sendSuccess } = require("../utiles/response");

const AddBill = asyncHandler(async (req, res) => {
  const bill = await BillService.addBill(req.body, req.user.id);

  return sendSuccess(
    res,
    201,
    "Bill added successfully",
    bill,
  );
});

const GetAllBills = asyncHandler(async (req, res) => {
  const bills = await BillService.getAllBills();

  return sendSuccess(
    res,
    200,
    "Bills fetched successfully",
    bills,
  );
});

const GetBillbyID = asyncHandler(async (req, res) => {
  const bill = await BillService.getBillById(
    req.params.id,
    req.user.id,
  );

  return sendSuccess(
    res,
    200,
    "Bill found successfully",
    bill,
  );
});

const DeleteBill = asyncHandler(async (req, res) => {
  await BillService.deleteBill(
    req.params.id,
    req.user.id,
  );

  return sendSuccess(
    res,
    200,
    "Bill deleted successfully",
  );
});

const GetBillbyUserID = asyncHandler(async (req, res) => {
  const bills = await BillService.getBillByUserId(req.user.id);

  return sendSuccess(
    res,
    200,
    "Bills found successfully",
    bills,
  );
});

const SettleBill = asyncHandler(async (req, res) => {
  const bill = await BillService.settleBill(
    req.params.id,
    req.body.expenseId,
    req.user.id,
  );

  return sendSuccess(
    res,
    200,
    "Bill settled and linked to expense successfully",
    bill,
  );
});

module.exports = {
  AddBill,
  GetAllBills,
  GetBillbyID,
  DeleteBill,
  GetBillbyUserID,
  SettleBill,
};
