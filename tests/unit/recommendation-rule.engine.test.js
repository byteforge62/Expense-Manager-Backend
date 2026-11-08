const {
  buildFinancialMetrics,
} = require("../../src/modules/financial-intelligence/financial-metrics.engine");
const {
  buildBehavioralAnalysis,
} = require("../../src/modules/financial-intelligence/engines/behavioral-analysis.engine");
const {
  assessFinancialHealth,
} = require("../../src/modules/financial-intelligence/engines/financial-health.engine");
const {
  generateRecommendations,
} = require("../../src/modules/financial-intelligence/engines/recommendation.engine");
const {
  evaluateFinancialRules,
} = require("../../src/modules/financial-intelligence/rules/rule-evaluator");

const categoryLookup = new Map([
  ["dining", { name: "Dining" }],
  ["groceries", { name: "Groceries" }],
]);

const previousStart = new Date("2025-12-31T00:00:00.000Z");
const previousEnd = new Date("2026-02-28T23:59:59.999Z");
const currentStart = new Date("2026-03-01T00:00:00.000Z");
const currentEnd = new Date("2026-04-29T23:59:59.999Z");

const incomesFor = (start) => Array.from({ length: 4 }, (_, index) => ({
  amount: 1000,
  date: new Date(start.getTime() + (index * 15 + 1) * 24 * 60 * 60 * 1000),
}));

const expensesFor = (start, diningAmount, groceryAmount) => [
  ...Array.from({ length: 4 }, (_, index) => ({
    amount: diningAmount,
    categoryID: "dining",
    date: new Date(start.getTime() + (index * 15 + 2) * 24 * 60 * 60 * 1000),
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    amount: groceryAmount,
    categoryID: "groceries",
    date: new Date(start.getTime() + (index * 15 + 3) * 24 * 60 * 60 * 1000),
  })),
];

const buildScenario = ({ budget = 3000, recurring = 1000 } = {}) => {
  const previousMetrics = buildFinancialMetrics({
    incomeTransactions: incomesFor(previousStart),
    expenseTransactions: expensesFor(previousStart, 100, 625),
    categoryLookup,
    startDate: previousStart,
    endDate: previousEnd,
  });
  const metrics = buildFinancialMetrics({
    incomeTransactions: incomesFor(currentStart),
    expenseTransactions: expensesFor(currentStart, 200, 675),
    budgets: [{ amount: budget }],
    recurringSchedules: [
      { amount: recurring, type: "EXPENSE", frequency: "monthly", isActive: true },
    ],
    categoryLookup,
    startDate: currentStart,
    endDate: currentEnd,
  });
  metrics.comparison = {
    baselineIncome: previousMetrics.totals.income,
    baselineExpenses: previousMetrics.totals.expenses,
    totalExpensesChange:
      ((metrics.totals.expenses - previousMetrics.totals.expenses) /
        previousMetrics.totals.expenses) *
      100,
  };
  const behavior = buildBehavioralAnalysis({
    currentMetrics: metrics,
    previousMetrics,
    currentExpenses: expensesFor(currentStart, 200, 675),
    previousExpenses: expensesFor(previousStart, 100, 625),
  });

  return {
    metrics,
    previousMetrics,
    behavior,
    financialHealth: assessFinancialHealth({ metrics }),
  };
};

describe("Financial recommendation engine", () => {
  test("recommends evidence-based spending review, budget adjustment, and savings target", () => {
    const scenario = buildScenario();
    const recommendations = generateRecommendations({
      ...scenario,
      anomalies: [],
      dataConfidence: { level: "medium" },
    });

    expect(recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "spending-growth-dining",
        type: "spending-optimization",
        estimatedFinancialImpact: expect.objectContaining({
          amount: 200,
          period: "monthly-equivalent",
          guaranteed: false,
        }),
      }),
      expect.objectContaining({
        id: "budget-underfunded-all-categories",
        type: "budget-optimization",
        estimatedFinancialImpact: null,
      }),
      expect.objectContaining({
        id: "savings-rate-target",
        type: "savings-optimization",
        estimatedFinancialImpact: null,
      }),
    ]));
  });

  test("recommends reviewing a persistently underused budget without inventing savings", () => {
    const scenario = buildScenario({ budget: 10000, recurring: 0 });
    const recommendations = generateRecommendations({
      ...scenario,
      anomalies: [],
      dataConfidence: { level: "medium" },
    });

    expect(recommendations).toContainEqual(
      expect.objectContaining({
        id: "budget-overfunded-all-categories",
        estimatedFinancialImpact: null,
        nextStep: expect.stringContaining("Confirm this budget covers"),
      }),
    );
  });

  test("includes recurring and forecast risks and sorts urgent recommendations first", () => {
    const scenario = buildScenario({ recurring: 1500 });
    const recommendations = generateRecommendations({
      ...scenario,
      anomalies: [
        {
          type: "large-transaction",
          title: "Unusually large transaction",
          severity: "high",
          category: "Dining",
          transactionId: "tx-1",
          amount: 900,
          baseline: 100,
          deviation: 800,
          method: "MAD baseline",
          reason: "Transaction exceeded the established category baseline.",
        },
      ],
      forecast: {
        dataConfidence: { level: "HIGH" },
        scenarios: {
          expected: {
            monthly: [{ month: "2026-06", closingBalance: -50 }],
          },
        },
      },
      dataConfidence: { level: "medium" },
    });

    expect(recommendations[0]).toMatchObject({
      id: "cash-flow-forecast-2026-06",
      priority: "critical",
      severity: "critical",
    });
    expect(recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "recurring-commitment-pressure" }),
      expect.objectContaining({ id: "risk-anomaly-large-transaction-tx-1" }),
    ]));
  });

  test("avoids duplicate category advice and withholds targets when income is insufficient", () => {
    const scenario = buildScenario({ recurring: 0 });
    scenario.previousMetrics.categoryBreakdown = scenario.previousMetrics.categoryBreakdown.map(
      (entry) => ({ ...entry, shareOfSpending: 0.4 }),
    );
    scenario.metrics.categoryBreakdown = scenario.metrics.categoryBreakdown.map(
      (entry) => ({ ...entry, shareOfSpending: 0.4 }),
    );
    const recommendations = generateRecommendations({
      ...scenario,
      anomalies: [],
      dataConfidence: { level: "medium" },
    });

    const diningAdvice = recommendations.filter(
      (item) => item.evidence.category === "Dining",
    );
    expect(diningAdvice).toHaveLength(1);

    const missingIncome = {
      ...scenario.metrics,
      totals: { ...scenario.metrics.totals, savingsRate: null },
      counts: { ...scenario.metrics.counts, incomeReceiptDays: 0 },
    };
    expect(generateRecommendations({
      ...scenario,
      metrics: missingIncome,
      anomalies: [],
      dataConfidence: { level: "low" },
    }).some((item) => item.type === "savings-optimization")).toBe(false);
  });

  test("returns actionable unique records with stable fields", () => {
    const scenario = buildScenario();
    const recommendations = generateRecommendations({
      ...scenario,
      anomalies: [],
      dataConfidence: { level: "medium" },
    });

    expect(new Set(recommendations.map((item) => item.id)).size).toBe(
      recommendations.length,
    );
    for (const recommendation of recommendations) {
      expect(recommendation).toEqual(expect.objectContaining({
        id: expect.any(String),
        type: expect.any(String),
        title: expect.any(String),
        description: expect.any(String),
        priority: expect.any(String),
        evidence: expect.any(Object),
        method: expect.any(String),
        confidenceLevel: expect.any(String),
        nextStep: expect.any(String),
      }));
      expect(recommendation.priorityRank).toBeGreaterThan(0);
    }
  });
});

describe("Adaptive financial rule engine", () => {
  test("triggers budget warning and critical thresholds using shared metrics", () => {
    const scenario = buildScenario();
    const results = evaluateFinancialRules({
      metrics: scenario.metrics,
      anomalies: [],
      anomalySummary: { eligibleTransactionCategories: 1 },
    });
    const budget = results.rules.find((item) => item.ruleId === "budget-utilization");

    expect(budget).toMatchObject({
      status: "triggered",
      severity: "critical",
      threshold: { warning: 0.8, critical: 1 },
    });
    expect(budget.evidence.categories[0].utilization).toBeGreaterThan(1);
  });

  test("reuses anomaly results for the unusual-transaction rule", () => {
    const scenario = buildScenario();
    const result = evaluateFinancialRules({
      metrics: scenario.metrics,
      anomalies: [
        { type: "large-transaction", amount: 900, baseline: 100, severity: "high" },
      ],
    });
    const rule = result.rules.find((item) => item.ruleId === "unusual-transaction");

    expect(rule).toMatchObject({
      status: "triggered",
      severity: "high",
      evidence: [expect.objectContaining({ type: "large-transaction" })],
    });
  });

  test("evaluates savings, expense growth, and recurring thresholds", () => {
    const scenario = buildScenario({ recurring: 1500 });
    const results = evaluateFinancialRules({
      metrics: scenario.metrics,
      anomalies: [],
      anomalySummary: { eligibleTransactionCategories: 1 },
    });
    const byId = Object.fromEntries(results.rules.map((rule) => [rule.ruleId, rule]));

    expect(byId["savings-rate"].status).toBe("triggered");
    expect(byId["expense-growth"].status).toBe("triggered");
    expect(byId["recurring-commitment"].status).toBe("triggered");
  });

  test("evaluates forecast risk when supplied and marks it unevaluated when absent", () => {
    const scenario = buildScenario();
    const absent = evaluateFinancialRules({ metrics: scenario.metrics });
    const forecastRule = absent.rules.find((item) => item.ruleId === "cash-flow-risk");
    expect(forecastRule.status).toBe("not-evaluated");

    const supplied = evaluateFinancialRules({
      metrics: scenario.metrics,
      forecast: {
        dataConfidence: { level: "HIGH" },
        scenarios: {
          expected: {
            monthly: [
              { month: "2026-06", closingBalance: 100 },
              { month: "2026-07", closingBalance: -1 },
            ],
          },
        },
      },
    });
    expect(supplied.rules.find((item) => item.ruleId === "cash-flow-risk"))
      .toMatchObject({
        status: "triggered",
        severity: "critical",
        evidence: {
          periods: [{ month: "2026-07", closingBalance: -1 }],
        },
      });
  });

  test("rejects invalid rule threshold configuration", () => {
    const scenario = buildScenario();
    expect(() => evaluateFinancialRules({
      metrics: scenario.metrics,
      configuration: {
        budgetUtilization: { warning: 1, critical: 0.8 },
      },
    })).toThrow("critical utilization must be greater than warning utilization");
  });

  test("marks rules unevaluated for missing metrics and ranks simultaneous risks", () => {
    const scenario = buildScenario();
    const missing = evaluateFinancialRules({
      metrics: {
        totals: { savingsRate: null, netCashFlow: 0, income: 0, expenses: 0 },
        comparison: { totalExpensesChange: null },
        obligations: {
          budgetUtilization: null,
          budgetBreakdown: [],
          recurringCommitmentRatio: null,
        },
      },
    });
    expect(missing.rules.filter((rule) => rule.status === "not-evaluated").length)
      .toBeGreaterThanOrEqual(4);

    const simultaneous = evaluateFinancialRules({
      metrics: scenario.metrics,
      forecast: {
        scenarios: { expected: { monthly: [{ month: "2026-06", closingBalance: -10 }] } },
      },
      anomalies: [
        { type: "large-transaction", amount: 1000, baseline: 100, severity: "high" },
      ],
      anomalySummary: { eligibleTransactionCategories: 1 },
    });
    expect(simultaneous.rules[0].priority).toBeGreaterThanOrEqual(
      simultaneous.rules[1].priority,
    );
    expect(simultaneous.summary.triggered).toBeGreaterThanOrEqual(5);
  });
});
