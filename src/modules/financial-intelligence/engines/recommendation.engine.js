const { roundMoney } = require("../utils/statistics");

const PRIORITY_RANK = {
  critical: 100,
  high: 80,
  medium: 50,
  low: 20,
};

const slug = (value) =>
  String(value || "general")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "general";

const createRecommendation = ({
  id,
  type,
  title,
  description,
  priority,
  severity,
  evidence,
  method,
  estimatedFinancialImpact = null,
  confidenceLevel,
  nextStep,
}) => ({
  id,
  type,
  title,
  description,
  priority,
  priorityRank: PRIORITY_RANK[priority],
  ...(severity ? { severity } : {}),
  evidence,
  method,
  estimatedFinancialImpact,
  confidenceLevel,
  nextStep,
});

const getCategoryEvidence = (metrics, previousMetrics, category) => {
  const current = metrics.categoryBreakdown.find(
    (item) => item.category === category,
  );
  const previous = previousMetrics.categoryBreakdown.find(
    (item) => item.category === category,
  );
  return { current, previous };
};

const getMonthlyIncome = (metrics) =>
  metrics.obligations.monthlyEquivalentIncome;

const generateRecommendations = ({
  metrics,
  previousMetrics,
  behavior,
  anomalies,
  financialHealth,
  forecast = null,
  dataConfidence = { level: "low" },
}) => {
  const recommendations = [];
  const uniqueIds = new Set();
  const categoriesWithSpendingRecommendations = new Set();
  const add = (recommendation) => {
    if (uniqueIds.has(recommendation.id)) {
      return;
    }
    uniqueIds.add(recommendation.id);
    recommendations.push(recommendation);
    if (recommendation.evidence?.category) {
      categoriesWithSpendingRecommendations.add(recommendation.evidence.category);
    }
  };
  const currentCategories = metrics.categoryBreakdown || [];
  const previousCategories = previousMetrics.categoryBreakdown || [];
  const periodDays = metrics.period.days;
  const confidenceLevel = dataConfidence.level || "low";

  const expectedMonths = forecast?.scenarios?.expected?.monthly;
  if (Array.isArray(expectedMonths)) {
    for (const month of expectedMonths.filter(
      (item) => Number(item.closingBalance) < 0,
    )) {
      add(createRecommendation({
        id: `cash-flow-forecast-${slug(month.month)}`,
        type: "cash-flow-optimization",
        title: "Review projected cash-flow pressure",
        description: `The expected forecast shows a closing balance of ${roundMoney(Number(month.closingBalance))} in ${month.month}.`,
        priority: "critical",
        severity: "critical",
        evidence: {
          month: month.month,
          projectedClosingBalance: roundMoney(Number(month.closingBalance)),
          forecastConfidence: forecast.dataConfidence?.level || null,
        },
        method: "Uses the supplied Financial Forecasting expected scenario; this engine does not recalculate projections.",
        confidenceLevel: forecast.dataConfidence?.level?.toLowerCase() || confidenceLevel,
        nextStep: "Review the forecast's projected income, scheduled commitments, and pending bills before the indicated period.",
      }));
    }
  }

  const sortedAnomalies = [...anomalies].sort(
    (first, second) =>
      (second.severity === "high" ? 1 : 0) -
        (first.severity === "high" ? 1 : 0) ||
      Number(second.deviation || 0) - Number(first.deviation || 0),
  );
  for (const anomaly of sortedAnomalies.slice(0, 3)) {
    const key = anomaly.transactionId || anomaly.category || anomaly.date || anomaly.type;
    add(createRecommendation({
      id: `risk-anomaly-${slug(`${anomaly.type}-${key}`)}`,
      type: "risk-mitigation",
      title: anomaly.title || "Review unusual financial activity",
      description: anomaly.reason,
      priority: anomaly.severity === "high" ? "high" : "medium",
      severity: anomaly.severity,
      evidence: {
        type: anomaly.type,
        transactionId: anomaly.transactionId || null,
        category: anomaly.category || null,
        date: anomaly.date || null,
        observed: anomaly.amount,
        baseline: anomaly.baseline,
        deviation: anomaly.deviation,
        method: anomaly.method,
      },
      method: "Reuses the statistical anomaly engine result; an anomaly is not proof of fraud.",
      confidenceLevel,
      nextStep: "Check the transaction or category against receipts and expected activity; correct its category if needed.",
    }));
  }

  const growthRule = behavior.observations.filter(
    (observation) =>
      observation.type === "category-change" &&
      observation.observed > observation.baseline &&
      observation.changePercent !== null &&
      observation.changePercent >= 20,
  ).sort((first, second) => second.delta - first.delta);
  for (const observation of growthRule) {
    const { current, previous } = getCategoryEvidence(
      metrics,
      previousMetrics,
      observation.category,
    );
    if (!current || !previous || current.transactionCount < 3 || previous.transactionCount < 3) {
      continue;
    }

    const monthlyizedDelta = roundMoney(
      (observation.delta / periodDays) * 30,
    );
    add(createRecommendation({
      id: `spending-growth-${slug(observation.category)}`,
      type: "spending-optimization",
      title: `Review increased ${observation.category} spending`,
      description: `${observation.category} spending increased by ${roundMoney(observation.changePercent)}% over the comparable period. Returning to the prior-period amount would reduce spending by ${roundMoney(observation.delta)} for a period of the same length.`,
      priority: observation.changePercent >= 50 ? "high" : "medium",
      severity: observation.changePercent >= 50 ? "high" : "medium",
      evidence: {
        category: observation.category,
        currentAmount: observation.observed,
        baselineAmount: observation.baseline,
        increaseAmount: observation.delta,
        increasePercent: observation.changePercent,
        currentTransactionCount: current.transactionCount,
        baselineTransactionCount: previous.transactionCount,
        currentPeriod: observation.comparison.currentPeriod,
        baselinePeriod: observation.comparison.baselinePeriod,
      },
      method: "Equal-length period comparison; estimated reduction assumes spending returns to the measured prior-period amount and is not guaranteed.",
      estimatedFinancialImpact: {
        amount: monthlyizedDelta,
        period: "monthly-equivalent",
        currency: null,
        basis: "Observed spend above the equal-length prior-period baseline, normalized to 30 days.",
        guaranteed: false,
      },
      confidenceLevel: current.transactionCount >= 5 &&
        previous.transactionCount >= 5
        ? confidenceLevel
        : "low",
      nextStep: "Review recent transactions in this category and decide whether the increase is recurring or a one-time event.",
    }));
  }

  for (const category of currentCategories) {
    if (categoriesWithSpendingRecommendations.has(category.category)) {
      continue;
    }
    const previous = previousCategories.find(
      (item) => item.category === category.category,
    );
    if (
      !previous ||
      category.shareOfSpending < 0.3 ||
      previous.shareOfSpending < 0.3 ||
      category.transactionCount < 3 ||
      previous.transactionCount < 3
    ) {
      continue;
    }

    add(createRecommendation({
      id: `spending-persistent-${slug(category.category)}`,
      type: "spending-optimization",
      title: `Review consistently high ${category.category} spending`,
      description: `${category.category} was at least 30% of total expenses in both comparable periods (${roundMoney(previous.shareOfSpending * 100)}% before and ${roundMoney(category.shareOfSpending * 100)}% now).`,
      priority: "medium",
      severity: "medium",
      evidence: {
        category: category.category,
        currentAmount: category.amount,
        baselineAmount: previous.amount,
        currentShare: category.shareOfSpending,
        baselineShare: previous.shareOfSpending,
        currentTransactionCount: category.transactionCount,
        baselineTransactionCount: previous.transactionCount,
      },
      method: "Persistent concentration rule: at least 30% of expenses in each of two equal-length periods and at least three transactions in each period.",
      confidenceLevel: category.transactionCount >= 5 &&
        previous.transactionCount >= 5
        ? confidenceLevel
        : "low",
      nextStep: "Inspect the category's largest repeat purchases and identify any that are optional; no essentiality is inferred.",
    }));
  }

  for (const budget of metrics.obligations.budgetBreakdown || []) {
    const historicalSpend = budget.category === "All categories"
      ? previousMetrics.totals.expenses
      : previousMetrics.spending.categoryTotals[budget.category] || 0;
    const historicalCategory = previousCategories.find(
      (item) => item.category === budget.category,
    );
    const transactionCount = budget.transactionCount ||
      metrics.counts.expenseTransactions;
    const historicalCount = historicalCategory?.transactionCount ||
      previousMetrics.counts.expenseTransactions;
    const persistentlyOverBudget =
      budget.utilization >= 0.8 &&
      historicalSpend >= budget.budget * 0.8 &&
      transactionCount >= 3 &&
      historicalCount >= 3;
    const persistentlyUnderused =
      budget.utilization < 0.5 &&
      historicalSpend < budget.budget * 0.5 &&
      transactionCount >= 3 &&
      historicalCount >= 3;

    if (persistentlyOverBudget) {
      add(createRecommendation({
        id: `budget-underfunded-${slug(budget.category)}`,
        type: "budget-optimization",
        title: `Review the ${budget.category} budget`,
        description: `Spending was ${roundMoney(budget.utilization * 100)}% of this budget in the current period and ${roundMoney((historicalSpend / budget.budget) * 100)}% in the comparable period.`,
        priority: budget.utilization >= 1 ? "high" : "medium",
        severity: budget.utilization >= 1 ? "high" : "medium",
        evidence: {
          category: budget.category,
          budgetAmount: budget.budget,
          currentSpending: budget.spending,
          baselineSpending: roundMoney(historicalSpend),
          currentUtilization: budget.utilization,
          baselineUtilization: roundMoney(historicalSpend / budget.budget),
        },
        method: "Requires at least three current and baseline expenses and utilization of at least 80% in both equal-length periods. Budget periods are treated as the configured amount's scope.",
        confidenceLevel,
        nextStep: "Confirm the budget covers the same time period; if this spending is expected to continue, adjust the limit to a level you can fund.",
      }));
    } else if (persistentlyUnderused) {
      add(createRecommendation({
        id: `budget-overfunded-${slug(budget.category)}`,
        type: "budget-optimization",
        title: `Review the ${budget.category} budget allocation`,
        description: `Spending stayed below 50% of the configured amount in both comparable periods.`,
        priority: "low",
        evidence: {
          category: budget.category,
          budgetAmount: budget.budget,
          currentSpending: budget.spending,
          baselineSpending: roundMoney(historicalSpend),
          currentUtilization: budget.utilization,
          baselineUtilization: roundMoney(historicalSpend / budget.budget),
        },
        method: "Requires at least three current and baseline expenses and utilization below 50% in both equal-length periods.",
        confidenceLevel,
        nextStep: "Confirm this budget covers the same time period and whether its unused allocation should be reassigned.",
      }));
    }
  }

  const savingsRate = metrics.totals.savingsRate;
  const monthlyIncome = getMonthlyIncome(metrics);
  if (
    savingsRate !== null &&
    metrics.counts.incomeReceiptDays >= 2 &&
    savingsRate < 0.2
  ) {
    const targetMonthlySavings = roundMoney(monthlyIncome * 0.2);
    const currentMonthlySavings = roundMoney(
      metrics.totals.netCashFlow / periodDays * 30,
    );
    add(createRecommendation({
      id: "savings-rate-target",
      type: "savings-optimization",
      title: "Review a history-based savings target",
      description: `Recorded savings rate is ${roundMoney(savingsRate * 100)}%. A 20% planning target would be ${targetMonthlySavings} per month using the selected period's monthly-equivalent income.`,
      priority: savingsRate < 0 ? "high" : "medium",
      severity: savingsRate < 0 ? "high" : "medium",
      evidence: {
        savingsRate,
        targetSavingsRate: 0.2,
        monthlyEquivalentIncome: monthlyIncome,
        targetMonthlySavings,
        currentMonthlySavings,
      },
      method: "The 20% target is a configurable planning default also used as the health-score anchor; the target amount uses observed period income and is not a forecast.",
      confidenceLevel: confidenceLevel === "low" ? "low" : confidenceLevel,
      nextStep: "Review recurring and variable expenses against recorded income, then choose a target appropriate to your obligations.",
    }));
  }

  const recurringRatio = metrics.obligations.recurringCommitmentRatio;
  if (recurringRatio !== null && recurringRatio > 0.4) {
    add(createRecommendation({
      id: "recurring-commitment-pressure",
      type: "recurring-commitment",
      title: "Review recurring commitment pressure",
      description: `Classified recurring expenses represent ${roundMoney(recurringRatio * 100)}% of monthly-equivalent recorded income.`,
      priority: recurringRatio > 0.6 ? "high" : "medium",
      severity: recurringRatio > 0.6 ? "high" : "medium",
      evidence: {
        recurringMonthlyExpenses: metrics.obligations.recurringMonthlyExpenses,
        monthlyEquivalentIncome: monthlyIncome,
        ratio: recurringRatio,
      },
      method: "Active classified recurring schedules are converted to monthly equivalents and compared with selected-period monthly-equivalent recorded income.",
      confidenceLevel,
      nextStep: "Review the listed recurring schedules and verify their amounts, frequency, and continued need; essentiality is not inferred.",
    }));
  }

  const pressure = financialHealth.observedRisk.spendingPressure;
  if (pressure.level === "high") {
    add(createRecommendation({
      id: "risk-spending-pressure",
      type: "risk-mitigation",
      title: "Address the observed cash-flow deficit",
      description: `Recorded expenses exceeded recorded income by ${roundMoney(Math.abs(metrics.totals.netCashFlow))} in the selected period.`,
      priority: "high",
      severity: "high",
      evidence: {
        income: metrics.totals.income,
        expenses: metrics.totals.expenses,
        netCashFlow: metrics.totals.netCashFlow,
        expenseToIncomeRatio: metrics.totals.expenseToIncomeRatio,
      },
      method: "Observed selected-period income and expense totals; this does not project future solvency.",
      confidenceLevel,
      nextStep: "Review upcoming obligations and recent expenses; use the separate Financial Forecasting feature for forward projections.",
    }));
  }

  const pendingBillRisk = financialHealth.observedRisk.pendingBills;
  if (pendingBillRisk.count > 0) {
    const monthlyIncome = getMonthlyIncome(metrics);
    const isMaterial = monthlyIncome > 0 &&
      pendingBillRisk.amount / monthlyIncome >= 0.4;
    add(createRecommendation({
      id: "risk-pending-bills",
      type: "risk-mitigation",
      title: "Review pending bill obligations",
      description: `${pendingBillRisk.count} pending, unsettled bill(s) totaling ${roundMoney(pendingBillRisk.amount)} are due by the end of the selected period.`,
      priority: isMaterial ? "high" : "medium",
      severity: isMaterial ? "high" : "medium",
      evidence: {
        amount: pendingBillRisk.amount,
        count: pendingBillRisk.count,
        monthlyEquivalentIncome: monthlyIncome,
        explanation: pendingBillRisk.explanation,
      },
      method: "Uses pending, unsettled bill totals from the shared financial metrics; it does not infer ability to pay.",
      confidenceLevel,
      nextStep: "Confirm each bill's status and due date, then account for it in your cash plan.",
    }));
  }

  if (financialHealth.score !== null && financialHealth.score < 40) {
    add(createRecommendation({
      id: "risk-financial-health",
      type: "risk-mitigation",
      title: "Review the financial-health indicators",
      description: `The observed financial-health score is ${financialHealth.score}/100 (${financialHealth.label}); this is an indicator, not a financial rating.`,
      priority: "medium",
      severity: "medium",
      evidence: {
        score: financialHealth.score,
        label: financialHealth.label,
        components: financialHealth.components,
        missingData: financialHealth.missingData,
      },
      method: "Uses the existing explainable health assessment and its available weighted components.",
      confidenceLevel,
      nextStep: "Review the component explanations to identify which measured indicators are driving the assessment.",
    }));
  }

  recommendations.sort(
    (first, second) =>
      second.priorityRank - first.priorityRank ||
      first.id.localeCompare(second.id),
  );
  return recommendations.slice(0, 12);
};

module.exports = {
  generateRecommendations,
};
