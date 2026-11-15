const BudgetModel = require("../models/BudgetModel");
const BudgetUtilizationModel = require("../models/BudgetUtilizationModel");
const NotFoundError = require("../errors/NotFoundError");
const ForbiddenError = require("../errors/ForbiddenError");
const audit = require("../infrastructure/audit/audit.service");
const { executeListQuery, buildSort } = require("../utiles/list-query");

const BUDGET_LIST_PROJECTION =
  "categoryID amount description start_date end_date createdAt updatedAt";

const CATEGORY_POPULATE = { path: "categoryID", select: "name type" };

const addBudget = async (data, userId, context = {}) => {
  const budget = await BudgetModel.create({ ...data, userID: userId });

  audit.record({
    userID: userId,
    action: "budget.created",
    description: "Budget created",
    requestId: context.requestId,
    metadata: { budgetId: String(budget._id) },
  });

  return budget;
};

const getAllBudget = async (filter = {}) =>
  executeListQuery({
    model: BudgetModel,
    filter: {},
    select: BUDGET_LIST_PROJECTION,
    populate: CATEGORY_POPULATE,
    sort: buildSort(filter.sortBy, filter.sortOrder, "start_date"),
    params: filter,
  });

const getBudgetById = async (budgetId, userId) => {
  const budget = await BudgetModel.findOne({ _id: budgetId, userID: userId })
    .populate(CATEGORY_POPULATE)
    .lean();

  if (!budget) {
    throw new NotFoundError("Budget not found");
  }

  return budget;
};

const deleteBudget = async (budgetId, userId, context = {}) => {
  const budget = await BudgetModel.findOneAndDelete({
    _id: budgetId,
    userID: userId,
  });

  if (!budget) {
    const exists = await BudgetModel.exists({ _id: budgetId });

    if (!exists) {
      throw new NotFoundError("Budget not found");
    }

    throw new ForbiddenError("You are not authorized to delete this budget");
  }

  // Derived utilization for a removed budget is meaningless.
  await BudgetUtilizationModel.deleteMany({ budgetID: budget._id, userID: userId });

  audit.record({
    userID: userId,
    action: "budget.deleted",
    description: "Budget deleted",
    requestId: context.requestId,
    metadata: { budgetId: String(budget._id) },
  });

  return budget;
};

const buildBudgetFilter = (userId, filter = {}) => {
  const query = { userID: userId };

  if (filter.categoryID) {
    query.categoryID = filter.categoryID;
  }

  if (filter.activeOn) {
    const activeOn = new Date(filter.activeOn);
    query.start_date = { $lte: activeOn };
    query.$or = [
      { end_date: { $exists: false } },
      { end_date: null },
      { end_date: { $gte: activeOn } },
    ];
  }

  return query;
};

const getBudgetByUserId = async (userId, filter = {}) =>
  executeListQuery({
    model: BudgetModel,
    filter: buildBudgetFilter(userId, filter),
    select: BUDGET_LIST_PROJECTION,
    populate: CATEGORY_POPULATE,
    sort: buildSort(filter.sortBy, filter.sortOrder, "start_date"),
    params: filter,
  });

/**
 * Latest derived utilization per budget. Always labelled as derived by the
 * controller: authoritative spend lives in the expense collection.
 */
const getBudgetUtilization = async (userId, { budgetId } = {}) => {
  const query = { userID: userId };

  if (budgetId) {
    query.budgetID = budgetId;
  }

  return BudgetUtilizationModel.find(query)
    .select(
      "budgetID categoryID periodStart periodEnd limit spent utilization highestThresholdReached computedAt",
    )
    .sort({ computedAt: -1 })
    .limit(200)
    .lean();
};

module.exports = {
  addBudget,
  getAllBudget,
  getBudgetById,
  deleteBudget,
  getBudgetByUserId,
  getBudgetUtilization,
};
