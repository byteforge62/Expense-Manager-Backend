const {
  buildComparisonMetrics,
  buildFinancialMetrics,
} = require("../financial-metrics.engine");
const { buildBehavioralAnalysis } = require("../engines/behavioral-analysis.engine");
const { detectAnomalies } = require("../engines/anomaly-detection.engine");
const { assessFinancialHealth } = require("../engines/financial-health.engine");
const { generateRecommendations } = require("../engines/recommendation.engine");
const { evaluateFinancialRules } = require("../rules/rule-evaluator");
const { getFinancialRecords } = require("../repositories/financial-intelligence.repository");
const { normalizeFinancialRecords } = require("./financial-data.service");

const generateFinancialIntelligence = async ({
  userId,
  startDate,
  endDate,
  now = new Date(),
  forecast = null,
  ruleConfiguration = {},
}) => {
  const records = await getFinancialRecords({
    userId,
    startDate,
    endDate,
    now,
  });
  const data = normalizeFinancialRecords(records);

  const currentMetrics = buildFinancialMetrics({
    incomeTransactions: data.incomes,
    expenseTransactions: data.expenses,
    budgets: data.budgets,
    bills: data.bills,
    recurringSchedules: data.recurringSchedules,
    categoryLookup: data.categoryLookup,
    startDate: data.currentWindow.start,
    endDate: data.currentWindow.end,
  });
  const previousMetrics = buildFinancialMetrics({
    incomeTransactions: data.historicalIncomes,
    expenseTransactions: data.historicalExpenses,
    categoryLookup: data.categoryLookup,
    startDate: data.comparisonWindow.start,
    endDate: data.comparisonWindow.end,
  });
  const behavior = buildBehavioralAnalysis({
    currentMetrics,
    previousMetrics,
    currentExpenses: data.expenses,
    previousExpenses: data.historicalExpenses,
  });
  const anomalyResult = detectAnomalies({
    expenses: data.expenses,
    previousExpenses: data.historicalExpenses,
    categoryLookup: data.categoryLookup,
    currentMetrics,
    previousMetrics,
  });
  const financialHealth = assessFinancialHealth({
    metrics: currentMetrics,
  });

  const missingCategoryCount = data.expenses.filter(
    (expense) => !expense.categoryID ||
      !data.categoryLookup.has(String(expense.categoryID)),
  ).length;
  const confidenceLevel =
    data.expenses.length >= 20 &&
    data.incomes.length >= 3 &&
    data.historicalExpenses.length >= 10 &&
    data.historicalIncomes.length >= 2
      ? "high"
      : data.expenses.length >= 5 &&
        data.incomes.length >= 2 &&
        data.historicalExpenses.length >= 5
        ? "medium"
        : "low";

  const metrics = {
    ...currentMetrics,
    comparison: {
      period: {
        startDate: previousMetrics.period.startDate,
        endDate: previousMetrics.period.endDate,
        days: previousMetrics.period.days,
      },
      baselineIncome: previousMetrics.totals.income,
      baselineExpenses: previousMetrics.totals.expenses,
      ...buildComparisonMetrics(currentMetrics, previousMetrics),
    },
  };
  const dataConfidence = {
    level: confidenceLevel,
    method: "High requires at least 20 current expenses, 3 current incomes, 10 comparison expenses, and 2 comparison incomes. Medium requires at least 5 current expenses, 2 current incomes, and 5 comparison expenses; otherwise confidence is low.",
    samples: {
      expenseTransactions: data.expenses.length,
      incomeTransactions: data.incomes.length,
      historicalExpenseTransactions: data.historicalExpenses.length,
      historicalIncomeTransactions: data.historicalIncomes.length,
      periodDays: currentMetrics.period.days,
    },
    limitations: [
      ...(confidenceLevel === "low"
        ? ["Limited transaction history reduces behavioral and statistical confidence."]
        : []),
      ...(data.historicalExpenses.length < 5
        ? ["Fewer than five comparison-period expenses are available; transaction anomaly baselines may be suppressed."]
        : []),
      ...(missingCategoryCount > 0
        ? [`${missingCategoryCount} current-period expense(s) have no matching expense category and are grouped as Uncategorized.`]
        : []),
      ...(data.recurringSchedules.some((schedule) => schedule.type === "UNCLASSIFIED")
        ? ["Unclassified recurring schedules are excluded from classified income/expense commitments."]
        : []),
    ],
  };

  const ruleResult = evaluateFinancialRules({
    metrics,
    anomalies: anomalyResult.anomalies,
    anomalySummary: anomalyResult.summary,
    forecast,
    configuration: ruleConfiguration,
  });
  const recommendations = generateRecommendations({
    metrics,
    previousMetrics,
    behavior,
    anomalies: anomalyResult.anomalies,
    financialHealth,
    forecast,
    dataConfidence,
  });

  return {
    generatedAt: now.toISOString(),
    dataConfidence,
    metrics,
    behavior,
    anomalies: anomalyResult.anomalies,
    anomalySummary: anomalyResult.summary,
    financialHealth,
    recommendations,
    rules: ruleResult.rules,
    ruleSummary: ruleResult.summary,
  };
};

module.exports = {
  generateFinancialIntelligence,
};
