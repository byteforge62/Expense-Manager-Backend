const IncomeModel = require("../models/IncomeModel");
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
 * Income service.
 *
 * Previously every read returned the whole collection for the user with no
 * projection or ordering. Reads are now projected, sorted and bounded, and
 * writes publish domain events after the record is persisted.
 */

const INCOME_LIST_PROJECTION = "amount source date createdAt updatedAt";

const addIncome = async (data, userId, context = {}) => {
  const incomeData = { ...data, userID: userId };
  const income = await IncomeModel.create(incomeData);

  await events.emit(
    EVENTS.INCOME_CREATED,
    {
      userId: String(userId),
      incomeId: String(income._id),
      amount: income.amount,
      date: income.date.toISOString(),
    },
    { requestId: context.requestId, source: "income.service" },
  );

  audit.record({
    userID: userId,
    action: "income.created",
    description: "Income created",
    requestId: context.requestId,
    metadata: { incomeId: String(income._id) },
  });

  return income;
};

const deleteIncome = async (incomeId, userId, context = {}) => {
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

  await events.emit(
    EVENTS.INCOME_DELETED,
    {
      userId: String(userId),
      incomeId: String(income._id),
      amount: income.amount,
      date: income.date.toISOString(),
    },
    { requestId: context.requestId, source: "income.service" },
  );

  audit.record({
    userID: userId,
    action: "income.deleted",
    description: "Income deleted",
    requestId: context.requestId,
    metadata: { incomeId: String(income._id) },
  });

  return income;
};

const getIncomeById = async (incomeId, userId) => {
  const income = await IncomeModel.findOne({ _id: incomeId, userID: userId }).lean();

  if (income) {
    return income;
  }

  const exists = await IncomeModel.exists({ _id: incomeId });

  if (!exists) {
    throw new NotFoundError("Income not found");
  }

  throw new ForbiddenError("Your are not authorized to delete this income");
};

const buildIncomeFilter = (userId, filter = {}) => {
  const { startDate, endDate, search } = filter;
  const query = { userID: userId };
  const dateFilter = buildDateRangeFilter("date", startDate, endDate);

  if (dateFilter) {
    Object.assign(query, dateFilter);
  }

  if (search) {
    query.source = { $regex: escapeRegex(search), $options: "i" };
  }

  return query;
};

const getIncomeByUserId = async (userId, filter = {}) =>
  executeListQuery({
    model: IncomeModel,
    filter: buildIncomeFilter(userId, filter),
    select: INCOME_LIST_PROJECTION,
    sort: buildSort(filter.sortBy, filter.sortOrder, "date"),
    params: filter,
    cursorField: filter.sortBy === "date" || !filter.sortBy ? "date" : null,
  });

const getAllIncome = async (filter = {}) =>
  executeListQuery({
    model: IncomeModel,
    filter: {},
    select: `${INCOME_LIST_PROJECTION} userID`,
    sort: buildSort(filter.sortBy, filter.sortOrder, "date"),
    params: filter,
  });

module.exports = {
  addIncome,
  deleteIncome,
  getIncomeById,
  getIncomeByUserId,
  getAllIncome,
};
