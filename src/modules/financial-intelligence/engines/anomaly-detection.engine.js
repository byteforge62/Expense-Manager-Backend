const {
  average,
  median,
  medianAbsoluteDeviation,
  roundMoney,
  standardDeviation,
} = require("../utils/statistics");

const MIN_TRANSACTION_BASELINE = 5;
const MIN_DAILY_BASELINE = 14;
const MAD_SCALE = 1.4826;

const getCategoryName = (expense, categoryLookup) => {
  const categoryId = expense.categoryID ? String(expense.categoryID) : null;
  return categoryLookup.get(categoryId)?.name || "Uncategorized";
};

const sumByDate = (transactions, selector) => {
  const totals = new Map();
  for (const transaction of transactions) {
    const date = new Date(transaction.date);
    const amount = Number(selector(transaction));
    if (Number.isNaN(date.getTime()) || !Number.isFinite(amount)) {
      continue;
    }

    const key = date.toISOString().slice(0, 10);
    totals.set(key, (totals.get(key) || 0) + amount);
  }
  return totals;
};

const getRobustThreshold = (values) => {
  const center = median(values);
  const mad = medianAbsoluteDeviation(values);
  const scaledMad = MAD_SCALE * mad;
  const threshold = center + (
    scaledMad > 0
      ? 3 * scaledMad
      : Math.max(center * 0.5, standardDeviation(values) * 2)
  );
  return { center, threshold, mad };
};

const createAnomaly = ({
  type,
  title,
  category,
  date,
  transactionId,
  amount,
  baseline,
  method,
  threshold,
  reason,
}) => {
  const deviation = amount - baseline;
  return {
    type,
    title,
    ...(category ? { category } : {}),
    ...(date ? { date: new Date(date).toISOString() } : {}),
    ...(transactionId ? { transactionId: String(transactionId) } : {}),
    amount: roundMoney(amount),
    baseline: roundMoney(baseline),
    deviation: roundMoney(deviation),
    deviationPercent: baseline > 0
      ? roundMoney((deviation / baseline) * 100)
      : null,
    method,
    severity: threshold > 0 && amount >= threshold * 2 ? "high" : "medium",
    reason,
  };
};

const detectAnomalies = ({
  expenses,
  previousExpenses,
  categoryLookup,
  currentMetrics,
  previousMetrics,
}) => {
  const anomalies = [];
  const historicalByCategory = new Map();
  const eligibleTransactionCategories = new Set();
  const currentByCategory = new Map();

  for (const expense of previousExpenses) {
    const category = getCategoryName(expense, categoryLookup);
    const amount = Number(expense.amount);
    if (Number.isFinite(amount) && amount > 0) {
      const values = historicalByCategory.get(category) || [];
      values.push(amount);
      historicalByCategory.set(category, values);
    }
  }

  for (const expense of expenses) {
    const amount = Number(expense.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const category = getCategoryName(expense, categoryLookup);
    const baseline = historicalByCategory.get(category) || [];
    if (baseline.length >= MIN_TRANSACTION_BASELINE) {
      eligibleTransactionCategories.add(category);
    }
    if (baseline.length >= MIN_TRANSACTION_BASELINE) {
      const { center, threshold } = getRobustThreshold(baseline);
      if (amount > threshold && amount > center) {
        anomalies.push(createAnomaly({
          type: "large-transaction",
          title: "Unusually large transaction",
          category,
          date: expense.date,
          transactionId: expense._id,
          amount,
          baseline: center,
          threshold,
          method: "Category-specific historical median plus three scaled median absolute deviations; five historical transactions required.",
          reason: `This transaction is above the ${category} transaction threshold derived from ${baseline.length} prior-period transactions. This is a statistical deviation, not evidence of fraud.`,
        }));
      }
    }

    const currentCategoryExpenses = currentByCategory.get(category) || [];
    currentCategoryExpenses.push(expense);
    currentByCategory.set(category, currentCategoryExpenses);
  }

  const previousDays = previousMetrics?.spending.dailyTotals || [];
  const currentDays = currentMetrics?.spending.dailyTotals || [];
  const historicalDailySpend = previousDays.map((day) => Number(day.amount) || 0);

  if (
    previousDays.length >= MIN_DAILY_BASELINE &&
    historicalDailySpend.filter((amount) => amount > 0).length >= 3
  ) {
    const { center, threshold } = getRobustThreshold(historicalDailySpend);
    for (const day of currentDays) {
      if (day.amount > threshold && day.amount > center) {
        anomalies.push(createAnomaly({
          type: "daily-spend-anomaly",
          title: "Unusual daily expenditure",
          date: day.date,
          amount: day.amount,
          baseline: center,
          threshold,
          method: "Historical daily median plus three scaled median absolute deviations; at least 14 baseline days and three days with spending required.",
          reason: "This day's total exceeds the robust daily-spending baseline from the comparable prior period. It identifies an unusual value, not its cause.",
        }));
      }
    }
  }

  const historicalCategoryDailySpend = new Map();
  for (const [category, transactions] of historicalByCategory) {
    if (transactions.length < MIN_TRANSACTION_BASELINE) {
      continue;
    }
    const categoryTransactions = previousExpenses.filter(
      (expense) => getCategoryName(expense, categoryLookup) === category,
    );
    const categoryDaily = sumByDate(
      categoryTransactions,
      (expense) => Number(expense.amount) || 0,
    );
    historicalCategoryDailySpend.set(
      category,
      previousDays.map(({ date }) => categoryDaily.get(date) || 0),
    );
  }

  for (const [category, transactions] of currentByCategory) {
    const historicalValues = historicalCategoryDailySpend.get(category);
    if (!historicalValues || historicalValues.length < MIN_DAILY_BASELINE) {
      continue;
    }
    const { center, threshold } = getRobustThreshold(historicalValues);
    const currentTotal = transactions.reduce(
      (sum, transaction) => sum + Number(transaction.amount),
      0,
    );
    const currentDailyAverage = currentTotal / Math.max(currentDays.length, 1);
    const baselineComparableTotal =
      average(historicalValues) * currentDays.length;
    const thresholdDailyAverage = threshold;

    if (
      currentDailyAverage > thresholdDailyAverage &&
      currentDailyAverage > center
    ) {
      anomalies.push(createAnomaly({
        type: "category-spike",
        title: "Category spending spike",
        category,
        amount: currentTotal,
        baseline: baselineComparableTotal,
        threshold: thresholdDailyAverage * currentDays.length,
        method: "Category-specific daily spend compared with the same-length prior-period daily series using a median and scaled MAD; five historical transactions required.",
        reason: `Daily ${category} spending exceeds its comparable historical daily baseline. The baseline uses the same number of calendar days to avoid period-length bias.`,
      }));
    }
  }

  const previousDailyFrequency = new Map();
  for (const { date } of previousDays) {
    previousDailyFrequency.set(date, 0);
  }
  for (const expense of previousExpenses) {
    const key = new Date(expense.date).toISOString().slice(0, 10);
    previousDailyFrequency.set(key, (previousDailyFrequency.get(key) || 0) + 1);
  }

  if (
    previousDays.length >= MIN_DAILY_BASELINE &&
    previousExpenses.length >= MIN_TRANSACTION_BASELINE
  ) {
    const historicalCounts = [...previousDailyFrequency.values()];
    const { center, threshold } = getRobustThreshold(historicalCounts);
    const frequencyThreshold = Math.max(
      threshold,
      average(historicalCounts) + 3 * Math.sqrt(average(historicalCounts)),
      3,
    );
    const currentDailyFrequency = new Map();
    for (const expense of expenses) {
      const key = new Date(expense.date).toISOString().slice(0, 10);
      currentDailyFrequency.set(key, (currentDailyFrequency.get(key) || 0) + 1);
    }

    for (const [date, count] of currentDailyFrequency) {
      if (count > frequencyThreshold && count > center) {
        const dayTransactions = expenses.filter(
          (expense) => new Date(expense.date).toISOString().slice(0, 10) === date,
        );
        anomalies.push(createAnomaly({
          type: "transaction-frequency",
          title: "Unusual transaction frequency",
          date,
          amount: count,
          baseline: center,
          threshold: frequencyThreshold,
          method: "Daily transaction-count median/MAD, with a Poisson-style mean-plus-three-square-roots floor and a four-transaction minimum; at least 14 comparable baseline days required.",
          reason: `${count} expenses were recorded on this day, above the historical daily transaction-count baseline.`,
        }));
        anomalies[anomalies.length - 1].transactionCount = count;
        anomalies[anomalies.length - 1].transactionIds = dayTransactions
          .map((transaction) => String(transaction._id))
          .filter(Boolean);
      }
    }
  }

  const severityRank = { high: 2, medium: 1 };
  anomalies.sort(
    (first, second) => severityRank[second.severity] - severityRank[first.severity],
  );

  return {
    anomalies: anomalies.slice(0, 20),
    summary: {
      count: anomalies.length,
      minimumTransactionBaseline: MIN_TRANSACTION_BASELINE,
      minimumDailyBaseline: MIN_DAILY_BASELINE,
      insufficientBaseline: previousExpenses.length < MIN_TRANSACTION_BASELINE,
      eligibleTransactionCategories: eligibleTransactionCategories.size,
      baselinePeriod: previousMetrics?.period || null,
    },
  };
};

module.exports = {
  detectAnomalies,
  getRobustThreshold,
};
