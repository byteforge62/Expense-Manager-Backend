const ExpenseModel = require("../models/ExpenseModel");
const NotFoundError = require("../errors/NotFoundError");
const ForbiddenError = require("../errors/ForbiddenError");
const events = require("../infrastructure/events/event-bus");
const EVENTS = require("../infrastructure/events/event-names");
const audit = require("../infrastructure/audit/audit.service");
const {
  executeListQuery,
  buildSort,
  buildDateRangeFilter,
  escapeRegex,
} = require("../utiles/list-query");

/**
 * Expense service.
 *
 * Performance notes:
 * - list reads use a projection + `.lean()`; the previous implementation
 *   populated the owning user document for every row and returned unbounded
 *   results;
 * - filtering/sorting maps onto the compound indexes
 *   (userID, date, _id) and (userID, categoryID, date).
 *
 * Correctness notes:
 * - every query is scoped to the authenticated user id taken from the token,
 *   never from client input;
 * - events are published only after a successful write.
 */

const EXPENSE_LIST_PROJECTION =
  "categoryID amount date description createdAt updatedAt";

const CATEGORY_POPULATE = { path: "categoryID", select: "name type" };

const emitExpenseEvent = async (name, payload, context) => {
  await events.emit(name, payload, {
    requestId: context?.requestId,
    source: "expense.service",
  });
};

const addExpense = async (data, userId, context = {}) => {
  const expenseData = { ...data, userID: userId };
  const expense = await ExpenseModel.create(expenseData);

  await emitExpenseEvent(
    EVENTS.EXPENSE_CREATED,
    {
      userId: String(userId),
      expenseId: String(expense._id),
      amount: expense.amount,
      categoryID: expense.categoryID ? String(expense.categoryID) : null,
      date: expense.date.toISOString(),
    },
    context,
  );

  audit.record({
    userID: userId,
    action: "expense.created",
    description: "Expense created",
    requestId: context.requestId,
    metadata: { expenseId: String(expense._id) },
  });

  return expense;
};

const deleteExpense = async (expenseId, userId, context = {}) => {
  const expense = await ExpenseModel.findOneAndDelete({
    _id: expenseId,
    userID: userId,
  });

  if (!expense) {
    const exists = await ExpenseModel.exists({ _id: expenseId });

    if (!exists) {
      throw new NotFoundError("Expense not found");
    }

    throw new ForbiddenError(
      "You are not authorized to delete this expense",
    );
  }

  await emitExpenseEvent(
    EVENTS.EXPENSE_DELETED,
    {
      userId: String(userId),
      expenseId: String(expense._id),
      amount: expense.amount,
      categoryID: expense.categoryID ? String(expense.categoryID) : null,
      date: expense.date.toISOString(),
    },
    context,
  );

  audit.record({
    userID: userId,
    action: "expense.deleted",
    description: "Expense deleted",
    requestId: context.requestId,
    metadata: { expenseId: String(expense._id) },
  });

  return expense;
};

const updateExpense = async (id, data, userId, context = {}) => {
  const before = await ExpenseModel.findOne({ _id: id, userID: userId })
    .select("amount categoryID date")
    .lean();

  const updatedExpense = await ExpenseModel.findOneAndUpdate(
    {
      _id: id,
      userID: userId,
    },
    {
      $set: data,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!updatedExpense) {
    const exists = await ExpenseModel.exists({ _id: id });

    if (!exists) {
      throw new NotFoundError("Expense not found");
    }

    throw new ForbiddenError("You are not authorized to update this expense");
  }

  await emitExpenseEvent(
    EVENTS.EXPENSE_UPDATED,
    {
      userId: String(userId),
      expenseId: String(updatedExpense._id),
      before: before
        ? {
            amount: before.amount,
            categoryID: before.categoryID ? String(before.categoryID) : null,
            date: before.date.toISOString(),
          }
        : null,
      after: {
        amount: updatedExpense.amount,
        categoryID: updatedExpense.categoryID
          ? String(updatedExpense.categoryID)
          : null,
        date: updatedExpense.date.toISOString(),
      },
    },
    context,
  );

  audit.record({
    userID: userId,
    action: "expense.updated",
    description: "Expense updated",
    requestId: context.requestId,
    metadata: {
      expenseId: String(updatedExpense._id),
      fields: Object.keys(data),
    },
  });

  return updatedExpense;
};

const getExpenseById = async (id, userId) => {
  // Ownership is enforced in the query; the ownership check below only
  // distinguishes "not found" from "not yours" for API compatibility.
  const expense = await ExpenseModel.findOne({ _id: id, userID: userId })
    .populate(CATEGORY_POPULATE)
    .lean();

  if (expense) {
    return expense;
  }

  const exists = await ExpenseModel.exists({ _id: id });

  if (!exists) {
    throw new NotFoundError("Expense not found");
  }

  throw new ForbiddenError(
    "Forbidden: You are not authorized to access this expense",
  );
};

const buildExpenseFilter = (userId, filter = {}) => {
  const { startDate, endDate, categoryID, minAmount, maxAmount, search } = filter;

  const query = { userID: userId };
  const dateFilter = buildDateRangeFilter("date", startDate, endDate);

  if (dateFilter) {
    Object.assign(query, dateFilter);
  }

  if (categoryID) {
    query.categoryID = categoryID;
  }

  if (minAmount !== undefined || maxAmount !== undefined) {
    query.amount = {};

    if (minAmount !== undefined) query.amount.$gte = Number(minAmount);
    if (maxAmount !== undefined) query.amount.$lte = Number(maxAmount);
  }

  if (search) {
    query.description = { $regex: escapeRegex(search), $options: "i" };
  }

  return query;
};

const getExpenseByUserId = async (userId, filter = {}) => {
  const query = buildExpenseFilter(userId, filter);

  return executeListQuery({
    model: ExpenseModel,
    filter: query,
    select: EXPENSE_LIST_PROJECTION,
    populate: CATEGORY_POPULATE,
    sort: buildSort(filter.sortBy, filter.sortOrder, "date"),
    params: filter,
    cursorField: filter.sortBy === "date" || !filter.sortBy ? "date" : null,
  });
};

const getAllExpenses = async (filter = {}) =>
  executeListQuery({
    model: ExpenseModel,
    filter: {},
    // Admin listing keeps the owner id (as before) so records remain
    // attributable across users.
    select: `${EXPENSE_LIST_PROJECTION} userID`,
    populate: CATEGORY_POPULATE,
    sort: buildSort(filter.sortBy, filter.sortOrder, "date"),
    params: filter,
    cursorField: filter.sortBy === "date" || !filter.sortBy ? "date" : null,
  });

const getRecentExpenses = async (userId) => {
  // Newest first, projection only: the dashboard needs a handful of fields.
  return ExpenseModel.find({ userID: userId })
    .select("categoryID amount date description")
    .sort({ date: -1, _id: -1 })
    .limit(5)
    .lean();
};

module.exports = {
  addExpense,
  deleteExpense,
  updateExpense,
  getExpenseById,
  getExpenseByUserId,
  getAllExpenses,
  getRecentExpenses,
};
