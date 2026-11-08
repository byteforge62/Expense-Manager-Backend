const {
  average,
  median,
  percentChange,
  roundMoney,
  safeDivide,
  standardDeviation,
} = require("./utils/statistics");
const { getInclusiveDays, getUtcDayKeys } = require("./utils/date.utils");

const roundRate = (value) => Math.round(value * 10000) / 10000;

const getDailyTotals = (transactions, startDate, endDate) => {
  const totals = new Map();

  for (const transaction of transactions) {
    const date = new Date(transaction.date);
    const amount = Number(transaction.amount);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(amount)) {
      continue;
    }

    const key = date.toISOString().slice(0, 10);
    totals.set(key, (totals.get(key) || 0) + amount);
  }

  const keys = startDate && endDate
    ? getUtcDayKeys(startDate, endDate)
    : [...totals.keys()].sort();

  return keys.map((date) => ({
    date,
    amount: roundMoney(totals.get(date) || 0),
  }));
};

const getCategoryTotals = (expenses, categoryLookup = new Map()) => {
  const totals = {};

  for (const expense of expenses) {
    const categoryId = expense.categoryID ? String(expense.categoryID) : null;
    const category = categoryLookup.get(categoryId);
    const name = category?.name || "Uncategorized";
    const amount = Number(expense.amount);

    if (Number.isFinite(amount)) {
      totals[name] = (totals[name] || 0) + amount;
    }
  }

  return Object.fromEntries(
    Object.entries(totals).sort(([, first], [, second]) => second - first),
  );
};

const getMonthlyCashFlows = (incomes, expenses, startDate, endDate) => {
  const totals = new Map();
  const start = new Date(startDate);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const finalDate = new Date(endDate);
  const windowStart = new Date(startDate).getTime();
  const windowEnd = new Date(endDate).getTime();

  while (cursor <= finalDate) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const coveredStart = Math.max(monthStart.getTime(), windowStart);
    const coveredEnd = Math.min(nextMonth.getTime(), windowEnd + 1);
    const daysCovered = (coveredEnd - coveredStart) / (24 * 60 * 60 * 1000);
    const daysInMonth = (nextMonth.getTime() - monthStart.getTime()) /
      (24 * 60 * 60 * 1000);
    totals.set(
      key,
      {
        income: 0,
        expenses: 0,
        daysCovered,
        daysInMonth,
        complete: daysCovered === daysInMonth,
      },
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    cursor.setUTCDate(1);
  }

  for (const [transactions, field] of [
    [incomes, "income"],
    [expenses, "expenses"],
  ]) {
    for (const transaction of transactions) {
      const date = new Date(transaction.date);
      if (Number.isNaN(date.getTime())) {
        continue;
      }

      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      const month = totals.get(key);
      if (month) {
        month[field] += Number(transaction.amount) || 0;
      }
    }
  }

  return Array.from(totals.entries()).map(([month, values]) => ({
    month,
    income: roundMoney(values.income),
    expenses: roundMoney(values.expenses),
    netCashFlow: roundMoney(values.income - values.expenses),
    daysCovered: roundMoney(values.daysCovered),
    daysInMonth: values.daysInMonth,
    complete: values.complete,
  }));
};

const getBudgetUtilization = (budgets, expenses) => {
  const budgetByCategory = new Map();

  for (const budget of budgets) {
    const amount = Number(budget.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const categoryId = budget.categoryID ? String(budget.categoryID) : null;
    const key = categoryId || "__all__";
    budgetByCategory.set(key, (budgetByCategory.get(key) || 0) + amount);
  }

  if (budgetByCategory.size === 0) {
    return {
      available: false,
      budgetAmount: 0,
      matchedSpending: 0,
      utilization: null,
    };
  }

  let budgetAmount = 0;
  let matchedSpending = 0;
  const hasOverallBudget = budgetByCategory.has("__all__");

  for (const [categoryId, amount] of budgetByCategory) {
    if (categoryId === "__all__") {
      budgetAmount += amount;
      matchedSpending = expenses.reduce(
        (sum, expense) => sum + (Number(expense.amount) || 0),
        0,
      );
      continue;
    }

    budgetAmount += amount;
    matchedSpending += expenses.reduce((sum, expense) => {
      const expenseCategoryId = expense.categoryID ? String(expense.categoryID) : null;
      return sum + (expenseCategoryId === categoryId
        ? Number(expense.amount) || 0
        : 0);
    }, 0);
  }

  if (hasOverallBudget) {
    budgetAmount = budgetByCategory.get("__all__");
    matchedSpending = expenses.reduce(
      (sum, expense) => sum + (Number(expense.amount) || 0),
      0,
    );
  }

  return {
    available: budgetAmount > 0,
    budgetAmount: roundMoney(budgetAmount),
    matchedSpending: roundMoney(matchedSpending),
    utilization: hasOverallBudget || budgetAmount > 0
      ? safeDivide(matchedSpending, budgetAmount, 0)
      : null,
  };
};

const getBudgetBreakdown = (budgets, expenses, categoryLookup) => {
  const groupedBudgets = new Map();
  for (const budget of budgets) {
    const amount = Number(budget.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const categoryId = budget.categoryID ? String(budget.categoryID) : null;
    const key = categoryId || "__all__";
    groupedBudgets.set(key, (groupedBudgets.get(key) || 0) + amount);
  }

  if (groupedBudgets.has("__all__")) {
    const amount = groupedBudgets.get("__all__");
    const spending = expenses.reduce(
      (sum, expense) => sum + (Number(expense.amount) || 0),
      0,
    );
    return [{
      categoryId: null,
      category: "All categories",
      budget: roundMoney(amount),
      spending: roundMoney(spending),
      transactionCount: expenses.length,
      utilization: roundRate(safeDivide(spending, amount, 0)),
      scope: "overall",
    }];
  }

  return [...groupedBudgets.entries()].map(([categoryId, budget]) => {
    const category = categoryLookup.get(categoryId)?.name || "Uncategorized";
    const categoryExpenses = expenses.filter((expense) =>
      (expense.categoryID ? String(expense.categoryID) : null) === categoryId,
    );
    const spending = categoryExpenses.reduce(
      (sum, expense) => sum + (Number(expense.amount) || 0),
      0,
    );
    return {
      categoryId,
      category,
      budget: roundMoney(budget),
      spending: roundMoney(spending),
      transactionCount: categoryExpenses.length,
      utilization: roundRate(safeDivide(spending, budget, 0)),
      scope: "category",
    };
  });
};

const getMonthlyRecurringExpense = (schedules) => {
  const monthlyFactor = {
    daily: 365.2425 / 12,
    weekly: 52.1775 / 12,
    monthly: 1,
    yearly: 1 / 12,
  };

  return schedules.reduce((sum, schedule) => {
    if (schedule.isActive === false || schedule.type !== "EXPENSE") {
      return sum;
    }

    const amount = Number(schedule.amount);
    const factor = monthlyFactor[schedule.frequency];
    return Number.isFinite(amount) && Number.isFinite(factor)
      ? sum + amount * factor
      : sum;
  }, 0);
};

const buildFinancialMetrics = ({
  incomeTransactions = [],
  expenseTransactions = [],
  budgets = [],
  bills = [],
  recurringSchedules = [],
  categoryLookup = new Map(),
  startDate,
  endDate,
}) => {
  const days = getInclusiveDays(startDate, endDate);
  const totalIncome = incomeTransactions.reduce(
    (sum, transaction) => sum + (Number(transaction.amount) || 0),
    0,
  );
  const totalExpenses = expenseTransactions.reduce(
    (sum, transaction) => sum + (Number(transaction.amount) || 0),
    0,
  );
  const netCashFlow = totalIncome - totalExpenses;
  const dailyTotals = getDailyTotals(expenseTransactions, startDate, endDate);
  const incomeDailyTotals = getDailyTotals(incomeTransactions, startDate, endDate);
  const incomeReceiptDayAmounts = incomeDailyTotals
    .filter((entry) => entry.amount > 0)
    .map((entry) => entry.amount);
  const categoryTotals = getCategoryTotals(expenseTransactions, categoryLookup);
  const categoryCounts = new Map();
  for (const expense of expenseTransactions) {
    const categoryId = expense.categoryID ? String(expense.categoryID) : null;
    const name = categoryLookup.get(categoryId)?.name || "Uncategorized";
    categoryCounts.set(name, (categoryCounts.get(name) || 0) + 1);
  }
  const budgetUtilization = getBudgetUtilization(budgets, expenseTransactions);
  const budgetBreakdown = getBudgetBreakdown(
    budgets,
    expenseTransactions,
    categoryLookup,
  );
  const pendingBills = bills.filter(
    (bill) => String(bill.status).toLowerCase() === "pending",
  );
  const monthlyCashFlows = getMonthlyCashFlows(
    incomeTransactions,
    expenseTransactions,
    startDate,
    endDate,
  );
  const dailySpendingValues = dailyTotals.map((entry) => entry.amount);
  const incomeStability = incomeReceiptDayAmounts.length >= 2
    ? Math.max(
        0,
        Math.min(
          1,
          1 - safeDivide(
            standardDeviation(incomeReceiptDayAmounts),
            average(incomeReceiptDayAmounts),
            1,
          ),
        ),
      )
    : null;
  const spendingMean = average(dailySpendingValues);
  const spendingCoefficientOfVariation = spendingMean > 0
    ? safeDivide(standardDeviation(dailySpendingValues), spendingMean, 0)
    : null;

  return {
    period: {
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      days,
    },
    counts: {
      incomeTransactions: incomeTransactions.length,
      expenseTransactions: expenseTransactions.length,
      incomeReceiptDays: incomeReceiptDayAmounts.length,
      budgetRecords: budgets.length,
      pendingBills: pendingBills.length,
      recurringSchedules: recurringSchedules.length,
    },
    totals: {
      income: roundMoney(totalIncome),
      expenses: roundMoney(totalExpenses),
      netCashFlow: roundMoney(netCashFlow),
      savingsRate: totalIncome > 0 ? roundRate(netCashFlow / totalIncome) : null,
      expenseToIncomeRatio: totalIncome > 0 ? roundRate(totalExpenses / totalIncome) : null,
    },
    spending: {
      averageDailySpending: roundMoney(totalExpenses / days),
      medianDailySpending: roundMoney(median(dailySpendingValues)),
      spendingFrequency: roundMoney(expenseTransactions.length / days),
      spendingVolatility: roundMoney(standardDeviation(dailySpendingValues)),
      spendingCoefficientOfVariation: spendingCoefficientOfVariation === null
        ? null
        : roundRate(spendingCoefficientOfVariation),
      dailyTotals,
      categoryTotals: Object.fromEntries(
        Object.entries(categoryTotals).map(([category, amount]) => [
          category,
          roundMoney(amount),
        ]),
      ),
    },
    income: {
      averageDailyIncome: roundMoney(totalIncome / days),
      incomeStability: incomeStability === null ? null : roundRate(incomeStability),
      stabilityMethod: "Coefficient of variation across days with recorded income; at least two receipt days are required.",
      dailyTotals: incomeDailyTotals,
    },
    cashFlow: {
      monthly: monthlyCashFlows,
      positiveMonths: monthlyCashFlows.filter(
        (month) => month.complete && month.netCashFlow > 0,
      ).length,
      observedMonths: monthlyCashFlows.filter((month) => month.complete).length,
    },
    obligations: {
      totalBudget: budgetUtilization.budgetAmount,
      budgetMatchedSpending: budgetUtilization.matchedSpending,
      budgetUtilization: budgetUtilization.utilization === null
        ? null
        : roundRate(budgetUtilization.utilization),
      budgetBreakdown,
      pendingBills: roundMoney(
        pendingBills.reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0),
      ),
      recurringMonthlyExpenses: roundMoney(getMonthlyRecurringExpense(recurringSchedules)),
      monthlyEquivalentIncome: roundMoney(
        (totalIncome / days) * (365.2425 / 12),
      ),
      recurringCommitmentRatio: totalIncome > 0
        ? roundRate(
            getMonthlyRecurringExpense(recurringSchedules) /
              ((totalIncome / days) * (365.2425 / 12)),
          )
        : null,
      unclassifiedRecurringSchedules: recurringSchedules.filter(
        (schedule) => schedule.type === "UNCLASSIFIED",
      ).length,
    },
    categoryBreakdown: Object.entries(categoryTotals).map(([category, amount]) => ({
      category,
      transactionCount: categoryCounts.get(category) || 0,
      amount: roundMoney(amount),
      shareOfSpending: totalExpenses > 0
        ? roundMoney(amount / totalExpenses)
        : 0,
    })),
  };
};

const buildComparisonMetrics = (currentMetrics, previousMetrics) => ({
  totalIncomeChange: percentChange(
    currentMetrics.totals.income,
    previousMetrics.totals.income,
  ),
  totalExpensesChange: percentChange(
    currentMetrics.totals.expenses,
    previousMetrics.totals.expenses,
  ),
  savingsRateChange: currentMetrics.totals.savingsRate === null ||
    previousMetrics.totals.savingsRate === null
    ? null
    : roundRate(
        currentMetrics.totals.savingsRate - previousMetrics.totals.savingsRate,
      ),
  averageDailySpendingChange: percentChange(
    currentMetrics.spending.averageDailySpending,
    previousMetrics.spending.averageDailySpending,
  ),
});

module.exports = {
  buildComparisonMetrics,
  buildFinancialMetrics,
  getCategoryTotals,
  getBudgetBreakdown,
  getDailyTotals,
  getMonthlyCashFlows,
  roundMoney,
};
