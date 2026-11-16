const ExpenseService = require("../services/expense.service");
const { asyncHandler } = require("../utiles/response");
const { sendSuccess } = require("../utiles/response");

const AddExpense = asyncHandler(async (req, res) => {
  const expense = await ExpenseService.addExpense(req.body, req.user.id, {
    requestId: req.id,
  });
  return sendSuccess(res, 201, "Expense Added successfully", expense);
});

const GetAllExpenses = asyncHandler(async (req, res) => {
  const { items, meta } = await ExpenseService.getAllExpenses({
    ...req.query,
    requestId: req.id,
  });
  return sendSuccess(res, 200, "Expenses fetched successfully", items, meta);
});

const DeleteExpense = asyncHandler(async (req, res) => {
  await ExpenseService.deleteExpense(req.params.id, req.user.id, {
    requestId: req.id,
  });
  return sendSuccess(res, 200, "Expense Deleted Successfully");
});

const UpdateExpense = asyncHandler(async (req, res) => {
  const updatedExpense = await ExpenseService.updateExpense(
    req.params.id,
    req.body,
    req.user.id,
    { requestId: req.id },
  );
  return sendSuccess(res, 200, "Expense updated successfully", updatedExpense);
});

const GetExpensebyID = asyncHandler(async (req, res) => {
  const expense = await ExpenseService.getExpenseById(
    req.params.id,
    req.user.id,
  );
  return sendSuccess(res, 200, "Expense fetched successfuy", expense);
});

const GetExpensebyUserId = asyncHandler(async (req, res) => {
  const { items, meta } = await ExpenseService.getExpenseByUserId(
    req.user.id,
    { ...req.query, requestId: req.id },
  );
  return sendSuccess(res, 200, "Expense found successfully", items, meta);
});

const GetRecentExpenses = asyncHandler(async (req, res) => {
  const recentExpenses = await ExpenseService.getRecentExpenses(req.user.id);
  return sendSuccess(
    res,
    200,
    "Recent expenses fetched successfully",
    recentExpenses,
  );
});

module.exports = {
  AddExpense,
  GetAllExpenses,
  DeleteExpense,
  UpdateExpense,
  GetExpensebyID,
  GetExpensebyUserId,
  GetRecentExpenses,
};
