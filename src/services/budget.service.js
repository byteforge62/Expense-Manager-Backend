const BudgetModel = require("../models/BudgetModel");
const NotFoundError = require("../errors/NotFoundError");
const ForbiddenError = require("../errors/ForbiddenError");

const addBudget = async (data, userId) => {
  const budgetData = {
    ...data,
    userID: userId,
  };

  return await BudgetModel.create(budgetData);
};

const getAllBudget = async () => {
  return await BudgetModel.find().populate("categoryID");
};

const getBudgetById = async (budgetId, userId) => {
  const budget = await BudgetModel.findById(budgetId);

  if (!budget) {
    throw new NotFoundError("Budget not found");
  }

  if (budget.userID.toString() !== userId) {
    throw new ForbiddenError(
      "You are not authorized to access this budget"
    );
  }

  return budget;
};

const deleteBudget = async (budgetId, userId) => {
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
};

const getBudgetByUserId = async (userId) => {
  return await BudgetModel.find({
    userID: userId,
  }).populate("userID categoryID");
};

module.exports = {
    addBudget,
    getAllBudget,
    getBudgetById,
    deleteBudget,
    getBudgetByUserId
}