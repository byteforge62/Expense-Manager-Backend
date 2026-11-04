const { calculateAffordability } = require("../../src/modules/purchase-intelligence/domain/affordability.engine");

describe("Purchase affordability engine", () => {
  const now = new Date("2026-11-03T12:00:00.000Z");
  const incomeTransactions = [
    { amount: 60000, date: new Date("2026-08-05T12:00:00.000Z") },
    { amount: 60000, date: new Date("2026-10-15T12:00:00.000Z") },
    { amount: 60000, date: new Date("2026-11-01T12:00:00.000Z") },
  ];
  const expenseTransactions = [
    { amount: 30000, date: new Date("2026-08-05T12:00:00.000Z") },
    { amount: 30000, date: new Date("2026-10-15T12:00:00.000Z") },
    { amount: 30000, date: new Date("2026-11-01T12:00:00.000Z") },
  ];

  test("classifies a purchase that preserves the three-month reserve", () => {
    const result = calculateAffordability({
      availableCash: 200000,
      purchasePrice: 30000,
      incomeTransactions,
      expenseTransactions,
      now,
    });
    expect(result.risk.level).toBe("LOW");
    expect(result.metrics.cashAfterPurchase).toBe(170000);
    expect(result.metrics.emergencyReserveTarget).toBeCloseTo(91312.5, 0);
    expect(result.scenarios.incomeFallsBy15Percent).toBeGreaterThan(0);
  });

  test("classifies a purchase that breaks the reserve", () => {
    const result = calculateAffordability({
      availableCash: 100000,
      purchasePrice: 20000,
      incomeTransactions,
      expenseTransactions,
      now,
    });
    expect(result.risk.level).toBe("HIGH");
    expect(result.risk.recommendation).toBe("DELAY_OR_REDUCE_COST");
  });

  test("rejects negative cash and non-positive purchase prices", () => {
    expect(() => calculateAffordability({
      availableCash: -1,
      purchasePrice: 100,
      incomeTransactions,
      expenseTransactions,
      now,
    })).toThrow("Available cash must be a non-negative finite number");

    expect(() => calculateAffordability({
      availableCash: 100,
      purchasePrice: 0,
      incomeTransactions,
      expenseTransactions,
      now,
    })).toThrow("Purchase price must be a positive finite number");
  });

  test("reports low confidence when transaction history is short", () => {
    const result = calculateAffordability({
      availableCash: 100000,
      purchasePrice: 1000,
      incomeTransactions: [{ amount: 10000, date: now }],
      expenseTransactions: [{ amount: 5000, date: now }],
      now,
    });
    expect(result.historyConfidence).toBe("LOW");
    expect(result.warnings.some((warning) => warning.includes("Fewer than 60 days"))).toBe(true);
  });


  test("subtracts pending bills from post-purchase cash", () => {
    const result = calculateAffordability({
      availableCash: 200000,
      purchasePrice: 30000,
      incomeTransactions,
      expenseTransactions,
      pendingBills: [
        {
          name: "Rent",
          amount: 15000,
          dueDate: new Date("2026-11-15T12:00:00.000Z"),
        },
      ],
      now,
    });

    expect(result.metrics.cashAfterPurchase).toBe(170000);
    expect(result.metrics.pendingBillsTotal).toBe(15000);
    expect(result.metrics.cashAfterPurchaseAndCommitments).toBe(155000);
    expect(result.commitments.pendingBillsCount).toBe(1);
  });

  test("projects active recurring expenses and income", () => {
    const result = calculateAffordability({
      availableCash: 200000,
      purchasePrice: 30000,
      incomeTransactions,
      expenseTransactions,
      recurringSchedules: [
        {
          _id: "recurring-income",
          amount: 10000,
          type: "INCOME",
          frequency: "monthly",
          nextDate: new Date("2026-11-10T12:00:00.000Z"),
        },
        {
          _id: "recurring-expense",
          amount: 5000,
          type: "EXPENSE",
          frequency: "monthly",
          nextDate: new Date("2026-11-12T12:00:00.000Z"),
        },
      ],
      now,
    });

    expect(result.metrics.upcomingRecurringIncome).toBe(10000);
    expect(result.metrics.upcomingRecurringExpenses).toBe(5000);
    expect(result.metrics.netUpcomingCommitments).toBe(-5000);
    expect(result.metrics.cashAfterPurchaseAndCommitments).toBe(175000);
  });


  test("excludes historical transactions linked to active recurring schedules", () => {
    const testNow = new Date("2026-11-04T12:00:00.000Z");
    const historicalDate = new Date(
      testNow.getTime() - 89 * 24 * 60 * 60 * 1000,
    );

    const result = calculateAffordability({
      availableCash: 200000,
      purchasePrice: 30000,

      incomeTransactions: [
        {
          amount: 90000,
          date: historicalDate,
        },
        {
          amount: 10000,
          date: historicalDate,
          recurringId: "active-income",
        },
      ],

      expenseTransactions: [],

      recurringSchedules: [
        {
          _id: "active-income",
          amount: 10000,
          type: "INCOME",
          frequency: "monthly",
          nextDate: new Date("2026-11-10T12:00:00.000Z"),
        },
      ],

      now: testNow,
    });

    expect(result.metrics.averageMonthlyIncome).toBeCloseTo(
      (90000 / 90) * 30.4375 + 10000,
      2,
    );
  });


  test("projects multiple weekly occurrences within the commitment window", () => {
    const result = calculateAffordability({
      availableCash: 200000,
      purchasePrice: 30000,
      incomeTransactions,
      expenseTransactions,
      recurringSchedules: [
        {
          _id: "weekly-expense",
          amount: 1000,
          type: "EXPENSE",
          frequency: "weekly",
          nextDate: new Date("2026-11-05T12:00:00.000Z"),
        },
      ],
      now,
    });

    expect(result.metrics.upcomingRecurringExpenses).toBe(5000);
    expect(result.commitments.recurringExpenseOccurrences).toBe(5);
  });

  test("rejects invalid commitment inputs", () => {
    expect(() =>
      calculateAffordability({
        availableCash: 100000,
        purchasePrice: 1000,
        incomeTransactions,
        expenseTransactions,
        pendingBills: {},
        now,
      }),
    ).toThrow("Pending bills must be an array");

    expect(() =>
      calculateAffordability({
        availableCash: 100000,
        purchasePrice: 1000,
        incomeTransactions,
        expenseTransactions,
        recurringSchedules: {},
        now,
      }),
    ).toThrow("Recurring schedules must be an array");
  });

});
