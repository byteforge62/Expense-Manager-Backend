
const mockPurchaseProductFindById = jest.fn();
const mockIncomeFind = jest.fn();
const mockExpenseFind = jest.fn();
const mockBillFind = jest.fn();
const mockRecurringFind = jest.fn();
const mockCalculateAffordability = jest.fn();

jest.mock("../../src/modules/purchase-intelligence/models/PurchaseProductModel", () => ({
  findById: (...args) => mockPurchaseProductFindById(...args),
}));

jest.mock("../../src/models/IncomeModel", () => ({
  find: (...args) => mockIncomeFind(...args),
}));

jest.mock("../../src/models/ExpenseModel", () => ({
  find: (...args) => mockExpenseFind(...args),
}));

jest.mock("../../src/models/BillModel", () => ({
  find: (...args) => mockBillFind(...args),
}));

jest.mock("../../src/models/RecurringModel", () => ({
  find: (...args) => mockRecurringFind(...args),
}));

jest.mock("../../src/modules/purchase-intelligence/domain/affordability.engine", () => ({
  calculateAffordability: (...args) => mockCalculateAffordability(...args),
}));

const { analyzeProduct } = require("../../src/modules/purchase-intelligence/services/purchase-intelligence.service");

const NOW = new Date("2026-11-04T10:00:00.000Z");
const USER_ID = "672000000000000000000001";
const PRODUCT_ID = "673000000000000000000001";

const incomeTransactions = [
  { amount: 90000, date: new Date("2026-10-01T00:00:00.000Z") },
];

const expenseTransactions = [
  { amount: 25000, date: new Date("2026-10-10T00:00:00.000Z") },
];

const pendingBills = [
  { name: "Electricity", amount: 1800, dueDate: new Date("2026-11-10T00:00:00.000Z") },
];

const recurringSchedules = [
  {
    title: "Monthly salary",
    amount: 40000,
    type: "INCOME",
    frequency: "monthly",
    nextDate: new Date("2026-11-30T00:00:00.000Z"),
  },
  {
    title: "Internet",
    amount: 1000,
    type: "EXPENSE",
    frequency: "monthly",
    nextDate: new Date("2026-11-12T00:00:00.000Z"),
  },
];

const createQuery = (data) => {
  const query = {
    select: jest.fn(),
    lean: jest.fn().mockResolvedValue(data),
  };

  query.select.mockReturnValue(query);

  return query;
};

describe("Purchase Intelligence service - analyzeProduct", () => {
  let product;
  let incomeQuery;
  let expenseQuery;
  let billQuery;
  let recurringQuery;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    jest.clearAllMocks();

    product = {
      _id: PRODUCT_ID,
      userID: {
        toString: () => USER_ID,
      },
      currentPrice: 50000,
      lastAnalysis: null,
      save: jest.fn().mockResolvedValue(undefined),
    };

    incomeQuery = createQuery(incomeTransactions);
    expenseQuery = createQuery(expenseTransactions);
    billQuery = createQuery(pendingBills);
    recurringQuery = createQuery(recurringSchedules);

    mockPurchaseProductFindById.mockResolvedValue(product);
    mockIncomeFind.mockReturnValue(incomeQuery);
    mockExpenseFind.mockReturnValue(expenseQuery);
    mockBillFind.mockReturnValue(billQuery);
    mockRecurringFind.mockReturnValue(recurringQuery);

    mockCalculateAffordability.mockReturnValue({
      riskLevel: "MODERATE",
      cashAfterPurchase: 20000,
      commitments: {
        pendingBills: 1800,
        recurringIncome: 40000,
        recurringExpenses: 1000,
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("loads the product using its ID and verifies ownership", async () => {
    await analyzeProduct(PRODUCT_ID, USER_ID, 70000);

    expect(mockPurchaseProductFindById).toHaveBeenCalledWith(PRODUCT_ID);
    expect(mockCalculateAffordability).toHaveBeenCalledTimes(1);
  });

  test("loads income and expense transactions for the authenticated user within the 90-day window", async () => {
    await analyzeProduct(PRODUCT_ID, USER_ID, 70000);

    const expectedStartDate = new Date(
      NOW.getTime() - 90 * 24 * 60 * 60 * 1000
    );

    expect(mockIncomeFind).toHaveBeenCalledWith({
      userID: USER_ID,
      date: {
        $gte: expectedStartDate,
        $lte: NOW,
      },
    });

    expect(mockExpenseFind).toHaveBeenCalledWith({
      userID: USER_ID,
      date: {
        $gte: expectedStartDate,
        $lte: NOW,
      },
    });
  });

  test("selects recurring transaction metadata for income and expenses", async () => {
    await analyzeProduct(PRODUCT_ID, USER_ID, 70000);

    expect(incomeQuery.select).toHaveBeenCalledWith("amount date +recurringId");
    expect(expenseQuery.select).toHaveBeenCalledWith("amount date +recurringId");

    expect(incomeQuery.lean).toHaveBeenCalledTimes(1);
    expect(expenseQuery.lean).toHaveBeenCalledTimes(1);
  });

  test("loads only pending, unsettled bills due within the next 30 days", async () => {
    await analyzeProduct(PRODUCT_ID, USER_ID, 70000);

    expect(mockBillFind).toHaveBeenCalledWith({
      userID: USER_ID,
      status: "pending",
      dueDate: {
        $lte: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
      settledExpenseId: null,
    });

    expect(billQuery.select).toHaveBeenCalledWith("name amount dueDate");
    expect(billQuery.lean).toHaveBeenCalledTimes(1);
  });

  test("loads active classified recurring schedules for the authenticated user", async () => {
    await analyzeProduct(PRODUCT_ID, USER_ID, 70000);

    expect(mockRecurringFind).toHaveBeenCalledWith({
      userId: USER_ID,
      isActive: true,
      type: {
        $in: ["INCOME", "EXPENSE"],
      },
    });

    expect(recurringQuery.select).toHaveBeenCalledWith(
      "title amount type frequency nextDate"
    );
    expect(recurringQuery.lean).toHaveBeenCalledTimes(1);
  });

  test("passes all four financial datasets and the analyzed purchase details to the engine", async () => {
    await analyzeProduct(PRODUCT_ID, USER_ID, 70000, 55000);

    expect(mockCalculateAffordability).toHaveBeenCalledWith({
      availableCash: 70000,
      purchasePrice: 55000,
      incomeTransactions,
      expenseTransactions,
      pendingBills,
      recurringSchedules,
      now: NOW,
    });
  });

  test("uses the product's current price when no purchase price override is supplied", async () => {
    await analyzeProduct(PRODUCT_ID, USER_ID, 70000);

    expect(mockCalculateAffordability).toHaveBeenCalledWith(
      expect.objectContaining({
        purchasePrice: product.currentPrice,
      })
    );
  });

  test("persists the affordability result and returns the product with its analysis", async () => {
    const analysis = {
      riskLevel: "MODERATE",
      cashAfterPurchase: 20000,
    };

    mockCalculateAffordability.mockReturnValue(analysis);

    const response = await analyzeProduct(PRODUCT_ID, USER_ID, 70000, 55000);

    expect(product.lastAnalysis).toEqual({
      availableCash: 70000,
      purchasePrice: 55000,
      result: analysis,
      analyzedAt: NOW,
    });

    expect(product.save).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      product,
      analysis,
    });
  });

  test("does not analyze a product owned by another user", async () => {
    product.userID.toString = () => "674000000000000000000001";

    await expect(
      analyzeProduct(PRODUCT_ID, USER_ID, 70000)
    ).rejects.toThrow("You are not authorized to access this product");

    expect(mockIncomeFind).not.toHaveBeenCalled();
    expect(mockExpenseFind).not.toHaveBeenCalled();
    expect(mockBillFind).not.toHaveBeenCalled();
    expect(mockRecurringFind).not.toHaveBeenCalled();
    expect(mockCalculateAffordability).not.toHaveBeenCalled();
    expect(product.save).not.toHaveBeenCalled();
  });

  test("does not analyze when the product does not exist", async () => {
    mockPurchaseProductFindById.mockResolvedValue(null);

    await expect(
      analyzeProduct(PRODUCT_ID, USER_ID, 70000)
    ).rejects.toThrow("Tracked product not found");

    expect(mockIncomeFind).not.toHaveBeenCalled();
    expect(mockExpenseFind).not.toHaveBeenCalled();
    expect(mockBillFind).not.toHaveBeenCalled();
    expect(mockRecurringFind).not.toHaveBeenCalled();
    expect(mockCalculateAffordability).not.toHaveBeenCalled();
  });
});
