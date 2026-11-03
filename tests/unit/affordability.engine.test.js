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
});
