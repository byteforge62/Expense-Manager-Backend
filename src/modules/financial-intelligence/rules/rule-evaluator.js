const { RULE_DEFINITIONS } = require("./rule-definitions");
const { validateRuleConfiguration } = require("./rule-validation");
const { roundMoney } = require("../utils/statistics");

const PRIORITY = {
  critical: 100,
  high: 80,
  medium: 50,
  low: 20,
  none: 0,
};

const result = ({
  ruleId,
  type,
  status,
  severity = "low",
  threshold = null,
  explanation,
  evidence = null,
}) => ({
  ruleId,
  type,
  condition: RULE_DEFINITIONS.find((rule) => rule.id === ruleId).description,
  threshold,
  severity,
  priority: status === "triggered" ? PRIORITY[severity] : PRIORITY.none,
  status,
  triggered: status === "triggered",
  explanation,
  evidence,
});

const evaluateBudgetRule = (metrics, thresholds) => {
  const utilization = metrics.obligations?.budgetUtilization;
  const breakdown = metrics.obligations?.budgetBreakdown || [];

  if (utilization === null || utilization === undefined) {
    return result({
      ruleId: "budget-utilization",
      type: "budget-utilization",
      status: "not-evaluated",
      threshold: thresholds,
      explanation: "No applicable positive budget is available.",
    });
  }

  const critical = breakdown.filter(
    (item) => item.utilization >= thresholds.critical,
  );
  const warning = breakdown.filter(
    (item) => item.utilization >= thresholds.warning,
  );
  const maximum = breakdown.reduce(
    (max, item) => Math.max(max, item.utilization),
    utilization,
  );
  const severe = critical.length > 0 || utilization >= thresholds.critical;
  const triggered = severe || warning.length > 0 || utilization >= thresholds.warning;

  return result({
    ruleId: "budget-utilization",
    type: "budget-utilization",
    status: triggered ? "triggered" : "clear",
    severity: severe ? "critical" : "medium",
    threshold: thresholds,
    explanation: triggered
      ? `Budget utilization reached ${roundMoney(maximum * 100)}%, crossing the ${roundMoney((severe ? thresholds.critical : thresholds.warning) * 100)}% ${severe ? "critical" : "warning"} threshold.`
      : `Budget utilization is below the ${roundMoney(thresholds.warning * 100)}% warning threshold.`,
    evidence: {
      overallUtilization: utilization,
      categories: breakdown,
      warningThreshold: thresholds.warning,
      criticalThreshold: thresholds.critical,
    },
  });
};

const evaluateTransactionRule = (anomalies, anomalySummary) => {
  const eligible = anomalies.filter(
    (anomaly) => anomaly.type === "large-transaction",
  );
  const baselineAvailable =
    anomalySummary?.eligibleTransactionCategories > 0 ||
    eligible.length > 0;

  return result({
    ruleId: "unusual-transaction",
    type: "unusual-transaction",
    status: eligible.length > 0
      ? "triggered"
      : baselineAvailable
        ? "clear"
        : "not-evaluated",
    severity: eligible.some((anomaly) => anomaly.severity === "high")
      ? "high"
      : "medium",
    threshold: {
      method: "Existing category-specific median/MAD anomaly baseline",
      minimumHistoricalTransactions: 5,
    },
    explanation: eligible.length > 0
      ? `${eligible.length} transaction(s) crossed the existing anomaly engine's category-specific statistical threshold.`
      : baselineAvailable
        ? "No current transaction crossed an eligible category-specific anomaly threshold."
        : "No category has enough historical transactions to evaluate the anomaly rule.",
    evidence: eligible,
  });
};

const evaluateFinancialRules = ({
  metrics,
  anomalies = [],
  anomalySummary = {},
  forecast = null,
  configuration = {},
}) => {
  const overrides = validateRuleConfiguration(configuration);
  const thresholds = {
    budgetUtilization: {
      warning: 0.8,
      critical: 1,
      ...overrides.budgetUtilization,
    },
    savingsRate: { target: 0.2, ...overrides.savingsRate },
    expenseGrowth: { growthPercent: 20, ...overrides.expenseGrowth },
    recurringCommitment: { maximumRatio: 0.4, ...overrides.recurringCommitment },
  };
  const rules = [];

  rules.push(evaluateBudgetRule(metrics, thresholds.budgetUtilization));
  rules.push(evaluateTransactionRule(anomalies, anomalySummary));

  const savingsRate = metrics.totals?.savingsRate;
  rules.push(
    savingsRate === null || savingsRate === undefined
      ? result({
          ruleId: "savings-rate",
          type: "savings-rate",
          status: "not-evaluated",
          threshold: thresholds.savingsRate,
          explanation: "Savings rate is unavailable because positive income is not recorded.",
        })
      : result({
          ruleId: "savings-rate",
          type: "savings-rate",
          status: savingsRate < thresholds.savingsRate.target ? "triggered" : "clear",
          severity: savingsRate < 0 ? "high" : "medium",
          threshold: thresholds.savingsRate,
          explanation: `Observed savings rate is ${roundMoney(savingsRate * 100)}%; target is ${roundMoney(thresholds.savingsRate.target * 100)}%.`,
          evidence: {
            savingsRate,
            netCashFlow: metrics.totals.netCashFlow,
            income: metrics.totals.income,
          },
        }),
  );

  const expenseGrowth = metrics.comparison?.totalExpensesChange;
  rules.push(
    expenseGrowth === null || expenseGrowth === undefined
      ? result({
          ruleId: "expense-growth",
          type: "expense-growth",
          status: "not-evaluated",
          threshold: thresholds.expenseGrowth,
          explanation: "Comparable expense growth is unavailable because the prior-period baseline is zero.",
        })
      : result({
          ruleId: "expense-growth",
          type: "expense-growth",
          status: expenseGrowth > thresholds.expenseGrowth.growthPercent
            ? "triggered"
            : "clear",
          severity: expenseGrowth > thresholds.expenseGrowth.growthPercent * 2
            ? "high"
            : "medium",
          threshold: thresholds.expenseGrowth,
          explanation: `Expense change is ${roundMoney(expenseGrowth)}% against a ${roundMoney(thresholds.expenseGrowth.growthPercent)}% growth threshold.`,
          evidence: {
            currentExpenses: metrics.totals.expenses,
            baselineExpenses: metrics.comparison.baselineExpenses,
            changePercent: expenseGrowth,
          },
        }),
  );

  if (forecast === null) {
    rules.push(result({
      ruleId: "cash-flow-risk",
      type: "cash-flow-risk",
      status: "not-evaluated",
      severity: "critical",
      explanation: "No forecast result was supplied. Forecasts require explicit opening cash, which this overview does not infer.",
    }));
  } else {
    const monthly = forecast.scenarios?.expected?.monthly;
    if (!Array.isArray(monthly)) {
      throw new TypeError(
        "forecast must contain scenarios.expected.monthly closing balances",
      );
    }
    const negativeMonths = monthly.filter(
      (month) => Number.isFinite(Number(month.closingBalance)) &&
        Number(month.closingBalance) < 0,
    );
    const invalidBalances = monthly.some(
      (month) => !Number.isFinite(Number(month.closingBalance)),
    );
    if (invalidBalances) {
      throw new TypeError("forecast monthly closing balances must be finite numbers");
    }

    rules.push(result({
      ruleId: "cash-flow-risk",
      type: "cash-flow-risk",
      status: negativeMonths.length > 0 ? "triggered" : "clear",
      severity: "critical",
      explanation: negativeMonths.length > 0
        ? `The expected forecast shows a negative closing balance in ${negativeMonths.length} period(s).`
        : "No expected forecast period has a negative closing balance.",
      evidence: {
        periods: negativeMonths.map((month) => ({
          month: month.month,
          closingBalance: Number(month.closingBalance),
        })),
        forecastConfidence: forecast.dataConfidence?.level || null,
      },
    }));
  }

  const recurringRatio = metrics.obligations?.recurringCommitmentRatio;
  rules.push(
    recurringRatio === null || recurringRatio === undefined
      ? result({
          ruleId: "recurring-commitment",
          type: "recurring-commitment",
          status: "not-evaluated",
          threshold: thresholds.recurringCommitment,
          explanation: "Recurring commitment share is unavailable without positive income.",
        })
      : result({
          ruleId: "recurring-commitment",
          type: "recurring-commitment",
          status: recurringRatio > thresholds.recurringCommitment.maximumRatio
            ? "triggered"
            : "clear",
          severity: recurringRatio > 0.6 ? "high" : "medium",
          threshold: thresholds.recurringCommitment,
          explanation: `Classified recurring expenses are ${roundMoney(recurringRatio * 100)}% of monthly-equivalent income; configured maximum is ${roundMoney(thresholds.recurringCommitment.maximumRatio * 100)}%.`,
          evidence: {
            recurringMonthlyExpenses: metrics.obligations.recurringMonthlyExpenses,
            monthlyEquivalentIncome: metrics.obligations.monthlyEquivalentIncome,
            ratio: recurringRatio,
          },
        }),
  );

  const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
  rules.sort(
    (first, second) =>
      second.priority - first.priority ||
      severityOrder[second.severity] - severityOrder[first.severity],
  );

  return {
    rules,
    summary: {
      total: rules.length,
      evaluated: rules.filter((rule) => rule.status !== "not-evaluated").length,
      triggered: rules.filter((rule) => rule.triggered).length,
      notEvaluated: rules.filter((rule) => rule.status === "not-evaluated").length,
      bySeverity: {
        critical: rules.filter((rule) => rule.triggered && rule.severity === "critical").length,
        high: rules.filter((rule) => rule.triggered && rule.severity === "high").length,
        medium: rules.filter((rule) => rule.triggered && rule.severity === "medium").length,
        low: rules.filter((rule) => rule.triggered && rule.severity === "low").length,
      },
    },
  };
};

module.exports = {
  evaluateFinancialRules,
};
