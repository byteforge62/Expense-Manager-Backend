jest.mock("../../src/models/ExpenseModel", () => ({ find: jest.fn() }));
jest.mock("../../src/models/IncomeModel", () => ({ find: jest.fn() }));
jest.mock("../../src/models/BudgetModel", () => ({ find: jest.fn() }));
jest.mock("../../src/models/BillModel", () => ({ find: jest.fn() }));
jest.mock("../../src/models/RecurringModel", () => ({ find: jest.fn() }));
jest.mock("../../src/models/CategoryModel", () => ({ find: jest.fn() }));

const ExpenseModel = require("../../src/models/ExpenseModel");
const IncomeModel = require("../../src/models/IncomeModel");
const BudgetModel = require("../../src/models/BudgetModel");
const BillModel = require("../../src/models/BillModel");
const RecurringModel = require("../../src/models/RecurringModel");
const CategoryModel = require("../../src/models/CategoryModel");
const {
  getFinancialRecords,
} = require("../../src/modules/financial-intelligence/repositories/financial-intelligence.repository");

const configureFind = (model, records = []) => {
  model.find.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(records),
    }),
  });
};

describe("Financial intelligence repository", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    [
      ExpenseModel,
      IncomeModel,
      BudgetModel,
      BillModel,
      RecurringModel,
      CategoryModel,
    ].forEach((model) => configureFind(model));
  });

  test("scopes every user-owned collection query and uses the schema's user field names", async () => {
    const userId = "507f1f77bcf86cd799439011";
    await getFinancialRecords({
      userId,
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-01-30T00:00:00.000Z",
    });

    for (const [model, field] of [
      [ExpenseModel, "userID"],
      [IncomeModel, "userID"],
      [BudgetModel, "userID"],
      [BillModel, "userID"],
      [RecurringModel, "userId"],
    ]) {
      expect(model.find).toHaveBeenCalled();
      for (const [filter] of model.find.mock.calls) {
        expect(filter[field]).toBe(userId);
      }
    }

    expect(ExpenseModel.find).toHaveBeenCalledTimes(1);
    expect(IncomeModel.find).toHaveBeenCalledTimes(1);
    expect(CategoryModel.find).toHaveBeenCalledWith({ type: "expense" });
    expect(BillModel.find.mock.calls[0][0]).toMatchObject({
      status: "pending",
      dueDate: { $lte: expect.any(Date) },
    });
  });

  test("normalizes supplied timestamps to inclusive UTC calendar-day boundaries", async () => {
    const records = await getFinancialRecords({
      userId: "507f1f77bcf86cd799439011",
      startDate: "2026-01-01T15:00:00.000Z",
      endDate: "2026-01-02T03:00:00.000Z",
    });

    expect(records.currentWindow.start.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(records.currentWindow.end.toISOString()).toBe(
      "2026-01-02T23:59:59.999Z",
    );
    expect(records.comparisonWindow.end.toISOString()).toBe(
      "2025-12-31T23:59:59.999Z",
    );
  });
});
