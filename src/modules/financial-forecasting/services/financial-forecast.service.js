const IncomeModel = require("../../../models/IncomeModel");
const ExpenseModel = require("../../../models/ExpenseModel");
const RecurringModel = require("../../../models/RecurringModel");
const BillModel = require("../../../models/BillModel");

const { calculateFinancialForecast } = require("../domain/forecast.engine");

const generateFinancialForecast = async ({
  userId,
  openingCash,
  horizonMonths,
  now = new Date(),
}) => {
  const historyStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const forecastEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + horizonMonths, 1),
  );

  const nonRecurringFilter = {
    $or: [{ recurringId: { $exists: false } }, { recurringId: null }],
  };

  const [
    incomeTransactions,
    expenseTransactions,
    recurringSchedules,
    pendingBills,
  ] = await Promise.all([
    IncomeModel.find({
      userID: userId,
      date: {
        $gte: historyStart,
        $lt: now,
      },
      ...nonRecurringFilter,
    })
      .select("amount date +recurringId")
      .lean(),

    ExpenseModel.find({
      userID: userId,
      date: {
        $gte: historyStart,
        $lt: now,
      },
      ...nonRecurringFilter,
    })
      .select("amount date +recurringId")
      .lean(),

    RecurringModel.find({
      userId,
      isActive: true,
    })
      .select(
        "title amount type frequency nextDate recurrenceAnchorDay recurrenceAnchorMonth isActive",
      )
      .lean(),

    BillModel.find({
      userID: userId,
      status: "pending",
      dueDate: { $lt: forecastEnd },
      $or: [
        { settledExpenseId: { $exists: false } },
        { settledExpenseId: null },
      ],
    })
      .select("name amount dueDate status settledExpenseId")
      .lean(),
  ]);

  return calculateFinancialForecast({
    openingCash,
    horizonMonths,
    incomeTransactions,
    expenseTransactions,
    recurringSchedules,
    pendingBills,
    now,
  });
};

module.exports = {
  generateFinancialForecast,
};
