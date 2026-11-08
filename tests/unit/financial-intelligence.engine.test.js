const {
  buildFinancialMetrics,
} = require("../../src/modules/financial-intelligence/financial-metrics.engine");
const {
  buildBehavioralAnalysis,
} = require("../../src/modules/financial-intelligence/engines/behavioral-analysis.engine");
const {
  detectAnomalies,
} = require("../../src/modules/financial-intelligence/engines/anomaly-detection.engine");
const {
  assessFinancialHealth,
} = require("../../src/modules/financial-intelligence/engines/financial-health.engine");
const {
  median,
  medianAbsoluteDeviation,
} = require("../../src/modules/financial-intelligence/utils/statistics");
const {
  overviewQuerySchema,
} = require("../../src/modules/financial-intelligence/validations/financial-intelligence.validation");

const startDate = new Date("2026-01-01T00:00:00.000Z");
const endDate = new Date("2026-01-10T23:59:59.999Z");
const categoryLookup = new Map([
  ["dining-id", { name: "Dining" }],
]);

const makeMetrics = (overrides = {}) => buildFinancialMetrics({
  incomeTransactions: [],
  expenseTransactions: [],
  budgets: [],
  bills: [],
  recurringSchedules: [],
  categoryLookup,
  startDate,
  endDate,
  ...overrides,
});

describe("Financial intelligence metrics engine", () => {
  test("validates the date order and bounds daily-series windows", () => {
    expect(overviewQuerySchema.safeParse({
      startDate: "2025-01-01T00:00:00.000Z",
      endDate: "2026-01-02T00:00:00.000Z",
    }).success).toBe(false);
    expect(overviewQuerySchema.safeParse({
      startDate: "2026-01-02T00:00:00.000Z",
      endDate: "2026-01-01T00:00:00.000Z",
    }).success).toBe(false);
  });

  test("includes zero-spend days in daily averages and medians", () => {
    const metrics = makeMetrics({
      incomeTransactions: [
        { amount: 1000, date: new Date("2026-01-01T12:00:00.000Z") },
      ],
      expenseTransactions: [
        { amount: 100, categoryID: "dining-id", date: new Date("2026-01-01T12:00:00.000Z") },
        { amount: 50, categoryID: "dining-id", date: new Date("2026-01-03T12:00:00.000Z") },
      ],
      budgets: [{ amount: 200, categoryID: "dining-id" }],
      bills: [
        { amount: 80, status: "pending" },
        { amount: 70, status: "paid" },
      ],
      recurringSchedules: [
        { amount: 100, type: "EXPENSE", frequency: "monthly", isActive: true },
        { amount: 1200, type: "EXPENSE", frequency: "yearly", isActive: true },
        { amount: 500, type: "UNCLASSIFIED", frequency: "monthly", isActive: true },
      ],
    });

    expect(metrics.period.days).toBe(10);
    expect(metrics.totals).toMatchObject({
      income: 1000,
      expenses: 150,
      netCashFlow: 850,
      savingsRate: 0.85,
      expenseToIncomeRatio: 0.15,
    });
    expect(metrics.spending.dailyTotals).toHaveLength(10);
    expect(metrics.spending.averageDailySpending).toBe(15);
    expect(metrics.spending.medianDailySpending).toBe(0);
    expect(metrics.spending.categoryTotals.Dining).toBe(150);
    expect(metrics.obligations).toMatchObject({
      totalBudget: 200,
      budgetMatchedSpending: 150,
      budgetUtilization: 0.75,
      pendingBills: 80,
      recurringMonthlyExpenses: 200,
      unclassifiedRecurringSchedules: 1,
    });
  });

  test("uses UTC inclusive calendar boundaries and safely handles zero income", () => {
    const metrics = buildFinancialMetrics({
      incomeTransactions: [],
      expenseTransactions: [
        { amount: 30, date: new Date("2026-01-10T23:59:59.999Z") },
      ],
      startDate: new Date("2026-01-10T18:00:00.000Z"),
      endDate: new Date("2026-01-10T20:00:00.000Z"),
    });

    expect(metrics.period.days).toBe(1);
    expect(metrics.totals.income).toBe(0);
    expect(metrics.totals.savingsRate).toBeNull();
    expect(metrics.totals.expenseToIncomeRatio).toBeNull();
    expect(metrics.spending.averageDailySpending).toBe(30);
  });

  test("excludes partial calendar months from monthly cash-flow stability", () => {
    const metrics = buildFinancialMetrics({
      incomeTransactions: [
        { amount: 100, date: new Date("2026-01-15T12:00:00.000Z") },
        { amount: 100, date: new Date("2026-02-15T12:00:00.000Z") },
        { amount: 100, date: new Date("2026-03-15T12:00:00.000Z") },
      ],
      expenseTransactions: [
        { amount: 50, date: new Date("2026-01-15T12:00:00.000Z") },
        { amount: 150, date: new Date("2026-02-15T12:00:00.000Z") },
        { amount: 50, date: new Date("2026-03-15T12:00:00.000Z") },
      ],
      startDate: new Date("2026-01-15T00:00:00.000Z"),
      endDate: new Date("2026-03-15T23:59:59.999Z"),
    });

    expect(metrics.cashFlow.monthly.map((month) => month.complete)).toEqual([
      false,
      true,
      false,
    ]);
    expect(metrics.cashFlow.observedMonths).toBe(1);
    expect(metrics.cashFlow.positiveMonths).toBe(0);
  });

  test("calculates MAD around the median", () => {
    expect(median([10, 10, 10, 1000])).toBe(10);
    expect(medianAbsoluteDeviation([10, 10, 10, 1000])).toBe(0);
  });
});

describe("Behavioral analysis engine", () => {
  test("reports measured category changes against an equal-length baseline", () => {
    const currentMetrics = makeMetrics({
      expenseTransactions: [
        { amount: 150, categoryID: "dining-id", date: new Date("2026-01-02T12:00:00.000Z") },
      ],
    });
    const previousMetrics = buildFinancialMetrics({
      expenseTransactions: [
        { amount: 100, categoryID: "dining-id", date: new Date("2025-12-23T12:00:00.000Z") },
      ],
      categoryLookup,
      startDate: new Date("2025-12-22T00:00:00.000Z"),
      endDate: new Date("2025-12-31T23:59:59.999Z"),
    });
    const result = buildBehavioralAnalysis({
      currentMetrics,
      previousMetrics,
      currentExpenses: [
        { amount: 150, categoryID: "dining-id", date: new Date("2026-01-02T12:00:00.000Z") },
      ],
      previousExpenses: [
        { amount: 100, categoryID: "dining-id", date: new Date("2025-12-23T12:00:00.000Z") },
      ],
    });

    const observation = result.observations.find(
      (entry) => entry.type === "category-change",
    );
    expect(observation).toMatchObject({
      category: "Dining",
      observed: 150,
      baseline: 100,
      delta: 50,
      changePercent: 50,
    });
    expect(result.window.comparisonDays).toBe(10);
  });

  test("does not invent a percentage change when the baseline is zero", () => {
    const currentMetrics = makeMetrics({
      expenseTransactions: [
        { amount: 25, categoryID: "dining-id", date: new Date("2026-01-02T12:00:00.000Z") },
      ],
    });
    const previousMetrics = buildFinancialMetrics({
      startDate: new Date("2025-12-22T00:00:00.000Z"),
      endDate: new Date("2025-12-31T23:59:59.999Z"),
    });
    const result = buildBehavioralAnalysis({
      currentMetrics,
      previousMetrics,
      currentExpenses: [
        { amount: 25, categoryID: "dining-id", date: new Date("2026-01-02T12:00:00.000Z") },
      ],
      previousExpenses: [],
    });

    expect(result.observations.find(
      (entry) => entry.type === "category-change",
    )).toMatchObject({
      observed: 25,
      baseline: 0,
      changePercent: null,
    });
  });
});

describe("Anomaly detection engine", () => {
  const historicalExpenses = Array.from({ length: 6 }, (_, index) => ({
    _id: `past-${index}`,
    amount: 10,
    categoryID: "dining-id",
    date: new Date(Date.UTC(2025, 11, 22 + index, 12)),
  }));
  const currentMetrics = buildFinancialMetrics({
    expenseTransactions: [
      { amount: 100, categoryID: "dining-id", date: new Date("2026-01-02T12:00:00.000Z") },
    ],
    categoryLookup,
    startDate,
    endDate,
  });
  const previousMetrics = buildFinancialMetrics({
    expenseTransactions: historicalExpenses,
    categoryLookup,
    startDate: new Date("2025-12-22T00:00:00.000Z"),
    endDate: new Date("2025-12-31T23:59:59.999Z"),
  });

  test("detects a large transaction against a category-specific historical baseline", () => {
    const result = detectAnomalies({
      expenses: [
        { _id: "current", amount: 100, categoryID: "dining-id", date: new Date("2026-01-02T12:00:00.000Z") },
      ],
      previousExpenses: historicalExpenses,
      categoryLookup,
      currentMetrics,
      previousMetrics,
    });

    expect(result.anomalies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "large-transaction",
        transactionId: "current",
        amount: 100,
        baseline: 10,
        method: expect.stringContaining("median"),
      }),
    ]));
  });

  test("suppresses transaction outliers when historical sample size is insufficient", () => {
    const result = detectAnomalies({
      expenses: [
        { amount: 1000, categoryID: "dining-id", date: new Date("2026-01-02T12:00:00.000Z") },
      ],
      previousExpenses: historicalExpenses.slice(0, 2),
      categoryLookup,
      currentMetrics,
      previousMetrics,
    });

    expect(result.anomalies.some(
      (entry) => entry.type === "large-transaction",
    )).toBe(false);
    expect(result.summary.insufficientBaseline).toBe(true);
  });
});

describe("Financial health engine", () => {
  test("withholds the score when positive income or sufficient history is missing", () => {
    const metrics = makeMetrics();
    const result = assessFinancialHealth({ metrics });

    expect(result.score).toBeNull();
    expect(result.label).toBe("Insufficient data");
    expect(result.missingData).toContain(
      "At least 30 calendar days are required for an overall health score.",
    );
    expect(result.inferredRisk.financialBuffer.level).toBe("not-assessed");
  });

  test("uses documented weights and excludes unavailable components from weighting", () => {
    const metrics = buildFinancialMetrics({
      incomeTransactions: [
        { amount: 1000, date: new Date("2026-01-02T12:00:00.000Z") },
        { amount: 1000, date: new Date("2026-02-02T12:00:00.000Z") },
      ],
      expenseTransactions: [
        { amount: 500, categoryID: "dining-id", date: new Date("2026-01-05T12:00:00.000Z") },
        { amount: 500, categoryID: "dining-id", date: new Date("2026-02-05T12:00:00.000Z") },
      ],
      recurringSchedules: [],
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-02-28T23:59:59.999Z"),
      categoryLookup,
    });
    const result = assessFinancialHealth({ metrics });

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.scoringWeights).toEqual({
      savingsRate: 30,
      incomeStability: 20,
      expenseToIncome: 20,
      cashFlowStability: 15,
      budgetUtilization: 10,
      recurringCommitment: 5,
    });
    expect(result.components.budgetUtilization.score).toBeNull();
    expect(result.availableWeight).toBe(90);
  });

  test("scores higher savings rates more favorably", () => {
    const metrics = buildFinancialMetrics({
      incomeTransactions: [
        { amount: 1000, date: new Date("2026-01-02T12:00:00.000Z") },
        { amount: 1000, date: new Date("2026-02-02T12:00:00.000Z") },
      ],
      expenseTransactions: [
        { amount: 800, date: new Date("2026-01-05T12:00:00.000Z") },
        { amount: 800, date: new Date("2026-02-05T12:00:00.000Z") },
      ],
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-02-28T23:59:59.999Z"),
      categoryLookup,
    });

    expect(assessFinancialHealth({ metrics }).components.savingsRate.score).toBe(90);
  });
});
