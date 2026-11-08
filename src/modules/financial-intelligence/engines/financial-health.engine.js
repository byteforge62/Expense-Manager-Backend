const { roundMoney } = require("../utils/statistics");

const COMPONENTS = {
  savingsRate: { weight: 30, favorable: [0, 0.2] },
  incomeStability: { weight: 20, favorable: [0.3, 0.8] },
  expenseToIncome: { weight: 20, favorable: [0.3, 1] },
  cashFlowStability: { weight: 15 },
  budgetUtilization: { weight: 10, favorable: [0.75, 1.25] },
  recurringCommitment: { weight: 5, favorable: [0.2, 0.6] },
};

const interpolateScore = (value, lower, upper) => {
  if (value <= lower) {
    return 90;
  }
  if (value >= upper) {
    return 25;
  }
  return 90 - ((value - lower) / (upper - lower)) * 65;
};

const interpolateHigherIsBetter = (value, lower, upper) => {
  if (value <= lower) {
    return 25;
  }
  if (value >= upper) {
    return 90;
  }
  return 25 + ((value - lower) / (upper - lower)) * 65;
};

const createComponent = ({ value, weight, observed, explanation, score }) => ({
  weight,
  score: score === null ? null : roundMoney(Math.max(0, Math.min(100, score))),
  value: value === null ? null : roundMoney(value),
  observed,
  explanation,
});

const assessFinancialHealth = ({ metrics }) => {
  const { totals, income, obligations, cashFlow, period, counts } = metrics;
  const missingData = [];
  const monthlyIncome = period.days > 0
    ? (totals.income / period.days) * (365.2425 / 12)
    : 0;
  const recurringShare = monthlyIncome > 0
    ? obligations.recurringMonthlyExpenses / monthlyIncome
    : null;
  const budgetUtilization = obligations.budgetUtilization;
  const incomeStability = income.incomeStability;
  const cashFlowStability = cashFlow.observedMonths >= 2
    ? cashFlow.positiveMonths / cashFlow.observedMonths
    : null;

  const components = {
    savingsRate: createComponent({
      value: totals.savingsRate,
      weight: COMPONENTS.savingsRate.weight,
      score: totals.savingsRate === null
        ? null
        : interpolateHigherIsBetter(
            totals.savingsRate,
            ...COMPONENTS.savingsRate.favorable,
          ),
      observed: totals.savingsRate === null
        ? "Savings rate is unavailable because no income was recorded in the period."
        : `Recorded income remaining after expenses was ${roundMoney(totals.savingsRate * 100)}%.`,
      explanation: "The score rises from 25 at a zero savings rate to 90 at a 20% or higher rate; negative savings remain at the lower end because expenses exceed income.",
    }),
    incomeStability: createComponent({
      value: incomeStability,
      weight: COMPONENTS.incomeStability.weight,
      score: incomeStability === null
        ? null
        : interpolateHigherIsBetter(
            incomeStability,
            ...COMPONENTS.incomeStability.favorable,
          ),
      observed: incomeStability === null
        ? "Income stability is unavailable; at least two income receipt days are required."
        : `Income receipt-day stability was ${roundMoney(incomeStability * 100)}% based on recorded receipt amounts.`,
      explanation: "A coefficient-of-variation-based indicator is mapped to 25-90: stability of 80% or higher scores 90, while stability of 30% or lower scores 25.",
    }),
    expenseToIncome: createComponent({
      value: totals.expenseToIncomeRatio,
      weight: COMPONENTS.expenseToIncome.weight,
      score: totals.expenseToIncomeRatio === null
        ? null
        : interpolateScore(
            totals.expenseToIncomeRatio,
            ...COMPONENTS.expenseToIncome.favorable,
          ),
      observed: totals.expenseToIncomeRatio === null
        ? "Expense-to-income ratio is unavailable because no income was recorded."
        : `Recorded expenses were ${roundMoney(totals.expenseToIncomeRatio * 100)}% of recorded income.`,
      explanation: "The score is 90 at a ratio of 30% or lower and 25 at 100% or higher, with linear interpolation between those points.",
    }),
    cashFlowStability: createComponent({
      value: cashFlowStability,
      weight: COMPONENTS.cashFlowStability.weight,
      score: cashFlowStability === null ? null : cashFlowStability * 100,
      observed: cashFlowStability === null
        ? "Monthly cash-flow stability is unavailable; at least two calendar months are required."
        : `Net cash flow was positive in ${cashFlow.positiveMonths} of ${cashFlow.observedMonths} calendar months.`,
      explanation: "This component is the share of observed calendar months with positive net cash flow; it does not infer a future cash buffer.",
    }),
    budgetUtilization: createComponent({
      value: budgetUtilization,
      weight: COMPONENTS.budgetUtilization.weight,
      score: budgetUtilization === null
        ? null
        : interpolateScore(
            budgetUtilization,
            ...COMPONENTS.budgetUtilization.favorable,
          ),
      observed: budgetUtilization === null
        ? "Budget utilization is unavailable because no applicable positive budget was found."
        : `Matched spending used ${roundMoney(budgetUtilization * 100)}% of the applicable budget amount.`,
      explanation: "Utilization at or below 75% scores 90, utilization at or above 125% scores 25, and the interval is linearly interpolated.",
    }),
    recurringCommitment: createComponent({
      value: recurringShare,
      weight: COMPONENTS.recurringCommitment.weight,
      score: recurringShare === null
        ? null
        : interpolateScore(
            recurringShare,
            ...COMPONENTS.recurringCommitment.favorable,
          ),
      observed: recurringShare === null
        ? "Recurring commitment share is unavailable because no income was recorded."
        : `Classified recurring expenses represent ${roundMoney(recurringShare * 100)}% of the period's monthly-equivalent income.`,
      explanation: "Recurring commitments are converted to monthly equivalents by schedule frequency; a share at or below 20% scores 90 and a share at or above 60% scores 25.",
    }),
  };

  if (period.days < 30) {
    missingData.push("At least 30 calendar days are required for an overall health score.");
  }
  if (counts.incomeReceiptDays < 2 || totals.income <= 0) {
    missingData.push("Positive recorded income across at least two receipt days is required for an overall health score.");
  }
  if (incomeStability === null) {
    missingData.push("Income stability requires at least two income receipt days.");
  }
  if (cashFlowStability === null) {
    missingData.push("Cash-flow stability requires at least two calendar months.");
  }
  if (budgetUtilization === null) {
    missingData.push("No applicable budget was available for budget-utilization scoring.");
  }
  if (obligations.unclassifiedRecurringSchedules > 0) {
    missingData.push(
      `${obligations.unclassifiedRecurringSchedules} active recurring schedule(s) have no income/expense classification and were excluded from commitment scoring.`,
    );
  }

  const hasCoreData = period.days >= 30 &&
    counts.incomeReceiptDays >= 2 &&
    totals.income > 0;
  const availableComponents = Object.values(components).filter(
    (component) => component.score !== null,
  );
  const availableWeight = availableComponents.reduce(
    (sum, component) => sum + component.weight,
    0,
  );
  const score = hasCoreData && availableWeight > 0
    ? roundMoney(
        availableComponents.reduce(
          (sum, component) => sum + component.score * component.weight,
          0,
        ) / availableWeight,
      )
    : null;

  const observedRisk = {
    spendingPressure: totals.expenseToIncomeRatio === null
      ? {
          level: "not-assessed",
          explanation: "No positive recorded income is available as a denominator.",
        }
      : {
          level: totals.expenseToIncomeRatio > 1
            ? "high"
            : totals.expenseToIncomeRatio > 0.9
              ? "moderate"
              : "low",
          explanation: `Observed expenses were ${roundMoney(totals.expenseToIncomeRatio * 100)}% of recorded income in this period.`,
        },
    pendingBills: {
      amount: obligations.pendingBills,
      count: counts.pendingBills,
      explanation: counts.pendingBills > 0
        ? "These pending, unsettled bills are outstanding obligations; no affordability conclusion is inferred."
        : "No pending unsettled bills due by the end of the selected period were found.",
    },
  };

  const recurringRisk = recurringShare === null
    ? {
        level: "not-assessed",
        explanation: "A recurring-commitment ratio needs positive recorded income.",
      }
    : {
        level: recurringShare > 0.4 ? "elevated" : "observed",
        shareOfMonthlyIncome: roundMoney(recurringShare),
        explanation: "This is an inferred commitment pressure based on active classified recurring schedules, not a measured cash balance.",
      };

  return {
    score,
    label: score === null
      ? "Insufficient data"
      : score >= 80
        ? "Strong"
        : score >= 60
          ? "Stable"
          : score >= 40
            ? "Watchlist"
            : "At risk",
    scoreRange: "0-100; higher values indicate more favorable observed indicators, not a credit score or professional financial rating.",
    scoringWeights: Object.fromEntries(
      Object.entries(COMPONENTS).map(([name, component]) => [name, component.weight]),
    ),
    availableWeight,
    components,
    observedRisk,
    inferredRisk: {
      recurringCommitment: recurringRisk,
      financialBuffer: {
        level: "not-assessed",
        explanation: "No verified cash-balance or reserve data is available in the included models.",
      },
    },
    missingData,
    method: "Weighted average of available component scores, renormalized over available weights. The overall score is withheld unless the period covers at least 30 days and contains positive recorded income across at least two receipt days.",
  };
};

module.exports = {
  assessFinancialHealth,
};
