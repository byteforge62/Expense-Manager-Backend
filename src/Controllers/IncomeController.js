const IncomeService = require("../services/income.service");
const asyncHandler = require("../middleware/asyncHandler");
const { sendSuccess } = require("../utiles/response");

const AddIncome = asyncHandler(async (req, res) => {
  const income = await IncomeService.addIncome(req.body, req.user.id, {
    requestId: req.id,
  });
  return sendSuccess(res, 201, "Income added successfully", income);
});

const GetAllincome = asyncHandler(async (req, res) => {
  const { items, meta } = await IncomeService.getAllIncome({
    ...req.query,
    requestId: req.id,
  });
  return sendSuccess(res, 200, "Income fetched successfully", items, meta);
});

const GetIncomebyID = asyncHandler(async (req, res) => {
  const income = await IncomeService.getIncomeById(req.params.id, req.user.id);
  return sendSuccess(res, 200, "Income found successfully", income);
});

const DeleteIncome = asyncHandler(async (req, res) => {
  await IncomeService.deleteIncome(req.params.id, req.user.id, {
    requestId: req.id,
  });
  return sendSuccess(res, 200, "Income deleted successfully");
});

const GetIncomebyUserID = asyncHandler(async (req, res) => {
  const { items, meta } = await IncomeService.getIncomeByUserId(req.user.id, {
    ...req.query,
    requestId: req.id,
  });
  return sendSuccess(res, 200, "Income found successfully", items, meta);
});

module.exports = {
  AddIncome,
  GetAllincome,
  GetIncomebyID,
  DeleteIncome,
  GetIncomebyUserID,
};
