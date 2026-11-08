const { percentChange, roundMoney } = require("../utils/statistics");
const { getUtcDayKeys } = require("../utils/date.utils");

const summarizeWeekdayPatterns = (transactions, startDate, endDate) => {
  const weekdays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const totals = new Map(
    weekdays.map((day) => [
      day,
      { amount: 0, count: 0, daysObserved: 0 },
    ]),
  );

  if (startDate && endDate) {
    for (const dateKey of getUtcDayKeys(startDate, endDate)) {
      const date = new Date(`${dateKey}T00:00:00.000Z`);
      totals.get(weekdays[date.getUTCDay()]).daysObserved += 1;
    }
  }

  for (const transaction of transactions) {
    const date = new Date(transaction.date);
    const amount = Number(transaction.amount);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(amount)) {
      continue;
    }

    const value = totals.get(weekdays[date.getUTCDay()]);
    value.amount += amount;
    value.count += 1;
  }

  return Object.fromEntries(
    [...totals.entries()]
      .sort(([, first], [, second]) =>
        second.amount / second.daysObserved - first.amount / first.daysObserved,
      )
      .map(([day, value]) => [
        day,
        {
          amount: roundMoney(value.amount),
          transactionCount: value.count,
          averageTransaction: roundMoney(value.amount / value.count),
          daysObserved: value.daysObserved,
          averagePerDay: roundMoney(value.amount / value.daysObserved),
        },
      ]),
  );
};

const createChangeObservation = ({
  type,
  label,
  current,
  previous,
  currentPeriod,
  previousPeriod,
}) => {
  const changePercent = percentChange(current, previous);
  const isNew = previous === 0 && current > 0;
  const delta = current - previous;

  return {
    type,
    ...(label ? { category: label } : {}),
    observed: roundMoney(current),
    baseline: roundMoney(previous),
    delta: roundMoney(delta),
    changePercent: isNew ? null : roundMoney(changePercent),
    comparison: {
      currentPeriod,
      baselinePeriod: previousPeriod,
    },
    summary: isNew
      ? `${label || "Spending"} was ${roundMoney(current)} in the current period; no spending was recorded in the comparable baseline period.`
      : `${label || "Spending"} ${delta >= 0 ? "increased" : "decreased"} by ${roundMoney(Math.abs(delta))} (${roundMoney(changePercent)}%) compared with the equally long prior period.`,
  };
};

const buildBehavioralAnalysis = ({
  currentMetrics,
  previousMetrics,
  currentExpenses,
  previousExpenses,
}) => {
  const observations = [];
  const categoryChanges = {};
  const currentCategories = currentMetrics.spending.categoryTotals || {};
  const previousCategories = previousMetrics.spending.categoryTotals || {};
  const categories = new Set([
    ...Object.keys(currentCategories),
    ...Object.keys(previousCategories),
  ]);
  const currentPeriod = {
    start: currentMetrics.period.startDate,
    end: currentMetrics.period.endDate,
  };
  const previousPeriod = {
    start: previousMetrics.period.startDate,
    end: previousMetrics.period.endDate,
  };

  for (const category of categories) {
    const current = currentCategories[category] || 0;
    const previous = previousCategories[category] || 0;
    const changePercent = percentChange(current, previous);
    categoryChanges[category] = {
      current: roundMoney(current),
      baseline: roundMoney(previous),
      delta: roundMoney(current - previous),
      changePercent: changePercent === null ? null : roundMoney(changePercent),
    };

    if (current !== previous && (current > 0 || previous > 0)) {
      observations.push(createChangeObservation({
        type: "category-change",
        label: category,
        current,
        previous,
        currentPeriod,
        previousPeriod,
      }));
    }
  }

  for (const [type, label, current, previous] of [
    [
      "spending-trend",
      "Total spending",
      currentMetrics.totals.expenses,
      previousMetrics.totals.expenses,
    ],
    [
      "income-trend",
      "Income",
      currentMetrics.totals.income,
      previousMetrics.totals.income,
    ],
    [
      "daily-spending-trend",
      "Average daily spending",
      currentMetrics.spending.averageDailySpending,
      previousMetrics.spending.averageDailySpending,
    ],
  ]) {
    if (current !== previous && (current > 0 || previous > 0)) {
      observations.push(createChangeObservation({
        type,
        label,
        current,
        previous,
        currentPeriod,
        previousPeriod,
      }));
    }
  }

  const currentWeekdays = summarizeWeekdayPatterns(
    currentExpenses,
    currentMetrics.period.startDate,
    currentMetrics.period.endDate,
  );
  const previousWeekdays = summarizeWeekdayPatterns(
    previousExpenses,
    previousMetrics.period.startDate,
    previousMetrics.period.endDate,
  );
  const primaryWeekday = Object.entries(currentWeekdays).find(
    ([, value]) => value.transactionCount > 0,
  );

  if (primaryWeekday) {
    observations.push({
      type: "weekday-pattern",
      currentDay: primaryWeekday[0],
      observed: primaryWeekday[1].averagePerDay,
      periodTotal: primaryWeekday[1].amount,
      daysObserved: primaryWeekday[1].daysObserved,
      transactionCount: primaryWeekday[1].transactionCount,
      baseline: previousWeekdays[primaryWeekday[0]]?.averagePerDay ?? null,
      comparison: {
        currentPeriod,
        baselinePeriod: previousPeriod,
      },
      summary: `${primaryWeekday[0]} had the highest average spending per calendar occurrence at ${primaryWeekday[1].averagePerDay} across ${primaryWeekday[1].daysObserved} days and ${primaryWeekday[1].transactionCount} transactions in the current period.`,
    });
  }

  const spendingCv = currentMetrics.spending.spendingCoefficientOfVariation;
  const spendingLevel = spendingCv === null
    ? "not-assessed"
    : spendingCv < 0.5
      ? "lower"
      : spendingCv < 1
        ? "moderate"
        : "higher";

  return {
    window: {
      currentStart: currentMetrics.period.startDate,
      currentEnd: currentMetrics.period.endDate,
      comparisonStart: previousMetrics.period.startDate,
      comparisonEnd: previousMetrics.period.endDate,
      comparisonDays: previousMetrics.period.days,
    },
    observations,
    categoryChanges,
    spendingConsistency: {
      coefficientOfVariation: spendingCv,
      level: spendingLevel,
      observedDays: currentMetrics.period.days,
      explanation: spendingCv === null
        ? "Spending consistency is not assessed because there was no recorded spending."
        : `Daily-spend coefficient of variation was ${spendingCv}; values below 0.5 are described as lower variability, 0.5-1 as moderate, and above 1 as higher variability.`,
    },
    incomeConsistency: {
      coefficient: currentMetrics.income.incomeStability,
      level: currentMetrics.income.incomeStability === null
        ? "insufficient-data"
        : currentMetrics.income.incomeStability >= 0.8
          ? "higher"
          : currentMetrics.income.incomeStability >= 0.3
            ? "moderate"
            : "lower",
      receiptDays: currentMetrics.counts.incomeReceiptDays,
      explanation: currentMetrics.income.stabilityMethod,
    },
    weekdayPatterns: {
      current: currentWeekdays,
      previous: previousWeekdays,
    },
  };
};

module.exports = {
  buildBehavioralAnalysis,
  summarizeWeekdayPatterns,
};
