const { asyncHandler } = require("../utiles/response");
const BudgetService = require("../services/budget.service");
const { sendSuccess } = require("../utiles/response");

const AddBudget = asyncHandler(async (req, res) => {
  const budget = await BudgetService.addBudget(req.body, req.user.id, {
    requestId: req.id,
  });
  return sendSuccess(
    res,
    201,
    "Budget added successfully",
    budget,
  );
});

const GetAllbudget = asyncHandler(async (req, res) => {
  const { items, meta } = await BudgetService.getAllBudget({
    ...req.query,
    requestId: req.id,
  });

  return sendSuccess(
    res,
    200,
    "Budgets fetched successfully",
    items,
    meta,
  );
});

const GetBudgetbyID = asyncHandler(async (req, res) => {
  const budget = await BudgetService.getBudgetById(
    req.params.id,
    req.user.id
  );

  return sendSuccess(
    res,
    200,
    "Budget found successfully",
    budget
  );
});

const DeleteBudget = asyncHandler(async (req, res) => {
  await BudgetService.deleteBudget(req.params.id, req.user.id, {
    requestId: req.id,
  });

  return sendSuccess(
    res,
    200,
    "Budget deleted successfully"
  );
});

const GetBudgetbyUserID = asyncHandler(async (req, res) => {
  const { items, meta } = await BudgetService.getBudgetByUserId(
    req.user.id,
    { ...req.query, requestId: req.id },
  );

  return sendSuccess(
    res,
    200,
    "Budget found successfully",
    items,
    meta,
  );
});

const GetBudgetUtilization = asyncHandler(async (req, res) => {
  const utilization = await BudgetService.getBudgetUtilization(req.user.id, {
    budgetId: req.query.budgetId,
  });

  return sendSuccess(
    res,
    200,
    "Budget utilization fetched successfully",
    utilization,
    {
      derived: true,
      source: "budget_utilization",
      requestId: req.id,
    },
  );
});

module.exports = {
  AddBudget,
  GetAllbudget,
  GetBudgetbyID,
  DeleteBudget,
  GetBudgetbyUserID,
  GetBudgetUtilization,
};
