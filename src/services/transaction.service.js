const TransactionModel = require("../models/TransactionModel");
const { NotFoundError, ForbiddenError } = require("../errors/AppError");
const audit = require("../infrastructure/audit.service");
const {
  executeListQuery,
  buildSort,
  buildDateRangeFilter,
  escapeRegex,
} = require("../utiles/list-query");

const TRANSACTION_LIST_PROJECTION = "type amount date description createdAt";

const addTransaction = async (data, userId, context = {}) => {
  const transactionData = {
    ...data,
    userID: userId,
  };

  const transaction = await TransactionModel.create(transactionData);

  audit.record({
    userID: userId,
    action: "transaction.created",
    description: "Transaction created",
    requestId: context.requestId,
    metadata: { transactionId: String(transaction._id) },
  });

  return transaction;
};

const getAllTransaction = async (filter = {}) =>
  executeListQuery({
    model: TransactionModel,
    filter: {},
    select: `${TRANSACTION_LIST_PROJECTION} userID`,
    // The admin dashboard renders the owner's name and email. Only those
    // fields are populated: previously the full user document (including the
    // password hash) was sent to this endpoint.
    populate: { path: "userID", select: "name email role" },
    sort: buildSort(filter.sortBy, filter.sortOrder, "date"),
    params: filter,
  });

const getTransactionById = async (transactionId, userId) => {
  const transaction = await TransactionModel.findOne({
    _id: transactionId,
    userID: userId,
  }).lean();

  if (transaction) {
    return transaction;
  }

  const exists = await TransactionModel.exists({ _id: transactionId });

  if (!exists) {
    throw new NotFoundError("Transaction not found");
  }

  throw new ForbiddenError(
    "You are not authorized to access this transaction",
  );
};

const deleteTransaction = async (transactionId, userId, context = {}) => {
  const transaction = await TransactionModel.findOneAndDelete({
    _id: transactionId,
    userID: userId,
  });

  if (!transaction) {
    const exists = await TransactionModel.exists({
      _id: transactionId,
    });

    if (!exists) {
      throw new NotFoundError("Transaction not found");
    }

    throw new ForbiddenError(
      "You are not authorized to delete this transaction",
    );
  }

  audit.record({
    userID: userId,
    action: "transaction.deleted",
    description: "Transaction deleted",
    requestId: context.requestId,
    metadata: { transactionId: String(transaction._id) },
  });

  return transaction;
};

const getTransactionByUserId = async (userId, filter = {}) => {
  const query = { userID: userId };
  const dateFilter = buildDateRangeFilter("date", filter.startDate, filter.endDate);

  if (dateFilter) {
    Object.assign(query, dateFilter);
  }

  if (filter.type) {
    query.type = filter.type;
  }

  if (filter.search) {
    query.description = { $regex: escapeRegex(filter.search), $options: "i" };
  }

  return executeListQuery({
    model: TransactionModel,
    filter: query,
    select: TRANSACTION_LIST_PROJECTION,
    sort: buildSort(filter.sortBy, filter.sortOrder, "date"),
    params: filter,
    cursorField: filter.sortBy === "date" || !filter.sortBy ? "date" : null,
  });
};

module.exports = {
  addTransaction,
  getAllTransaction,
  getTransactionById,
  deleteTransaction,
  getTransactionByUserId,
};
