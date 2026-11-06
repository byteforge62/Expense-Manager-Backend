
const BillModel = require("../models/BillModel");
const ExpenseModel = require("../models/ExpenseModel");

const NotFoundError = require("../errors/NotFoundError");
const ForbiddenError = require("../errors/ForbiddenError");
const ConflictError = require("../errors/ConflictError");

const addBill = async (data, userId) => {
  return BillModel.create({
    ...data,
    userID: userId,
  });
};

const getAllBills = async () => {
  return BillModel.find();
};

const getBillById = async (billId, userId) => {
  const bill = await BillModel.findOne({
    _id: billId,
    userID: userId,
  });

  if (!bill) {
    throw new NotFoundError("Bill not found");
  }

  return bill;
};

const deleteBill = async (billId, userId) => {
  const bill = await BillModel.findOneAndDelete({
    _id: billId,
    userID: userId,
  });

  if (!bill) {
    const exists = await BillModel.exists({ _id: billId });

    if (!exists) {
      throw new NotFoundError("Bill not found");
    }

    throw new ForbiddenError(
      "You are not authorized to delete this bill",
    );
  }
};

const getBillByUserId = async (userId) => {
  return BillModel.find({
    userID: userId,
  })
};

const settleBill = async (billId, expenseId, userId) => {
  const bill = await BillModel.findOne({
    _id: billId,
    userID: userId,
  });

  if (!bill) {
    const exists = await BillModel.exists({ _id: billId });

    if (!exists) {
      throw new NotFoundError("Bill not found");
    }

    throw new ForbiddenError(
      "You are not authorized to settle this bill",
    );
  }

  const expense = await ExpenseModel.findOne({
    _id: expenseId,
    userID: userId,
  }).select("_id");

  if (!expense) {
    throw new NotFoundError(
      "Expense transaction not found for this user",
    );
  }

  if (
    bill.settledExpenseId &&
    bill.settledExpenseId.toString() !== expenseId
  ) {
    throw new ConflictError(
      "This bill is already linked to another expense",
    );
  }

  try {
    const updatedBill = await BillModel.findOneAndUpdate(
      {
        _id: billId,
        userID: userId,
        $or: [
          { settledExpenseId: { $exists: false } },
          { settledExpenseId: null },
          { settledExpenseId: expenseId },
        ],
      },
      {
        $set: {
          status: "paid",
          settledExpenseId: expenseId,
          settledAt: bill.settledAt || new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!updatedBill) {
      throw new ConflictError(
        "The bill was modified by another request. Refresh and try again.",
      );
    }

    return updatedBill;
  } catch (error) {
    if (error.code === 11000) {
      throw new ConflictError(
        "This expense is already linked to another bill",
      );
    }

    throw error;
  }
};

module.exports = {
  addBill,
  getAllBills,
  getBillById,
  deleteBill,
  getBillByUserId,
  settleBill,
};
