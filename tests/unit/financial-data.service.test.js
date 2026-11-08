const {
  normalizeFinancialRecords,
} = require("../../src/modules/financial-intelligence/services/financial-data.service");

describe("Financial data normalization service", () => {
  test("normalizes model fields, optional category data, and recurring types", () => {
    const data = normalizeFinancialRecords({
      expenses: [
        {
          _id: "expense-id",
          amount: "12.5",
          date: "2026-01-03T00:00:00.000Z",
          categoryID: null,
        },
      ],
      incomes: [
        {
          amount: 100,
          date: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
      budgets: [{ amount: undefined }],
      bills: [
        {
          amount: "50",
          dueDate: "2026-01-10T00:00:00.000Z",
          status: "PENDING",
        },
      ],
      recurringSchedules: [
        {
          amount: "25",
          type: undefined,
          frequency: "monthly",
          nextDate: "2026-01-15T00:00:00.000Z",
          isActive: true,
        },
      ],
      categories: [
        { _id: "category-id", name: "Dining", type: "expense" },
      ],
    });

    expect(data.expenses[0]).toMatchObject({
      _id: "expense-id",
      amount: 12.5,
      categoryID: null,
    });
    expect(data.incomes[0].source).toBeNull();
    expect(data.budgets[0].amount).toBeNull();
    expect(data.bills[0].status).toBe("pending");
    expect(data.recurringSchedules[0]).toMatchObject({
      type: "UNCLASSIFIED",
      frequency: "monthly",
      isActive: true,
    });
    expect(data.categoryLookup.get("category-id").name).toBe("Dining");
  });

  test("fails explicitly for malformed financial values", () => {
    expect(() => normalizeFinancialRecords({
      expenses: [{ amount: "not-a-number", date: new Date() }],
    })).toThrow("expenses[0].amount must be a finite number");

    expect(() => normalizeFinancialRecords({
      incomes: [{ amount: 10, date: "not-a-date" }],
    })).toThrow("incomes[0].date must be a valid date");
  });
});
