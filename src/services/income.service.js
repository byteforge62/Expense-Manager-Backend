const IncomeModel = require("../models/IncomeModel");
const NotFoundError = require("../errors/NotFoundError");
const ForbiddenError = require("../errors/ForbiddenError");

const addIncome = async (data, userId) => {
  const incomeData = { ...data, userID: userId };
  const income = await IncomeModel.create(incomeData);
  return income;
};

const deleteIncome = async (incomeId, userId) => {
  const income = await IncomeModel.findOneAndDelete({
    _id: incomeId,
    userID: userId,
  });

  if (!income) {
    const exists = await IncomeModel.exists({ _id: incomeId });

    if (!exists) {
      throw new NotFoundError("Income not found");
    }

    throw new ForbiddenError("You are not authorized to delete this income");
  }
};

const getIncomeById = async (incomeId, userId) => {
  const income = await IncomeModel.findById(incomeId);
  if (!income) {
    throw new NotFoundError("Income not found");
  }
  if (income.userID.toString() !== userId) {
    throw new ForbiddenError("Your are not authorized to delete this income");
  }
  return income;
};

const getIncomeByUserId = async (userId) => {
  return await IncomeModel.find({
    userID: userId,
  });
};

const getAllIncome = async () => {
    return await IncomeModel.find();
}
module.exports = {
  addIncome,
  deleteIncome,
  getIncomeById,
  getIncomeByUserId,
  getAllIncome
};
