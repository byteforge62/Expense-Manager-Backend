const CategoryModel = require("../../../models/CategoryModel");
const ExpenseModel = require("../../../models/ExpenseModel");
const IncomeModel = require("../../../models/IncomeModel");
const BillModel = require("../../../models/BillModel");
const BudgetModel = require("../../../models/BudgetModel");
const RecurringModel = require("../../../models/RecurringModel");
const {
  getComparableWindow,
  normalizeDateWindow,
} = require("../utils/date.utils");

const findTransactions = (Model, userField, userId, window, fields) =>
  Model.find({
    [userField]: userId,
    date: {
      $gte: window.start,
      $lte: window.end,
    },
  })
    .select(fields)
    .lean();

const getFinancialRecords = async ({
  userId,
  startDate,
  endDate,
  now = new Date(),
}) => {
  const currentWindow = normalizeDateWindow(startDate, endDate, 90, now);
  const comparisonWindow = getComparableWindow(currentWindow);
  const transactionWindow = {
    start: comparisonWindow.start,
    end: currentWindow.end,
  };
  const [
    allExpenses,
    allIncomes,
    budgets,
    bills,
    recurringSchedules,
    categories,
  ] =
    await Promise.all([
      findTransactions(
        ExpenseModel,
        "userID",
        userId,
        transactionWindow,
        "amount date categoryID",
      ),
      findTransactions(
        IncomeModel,
        "userID",
        userId,
        transactionWindow,
        "amount date source",
      ),
      BudgetModel.find({
        userID: userId,
        $and: [
          {
            $or: [
              { start_date: { $exists: false } },
              { start_date: null },
              { start_date: { $lte: currentWindow.end } },
            ],
          },
          {
            $or: [
              { end_date: { $exists: false } },
              { end_date: null },
              { end_date: { $gte: currentWindow.start } },
            ],
          },
        ],
      })
        .select("userID categoryID amount start_date end_date")
        .lean(),
      BillModel.find({
        userID: userId,
        status: "pending",
        dueDate: { $lte: currentWindow.end },
        $or: [
          { settledExpenseId: { $exists: false } },
          { settledExpenseId: null },
        ],
      })
        .select("userID name amount dueDate status settledExpenseId")
        .lean(),
      RecurringModel.find({
        userId,
        isActive: true,
      })
        .select("userId title amount type frequency nextDate isActive")
        .lean(),
      CategoryModel.find({ type: "expense" })
        .select("_id name type")
        .lean(),
    ]);

  const splitTransactions = (transactions) => {
    const current = [];
    const historical = [];

    for (const transaction of transactions) {
      if (new Date(transaction.date) >= currentWindow.start) {
        current.push(transaction);
      } else {
        historical.push(transaction);
      }
    }

    return { current, historical };
  };
  const expensePeriods = splitTransactions(allExpenses);
  const incomePeriods = splitTransactions(allIncomes);
  const categoryLookup = new Map(
    categories.map((category) => [String(category._id), category]),
  );

  return {
    currentWindow,
    comparisonWindow,
    expenses: expensePeriods.current,
    incomes: incomePeriods.current,
    budgets,
    bills,
    recurringSchedules,
    historicalExpenses: expensePeriods.historical,
    historicalIncomes: incomePeriods.historical,
    categories,
    categoryLookup,
  };
};

module.exports = {
  getFinancialRecords,
  normalizeDateWindow,
};
