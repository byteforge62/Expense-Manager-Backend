const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 30.4375;
const RESERVE_MONTHS = 3;

const roundCurrency = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeTransactions = (transactions, cutoff, now) => transactions
  .map((transaction) => ({
    amount: Number(transaction.amount),
    date: new Date(transaction.date),
  }))
  .filter((transaction) =>
    Number.isFinite(transaction.amount) &&
    transaction.amount >= 0 &&
    !Number.isNaN(transaction.date.getTime()) &&
    transaction.date >= cutoff &&
    transaction.date <= now,
  );

const calculateAffordability = ({
  availableCash,
  purchasePrice,
  incomeTransactions,
  expenseTransactions,
  now = new Date(),
}) => {
  if (!Number.isFinite(availableCash) || availableCash < 0) {
    throw new TypeError("Available cash must be a non-negative finite number");
  }
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
    throw new TypeError("Purchase price must be a positive finite number");
  }
  if (!Array.isArray(incomeTransactions) || !Array.isArray(expenseTransactions)) {
    throw new TypeError("Financial transactions must be arrays");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("Analysis timestamp must be a valid Date");
  }

  const cutoff = new Date(now.getTime() - 90 * DAY_MS);
  const normalizedIncome = normalizeTransactions(incomeTransactions, cutoff, now);
  const normalizedExpenses = normalizeTransactions(expenseTransactions, cutoff, now);
  const allTransactions = [...normalizedIncome, ...normalizedExpenses];
  const oldestTimestamp = allTransactions.reduce(
    (oldest, transaction) => Math.min(oldest, transaction.date.getTime()),
    Number.POSITIVE_INFINITY,
  );
  const observedDays = allTransactions.length === 0
    ? 0
    : Math.max(1, Math.ceil((now.getTime() - oldestTimestamp) / DAY_MS) + 1);
  const calculationDays = observedDays === 0 ? 90 : Math.min(90, Math.max(30, observedDays));

  const totalIncome = normalizedIncome.reduce((sum, item) => sum + item.amount, 0);
  const totalExpenses = normalizedExpenses.reduce((sum, item) => sum + item.amount, 0);
  const monthlyIncome = totalIncome / calculationDays * MONTH_DAYS;
  const monthlyExpenses = totalExpenses / calculationDays * MONTH_DAYS;
  const monthlyNetCashFlow = monthlyIncome - monthlyExpenses;
  const postPurchaseCash = availableCash - purchasePrice;
  const emergencyReserveTarget = monthlyExpenses * RESERVE_MONTHS;
  const postPurchaseRunwayMonths = monthlyExpenses > 0
    ? Math.max(0, postPurchaseCash) / monthlyExpenses
    : null;
  const savingsRate = monthlyIncome > 0
    ? (monthlyNetCashFlow / monthlyIncome) * 100
    : null;
  const oneMonthProjection = postPurchaseCash + monthlyNetCashFlow;
  const incomeReductionProjection = postPurchaseCash + (monthlyIncome * 0.85) - monthlyExpenses;
  const unexpectedExpenseProjection = postPurchaseCash - monthlyExpenses;
  const historyConfidence = observedDays >= 60 ? "HIGH" : observedDays >= 30 ? "MEDIUM" : "LOW";

  let riskLevel = "LOW";
  let recommendation = "PURCHASE_WITHIN_PLAN";
  let summary = "The purchase remains above the estimated emergency reserve after payment.";
  if (normalizedIncome.length === 0 || normalizedExpenses.length === 0) {
    riskLevel = "MODERATE";
    recommendation = "INSUFFICIENT_FINANCIAL_HISTORY";
    summary = "The available transaction history is incomplete, so this assessment cannot establish purchase affordability with sufficient confidence.";
  } else if (postPurchaseCash < 0) {
    riskLevel = "CRITICAL";
    recommendation = "DO_NOT_PURCHASE_NOW";
    summary = "The purchase exceeds the cash balance entered and would require additional funding.";
  } else if (postPurchaseCash < emergencyReserveTarget) {
    riskLevel = "HIGH";
    recommendation = "DELAY_OR_REDUCE_COST";
    summary = "The purchase would reduce the remaining cash below the estimated three-month expense reserve.";
  } else if (monthlyNetCashFlow <= 0 || unexpectedExpenseProjection < 0 || incomeReductionProjection < emergencyReserveTarget) {
    riskLevel = "MODERATE";
    recommendation = "REVIEW_TIMING_AND_COMMITMENTS";
    summary = "The purchase is technically covered by the entered cash balance, but one or more stress scenarios weaken the remaining buffer.";
  }

  const warnings = [];
  if (observedDays < 60) {
    warnings.push("Fewer than 60 days of transaction history were found; monthly averages have lower confidence.");
  }
  if (normalizedIncome.length === 0) {
    warnings.push("No income records were found in the analysis period.");
  }
  if (normalizedExpenses.length === 0) {
    warnings.push("No expense records were found in the analysis period; the emergency reserve estimate may be understated.");
  }
  warnings.push("Available cash is user-entered. Loans, credit-card balances, EMIs, pending bills and off-platform obligations are not included unless represented in the recorded transactions.");

  return {
    currency: "INR",
    analysisPeriodDays: calculationDays,
    observedHistoryDays: observedDays,
    historyConfidence,
    inputs: {
      availableCash: roundCurrency(availableCash),
      purchasePrice: roundCurrency(purchasePrice),
    },
    metrics: {
      averageMonthlyIncome: roundCurrency(monthlyIncome),
      averageMonthlyExpenses: roundCurrency(monthlyExpenses),
      averageMonthlyNetCashFlow: roundCurrency(monthlyNetCashFlow),
      savingsRatePercent: savingsRate === null ? null : roundCurrency(savingsRate),
      emergencyReserveTarget: roundCurrency(emergencyReserveTarget),
      cashAfterPurchase: roundCurrency(postPurchaseCash),
      emergencyReserveCoverageMonths: postPurchaseRunwayMonths === null
        ? null
        : roundCurrency(postPurchaseRunwayMonths),
      purchaseAsPercentOfAvailableCash: availableCash > 0
        ? roundCurrency((purchasePrice / availableCash) * 100)
        : null,
    },
    scenarios: {
      oneMonthAfterPurchase: roundCurrency(oneMonthProjection),
      incomeFallsBy15Percent: roundCurrency(incomeReductionProjection),
      unexpectedExpenseOfOneAverageMonth: roundCurrency(unexpectedExpenseProjection),
    },
    risk: {
      level: riskLevel,
      recommendation,
      summary,
    },
    warnings,
    methodology: {
      averageMonthlyIncome: "Recorded income in the trailing 90-day window divided by observed history days (minimum 30), multiplied by 30.4375.",
      averageMonthlyExpenses: "Recorded expenses in the trailing 90-day window divided by observed history days (minimum 30), multiplied by 30.4375.",
      emergencyReserve: `${RESERVE_MONTHS} multiplied by average monthly recorded expenses.`,
      incomeStress: "One-month projection after purchase with recorded average monthly income reduced by 15%.",
      unexpectedExpenseStress: "Cash after purchase less one average month of recorded expenses.",
    },
    analyzedAt: now.toISOString(),
  };
};

module.exports = { calculateAffordability };
