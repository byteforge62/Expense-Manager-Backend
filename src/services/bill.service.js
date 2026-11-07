
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
  const bills = await BillModel.find({
    userID: userId,
  }).select("-userID");

  console.log("BILLS QUERY:", bills.length);
  console.log(
    "USERID POPULATED:",
    bills[0]?.populated("userID")
  );
  console.log(
    "USERID VALUE:",
    bills[0]?.userID
  );

  return bills;
};


const settleBill = async (billId, expenseId, userId) => {
  // 1. Confirm that the bill belongs to the authenticated user.
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

  // 2. Confirm that the expense belongs to the same user.
  const expense = await ExpenseModel.findOne({
    _id: expenseId,
    userID: userId,
  }).select("_id");

  if (!expense) {
    throw new NotFoundError(
      "Expense transaction not found for this user",
    );
  }

  // 3. Reject attempts to replace an existing expense relationship.
  if (
    bill.settledExpenseId &&
    bill.settledExpenseId.toString() !== expenseId.toString()
  ) {
    throw new ConflictError(
      "This bill is already linked to another expense",
    );
  }

  try {
    // 4. Atomically claim the bill only if it is unlinked
    // or already linked to this exact expense.
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
    ).select("-userID");

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
