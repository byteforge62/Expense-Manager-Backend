const {
  DAY_IN_MS,
  HISTORY_DAYS,
  SUPPORTED_HORIZONS,
  SCENARIOS,
} = require("./forecast.constants");

const {
  toDate,
  getMonthStart,
  addCalendarMonths,
  getRecurringOccurrences,
} = require("./forecast-calendar");

const roundMoney = (value) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const validateAmount = (value, fieldName) => {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new TypeError(`${fieldName} must be a finite non-negative number`);
  }

  return amount;
};

const validateTransactions = (transactions, fieldName) => {
  if (!Array.isArray(transactions)) {
    throw new TypeError(`${fieldName} must be an array`);
  }

  return transactions.map((transaction, index) => ({
    amount: validateAmount(
      transaction.amount,
      `${fieldName}[${index}].amount`,
    ),
    date: toDate(transaction.date, `${fieldName}[${index}].date`),
  }));
};

const getDailyAverage = (transactions, historyStart, now) => {
  const total = transactions.reduce((sum, transaction) => {
    if (transaction.date < historyStart || transaction.date >= now) {
      return sum;
    }

    return sum + transaction.amount;
  }, 0);

  const elapsedDays = Math.max(
    1,
    (now.getTime() - historyStart.getTime()) / DAY_IN_MS,
  );

  return total / elapsedDays;
};

const getMonthBuckets = (startDate, endDate) => {
  const buckets = [];
  let cursor = getMonthStart(startDate);

  while (cursor < endDate) {
    const nextMonth = addCalendarMonths(cursor, 1);
    const bucketStart =
      cursor < startDate ? new Date(startDate) : new Date(cursor);
    const bucketEnd =
      nextMonth > endDate ? new Date(endDate) : new Date(nextMonth);

    buckets.push({
      key: `${cursor.getUTCFullYear()}-${String(
        cursor.getUTCMonth() + 1,
      ).padStart(2, "0")}`,
      startDate: bucketStart,
      endDate: bucketEnd,
      days: (bucketEnd.getTime() - bucketStart.getTime()) / DAY_IN_MS,
    });

    cursor = nextMonth;
  }

  return buckets;
};

const getBucketIndex = (date, buckets) =>
  buckets.findIndex(
    (bucket) => date >= bucket.startDate && date < bucket.endDate,
  );

const allocateRecurringFlows = (schedules, startDate, endDate, buckets) => {
  const recurringIncome = Array(buckets.length).fill(0);
  const recurringExpenses = Array(buckets.length).fill(0);
  const warnings = [];
  let ignoredUnclassifiedSchedules = 0;

  for (const schedule of schedules) {
    if (!schedule.isActive) continue;

    if (!schedule.type || schedule.type === "UNCLASSIFIED") {
      ignoredUnclassifiedSchedules += 1;
      continue;
    }

    if (!["INCOME", "EXPENSE"].includes(schedule.type)) {
      throw new TypeError(
        `Recurring schedule ${schedule._id || schedule.title || ""} has an invalid type`,
      );
    }

    const amount = validateAmount(
      schedule.amount,
      `Recurring schedule ${schedule.title || ""} amount`,
    );

    const occurrences = getRecurringOccurrences({
      schedule,
      startDate,
      endDate,
    });

    for (const occurrence of occurrences) {
      const index = getBucketIndex(occurrence.date, buckets);

      if (index === -1) continue;

      if (schedule.type === "INCOME") {
        recurringIncome[index] += amount;
      } else {
        recurringExpenses[index] += amount;
      }
    }
  }

  if (ignoredUnclassifiedSchedules > 0) {
    warnings.push(
      `${ignoredUnclassifiedSchedules} active recurring schedule(s) with UNCLASSIFIED type were excluded from the forecast.`,
    );
  }

  return {
    recurringIncome,
    recurringExpenses,
    warnings,
  };
};

const allocatePendingBills = (bills, startDate, endDate, buckets) => {
  const pendingBillExpenses = Array(buckets.length).fill(0);
  const warnings = [];

  for (const bill of bills) {
    if (bill.status !== "pending" || bill.settledExpenseId) continue;

    const dueDate = toDate(bill.dueDate, "Pending bill dueDate");
    if (dueDate >= endDate) continue;

    // Overdue pending bills are treated as due immediately.
    const effectiveDate = dueDate < startDate ? startDate : dueDate;
    const index = getBucketIndex(effectiveDate, buckets);

    if (index === -1) continue;

    pendingBillExpenses[index] += validateAmount(
      bill.amount,
      `Pending bill ${bill.name || ""} amount`,
    );
  }

  if (bills.some((bill) => bill.status === "pending" && !bill.settledExpenseId)) {
    warnings.push(
      "Pending bills are included as future commitments. If a corresponding expense was already recorded, link or reconcile it to avoid double-counting.",
    );
  }

  return { pendingBillExpenses, warnings };
};

const buildScenario = ({
  openingCash,
  buckets,
  dailyIncome,
  dailyExpenses,
  recurringIncome,
  recurringExpenses,
  pendingBillExpenses,
  scenario,
}) => {
  let closingBalance = openingCash;

  const monthly = buckets.map((bucket, index) => {
    const baselineIncome =
      dailyIncome * bucket.days * scenario.incomeMultiplier;

    const baselineExpenses =
      dailyExpenses * bucket.days * scenario.expenseMultiplier;

    const scheduledIncome = recurringIncome[index];
    const scheduledExpenses = recurringExpenses[index];
    const pendingBills = pendingBillExpenses[index];

    const totalIncome = baselineIncome + scheduledIncome;
    const totalExpenses =
      baselineExpenses + scheduledExpenses + pendingBills;

    const netCashFlow = totalIncome - totalExpenses;
    closingBalance += netCashFlow;

    return {
      month: bucket.key,
      periodStart: bucket.startDate.toISOString(),
      periodEnd: bucket.endDate.toISOString(),
      daysCovered: roundMoney(bucket.days),
      baselineIncome: roundMoney(baselineIncome),
      scheduledIncome: roundMoney(scheduledIncome),
      baselineExpenses: roundMoney(baselineExpenses),
      scheduledExpenses: roundMoney(scheduledExpenses),
      pendingBills: roundMoney(pendingBills),
      totalIncome: roundMoney(totalIncome),
      totalExpenses: roundMoney(totalExpenses),
      netCashFlow: roundMoney(netCashFlow),
      closingBalance: roundMoney(closingBalance),
    };
  });

  return {
    description: scenario.description,
    openingCash: roundMoney(openingCash),
    totalIncome: roundMoney(
      monthly.reduce((sum, month) => sum + month.totalIncome, 0),
    ),
    totalExpenses: roundMoney(
      monthly.reduce((sum, month) => sum + month.totalExpenses, 0),
    ),
    netCashFlow: roundMoney(
      monthly.reduce((sum, month) => sum + month.netCashFlow, 0),
    ),
    closingBalance: monthly.length
      ? monthly[monthly.length - 1].closingBalance
      : roundMoney(openingCash),
    monthly,
  };
};

const calculateDataConfidence = ({
  incomeCount,
  expenseCount,
  dailyIncome,
  dailyExpenses,
}) => {
  if (
    incomeCount < 3 ||
    expenseCount < 3 ||
    dailyIncome === 0 ||
    dailyExpenses === 0
  ) {
    return {
      level: "LOW",
      explanation:
        "Limited historical transaction data is available. Forecast results may be unreliable.",
    };
  }

  if (incomeCount >= 20 && expenseCount >= 20) {
    return {
      level: "HIGH",
      explanation:
        "At least 20 historical income and expense transactions are available.",
    };
  }

  return {
    level: "MEDIUM",
    explanation:
      "Some historical transaction data is available, but the baseline may not represent stable long-term behavior.",
  };
};

const calculateFinancialForecast = ({
  openingCash,
  horizonMonths,
  incomeTransactions,
  expenseTransactions,
  recurringSchedules = [],
  pendingBills = [],
  now = new Date(),
}) => {
  const cash = validateAmount(openingCash, "openingCash");

  if (!SUPPORTED_HORIZONS.includes(horizonMonths)) {
    throw new RangeError(
      `horizonMonths must be one of: ${SUPPORTED_HORIZONS.join(", ")}`,
    );
  }

  if (!Array.isArray(recurringSchedules)) {
    throw new TypeError("recurringSchedules must be an array");
  }

  if (!Array.isArray(pendingBills)) {
    throw new TypeError("pendingBills must be an array");
  }

  const currentDate = toDate(now, "now");
  const historyStart = new Date(
    currentDate.getTime() - HISTORY_DAYS * DAY_IN_MS,
  );

  const forecastStart = currentDate;
  const forecastEnd = addCalendarMonths(
    getMonthStart(currentDate),
    horizonMonths,
  );

  const incomes = validateTransactions(
    incomeTransactions,
    "incomeTransactions",
  );

  const expenses = validateTransactions(
    expenseTransactions,
    "expenseTransactions",
  );

  const dailyIncome = getDailyAverage(
    incomes,
    historyStart,
    currentDate,
  );

  const dailyExpenses = getDailyAverage(
    expenses,
    historyStart,
    currentDate,
  );

  const buckets = getMonthBuckets(forecastStart, forecastEnd);

  const recurring = allocateRecurringFlows(
    recurringSchedules,
    forecastStart,
    forecastEnd,
    buckets,
  );

  const bills = allocatePendingBills(
    pendingBills,
    forecastStart,
    forecastEnd,
    buckets,
  );

  const warnings = [
    ...recurring.warnings,
    ...bills.warnings,
  ];

  if (incomes.length === 0) {
    warnings.push(
      "No historical income transactions were found in the 90-day lookback period.",
    );
  }

  if (expenses.length === 0) {
    warnings.push(
      "No historical expense transactions were found in the 90-day lookback period.",
    );
  }

  const scenarios = {};

  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    scenarios[name] = buildScenario({
      openingCash: cash,
      buckets,
      dailyIncome,
      dailyExpenses,
      recurringIncome: recurring.recurringIncome,
      recurringExpenses: recurring.recurringExpenses,
      pendingBillExpenses: bills.pendingBillExpenses,
      scenario,
    });
  }

  const confidence = calculateDataConfidence({
    incomeCount: incomes.filter(
      (transaction) =>
        transaction.date >= historyStart &&
        transaction.date < currentDate,
    ).length,
    expenseCount: expenses.filter(
      (transaction) =>
        transaction.date >= historyStart &&
        transaction.date < currentDate,
    ).length,
    dailyIncome,
    dailyExpenses,
  });

  return {
    currency: "INR",
    generatedAt: currentDate.toISOString(),
    forecastPeriod: {
      startDate: forecastStart.toISOString(),
      endDate: forecastEnd.toISOString(),
      horizonMonths,
      bucketCount: buckets.length,
    },
    historicalWindow: {
      startDate: historyStart.toISOString(),
      endDate: currentDate.toISOString(),
      days: HISTORY_DAYS,
      incomeTransactions: incomes.length,
      expenseTransactions: expenses.length,
    },
    openingCash: roundMoney(cash),
    historicalDailyBaseline: {
      income: roundMoney(dailyIncome),
      expenses: roundMoney(dailyExpenses),
      netCashFlow: roundMoney(dailyIncome - dailyExpenses),
    },
    dataConfidence: confidence,
    assumptions: [
      "Historical non-recurring transactions are projected using their average daily amount over the previous 90 days.",
      "Generated transactions linked to recurring schedules must be excluded from historical baseline queries.",
      "Active recurring schedules are projected on their scheduled dates and are not multiplied by scenario adjustments.",
      "Pending bills are included on their due dates. Overdue pending bills are included in the first forecast period.",
      "Paid bills are excluded.",
      "Best-case and worst-case scenarios adjust only historical baseline income and expenses; they are illustrative assumptions, not statistical predictions or guarantees.",
      "Forecast periods use UTC calendar-month boundaries.",
      "Opening cash is supplied by the user and is not inferred from transaction history.",
    ],
    warnings,
    scenarios,
  };
};

module.exports = {
  calculateFinancialForecast,
  roundMoney,
};