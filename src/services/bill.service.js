const BillModel = require("../models/BillModel");
const ExpenseModel = require("../models/ExpenseModel");

const { NotFoundError, ForbiddenError, ConflictError } = require("../errors/AppError");
const events = require("../infrastructure/events/event-bus");
const EVENTS = require("../infrastructure/events/event-names");
const audit = require("../infrastructure/audit.service");
const { executeListQuery, buildSort } = require("../utiles/list-query");

/**
 * Bill service.
 *
 * Settlement remains an explicit user action. Nothing here marks a bill paid
 * because its due date passed; the automation layer only observes.
 *
 * The debug `console.log` calls that printed bill ownership fields were
 * removed: they leaked record identifiers to stdout on every list request.
 */

const BILL_LIST_PROJECTION =
  "name dueDate amount status settledExpenseId settledAt createdAt updatedAt";

const addBill = async (data, userId, context = {}) => {
  const bill = await BillModel.create({
    ...data,
    userID: userId,
  });

  audit.record({
    userID: userId,
    action: "bill.created",
    description: "Bill created",
    requestId: context.requestId,
    metadata: { billId: String(bill._id) },
  });

  return bill;
};

const getAllBills = async (filter = {}) =>
  executeListQuery({
    model: BillModel,
    filter: {},
    select: `${BILL_LIST_PROJECTION} userID`,
    sort: buildSort(filter.sortBy, filter.sortOrder, "dueDate"),
    params: filter,
  });

const getBillById = async (billId, userId) => {
  const bill = await BillModel.findOne({
    _id: billId,
    userID: userId,
  }).lean();

  if (!bill) {
    throw new NotFoundError("Bill not found");
  }

  return bill;
};

const deleteBill = async (billId, userId, context = {}) => {
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

  audit.record({
    userID: userId,
    action: "bill.deleted",
    description: "Bill deleted",
    requestId: context.requestId,
    metadata: { billId: String(bill._id) },
  });

  return bill;
};

const buildBillFilter = (userId, filter = {}) => {
  const query = { userID: userId };

  if (filter.status) {
    query.status = filter.status;
  }

  const dueRange = {};

  if (filter.dueAfter) {
    dueRange.$gte = new Date(filter.dueAfter);
  }

  if (filter.dueBefore) {
    dueRange.$lte = new Date(filter.dueBefore);
  }

  if (Object.keys(dueRange).length > 0) {
    query.dueDate = dueRange;
  }

  if (filter.search) {
    query.name = { $regex: filter.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }

  return query;
};

const getBillByUserId = async (userId, filter = {}) =>
  executeListQuery({
    model: BillModel,
    filter: buildBillFilter(userId, filter),
    select: BILL_LIST_PROJECTION,
    sort: buildSort(filter.sortBy, filter.sortOrder, "dueDate"),
    params: filter,
  });

const settleBill = async (billId, expenseId, userId, context = {}) => {
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
  })
    .select("_id")
    .lean();

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

    // Only the write that actually performed the transition notifies:
    // re-settling the same bill with the same expense is a no-op for consumers.
    if (!bill.settledExpenseId) {
      await events.emit(
        EVENTS.BILL_SETTLED,
        {
          userId: String(userId),
          billId: String(updatedBill._id),
          expenseId: String(expenseId),
          settledAt: (updatedBill.settledAt || new Date()).toISOString(),
        },
        { requestId: context.requestId, source: "bill.service" },
      );
    }

    audit.record({
      userID: userId,
      action: "bill.settled",
      description: "Bill settled and linked to an expense",
      requestId: context.requestId,
      metadata: { billId: String(updatedBill._id), expenseId: String(expenseId) },
    });

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
