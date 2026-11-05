const {
  calculateFinancialForecast,
} = require("../../src/modules/financial-forecasting/domain/forecast.engine");

const {
  getRecurringOccurrences,
} = require("../../src/modules/financial-forecasting/domain/forecast-calendar");

describe("Financial Forecast Engine", () => {
  const now = new Date("2026-11-05T00:00:00.000Z");

  const baseInput = {
    openingCash: 1000,
    horizonMonths: 3,
    now,
    incomeTransactions: [
      {
        amount: 9000,
        date: new Date("2026-09-21T00:00:00.000Z"),
      },
    ],
    expenseTransactions: [
      {
        amount: 4500,
        date: new Date("2026-09-21T00:00:00.000Z"),
      },
    ],
    recurringSchedules: [],
    pendingBills: [],
  };

  test("generates expected, best, and worst scenarios", () => {
    const result = calculateFinancialForecast(baseInput);

    expect(Object.keys(result.scenarios)).toEqual([
      "expected",
      "best",
      "worst",
    ]);

    expect(result.openingCash).toBe(1000);
    expect(result.forecastPeriod.horizonMonths).toBe(3);
    expect(result.scenarios.expected.monthly).toHaveLength(3);
  });

  test("uses the 90-day historical baseline", () => {
    const result = calculateFinancialForecast(baseInput);

    expect(result.historicalWindow.days).toBe(90);
    expect(result.historicalDailyBaseline.income).toBe(100);
    expect(result.historicalDailyBaseline.expenses).toBe(50);
  });

  test("applies best-case and worst-case assumptions to baseline flows", () => {
    const result = calculateFinancialForecast(baseInput);

    const expected = result.scenarios.expected;
    const best = result.scenarios.best;
    const worst = result.scenarios.worst;

    expect(best.totalIncome).toBeGreaterThan(expected.totalIncome);
    expect(best.totalExpenses).toBeLessThan(expected.totalExpenses);

    expect(worst.totalIncome).toBeLessThan(expected.totalIncome);
    expect(worst.totalExpenses).toBeGreaterThan(expected.totalExpenses);
  });

  test("includes recurring monthly occurrences using their anchor day", () => {
    const result = calculateFinancialForecast({
      ...baseInput,
      recurringSchedules: [
        {
          _id: "schedule-1",
          title: "Monthly payment",
          amount: 500,
          type: "EXPENSE",
          frequency: "monthly",
          nextDate: new Date("2026-11-30T00:00:00.000Z"),
          recurrenceAnchorDay: 31,
          isActive: true,
        },
      ],
    });

    const months = result.scenarios.expected.monthly;

    expect(months[0].scheduledExpenses).toBe(500);
    expect(months[1].scheduledExpenses).toBe(500);
    expect(months[2].scheduledExpenses).toBe(500);
  });

  test("includes overdue pending bills in the first forecast period", () => {
    const result = calculateFinancialForecast({
      ...baseInput,
      pendingBills: [
        {
          name: "Electricity",
          amount: 1000,
          dueDate: new Date("2026-11-01T00:00:00.000Z"),
          status: "pending",
          settledExpenseId: null,
        },
      ],
    });

    expect(
      result.scenarios.expected.monthly[0].pendingBills,
    ).toBe(1000);

    expect(result.warnings).toContain(
      "Pending bills are included as future commitments. If a corresponding expense was already recorded, link or reconcile it to avoid double-counting.",
    );
  });

  test("ignores unclassified recurring schedules and reports a warning", () => {
    const result = calculateFinancialForecast({
      ...baseInput,
      recurringSchedules: [
        {
          title: "Unclassified schedule",
          amount: 300,
          type: "UNCLASSIFIED",
          frequency: "monthly",
          nextDate: new Date("2026-11-10T00:00:00.000Z"),
          isActive: true,
        },
      ],
    });

    expect(
      result.scenarios.expected.monthly[0].scheduledExpenses,
    ).toBe(0);

    expect(result.warnings).toContain(
      "1 active recurring schedule(s) with UNCLASSIFIED type were excluded from the forecast.",
    );
  });

  test("does not include inactive recurring schedules", () => {
    const result = calculateFinancialForecast({
      ...baseInput,
      recurringSchedules: [
        {
          title: "Inactive subscription",
          amount: 200,
          type: "EXPENSE",
          frequency: "monthly",
          nextDate: new Date("2026-11-10T00:00:00.000Z"),
          isActive: false,
        },
      ],
    });

    expect(
      result.scenarios.expected.monthly[0].scheduledExpenses,
    ).toBe(0);
  });

  test("rejects unsupported forecast horizons", () => {
    expect(() =>
      calculateFinancialForecast({
        ...baseInput,
        horizonMonths: 5,
      }),
    ).toThrow("horizonMonths must be one of: 3, 6, 12");
  });

  test("rejects negative opening cash", () => {
    expect(() =>
      calculateFinancialForecast({
        ...baseInput,
        openingCash: -100,
      }),
    ).toThrow("openingCash must be a finite non-negative number");
  });

  test("rejects invalid transaction amounts", () => {
    expect(() =>
      calculateFinancialForecast({
        ...baseInput,
        incomeTransactions: [
          {
            amount: -500,
            date: now,
          },
        ],
      }),
    ).toThrow("incomeTransactions[0].amount");
  });

  test("rejects recurring schedules that exceed the occurrence limit", () => {
    expect(() =>
      getRecurringOccurrences({
        schedule: {
          title: "Daily schedule",
          amount: 10,
          type: "EXPENSE",
          frequency: "daily",
          nextDate: new Date("2020-01-01T00:00:00.000Z"),
        },
        startDate: now,
        endDate: new Date("2026-12-01T00:00:00.000Z"),
        maxOccurrences: 100,
      }),
    ).toThrow("exceeds the occurrence calculation limit");
  });

  test("preserves leap-year recurrence anchors", () => {
    const occurrences = getRecurringOccurrences({
      schedule: {
        title: "Annual renewal",
        amount: 1200,
        type: "EXPENSE",
        frequency: "yearly",
        nextDate: new Date("2024-02-29T00:00:00.000Z"),
        recurrenceAnchorDay: 29,
        recurrenceAnchorMonth: 1,
      },
      startDate: new Date("2025-01-01T00:00:00.000Z"),
      endDate: new Date("2029-01-01T00:00:00.000Z"),
    });

    expect(
      occurrences.map((item) => item.date.toISOString()),
    ).toEqual([
      "2025-02-28T00:00:00.000Z",
      "2026-02-28T00:00:00.000Z",
      "2027-02-28T00:00:00.000Z",
      "2028-02-29T00:00:00.000Z",
    ]);
  });
});