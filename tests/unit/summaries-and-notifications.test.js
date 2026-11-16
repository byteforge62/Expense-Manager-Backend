jest.mock("../../src/models/FinancialSummaryModel", () => {
  const model = { bulkWrite: jest.fn(), find: jest.fn(), deleteMany: jest.fn() };
  model.CategorySummaryModel = {
    bulkWrite: jest.fn(),
    deleteMany: jest.fn(),
    insertMany: jest.fn(),
    find: jest.fn(),
  };
  return model;
});

jest.mock("../../src/models/ExpenseModel", () => ({ aggregate: jest.fn(), findOne: jest.fn() }));
jest.mock("../../src/models/IncomeModel", () => ({ aggregate: jest.fn(), findOne: jest.fn() }));

jest.mock("../../src/models/UserModel", () => ({ findById: jest.fn() }));
jest.mock("../../src/models/NotificationModel", () => ({
  updateOne: jest.fn(),
  create: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn(),
  deleteOne: jest.fn(),
  deleteMany: jest.fn(),
}));

jest.mock("../../src/infrastructure/events/event-bus", () => ({ emit: jest.fn() }));

const FinancialSummaryModel = require("../../src/models/FinancialSummaryModel");
const { CategorySummaryModel } = require("../../src/models/FinancialSummaryModel");
const UserModel = require("../../src/models/UserModel");
const NotificationModel = require("../../src/models/NotificationModel");
const eventBus = require("../../src/infrastructure/events/event-bus");
const cache = require("../../src/infrastructure/memory-cache");

const summaries = require("../../src/modules/summaries/summaries.service");
const notificationService = require("../../src/modules/notifications/notification.service");

describe("incremental financial summaries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FinancialSummaryModel.bulkWrite.mockResolvedValue({});
    CategorySummaryModel.bulkWrite.mockResolvedValue({});
  });

  test("applies mirrored deltas to daily and monthly buckets", async () => {
    await summaries.applyDelta({
      userID: "user-1",
      kind: "expense",
      amount: 250,
      categoryID: "category-1",
      date: new Date("2026-11-15T10:00:00.000Z"),
    });

    const summaryOps = FinancialSummaryModel.bulkWrite.mock.calls[0][0];
    expect(summaryOps).toHaveLength(2);

    const daily = summaryOps[0].updateOne;
    expect(daily.filter.periodStart.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(daily.update.$inc).toEqual({
      totalExpense: 250,
      expenseCount: 1,
      net: -250,
    });
    expect(daily.updateOne === undefined).toBe(true);
    expect(daily.upsert).toBe(true);

    const monthly = summaryOps[1].updateOne;
    expect(monthly.filter.periodStart.toISOString()).toBe("2026-11-01T00:00:00.000Z");

    const categoryOps = CategorySummaryModel.bulkWrite.mock.calls[0][0];
    expect(categoryOps).toHaveLength(2);
    expect(categoryOps[0].updateOne.update.$inc).toEqual({ amount: 250, count: 1 });
  });

  test("a deletion exactly reverses a creation", async () => {
    await summaries.applyDelta({
      userID: "user-1",
      kind: "income",
      amount: 1000,
      date: new Date("2026-11-15T10:00:00.000Z"),
      direction: 1,
    });
    await summaries.applyDelta({
      userID: "user-1",
      kind: "income",
      amount: 1000,
      date: new Date("2026-11-15T10:00:00.000Z"),
      direction: -1,
    });

    const first = FinancialSummaryModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$inc;
    const second = FinancialSummaryModel.bulkWrite.mock.calls[1][0][0].updateOne.update.$inc;

    expect(first).toEqual({ totalIncome: 1000, incomeCount: 1, net: 1000 });
    expect(second).toEqual({ totalIncome: -1000, incomeCount: -1, net: -1000 });
  });

  test("rejects invalid financial input instead of writing partial data", async () => {
    await expect(
      summaries.applyDelta({ userID: "user-1", kind: "expense", amount: 0 }),
    ).rejects.toThrow(TypeError);

    await expect(
      summaries.applyDelta({ userID: "user-1", kind: "expense", amount: 10, date: "nope" }),
    ).rejects.toThrow(TypeError);

    expect(FinancialSummaryModel.bulkWrite).not.toHaveBeenCalled();
  });
});

describe("notification preferences and dedupe", () => {
  const mockUser = (preferences) => {
    UserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ notificationPreferences: preferences }),
      }),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    cache.clear();
    mockUser({});
    eventBus.emit.mockResolvedValue({});
    NotificationModel.create.mockResolvedValue({ _id: "notification-1" });
    NotificationModel.updateOne.mockResolvedValue({ upsertedCount: 1 });
  });

  const baseNotification = {
    userID: "user-1",
    type: "budget.threshold_reached",
    category: "budget",
    priority: "medium",
    title: "Budget 90%+ used",
    message: "You have used 95% of this budget.",
  };

  test("suppresses categories the user disabled", async () => {
    mockUser({ budgetAlerts: false });

    const result = await notificationService.createNotification(baseNotification);

    expect(result).toEqual({ created: false, suppressed: "category_disabled" });
    expect(NotificationModel.create).not.toHaveBeenCalled();
  });

  test("suppresses alerts below the user's minimum priority", async () => {
    mockUser({ minimumPriority: "high" });

    const result = await notificationService.createNotification(baseNotification);

    expect(result).toEqual({ created: false, suppressed: "below_minimum_priority" });
  });

  test("suppresses everything when in-app delivery is disabled", async () => {
    mockUser({ inApp: false });

    const result = await notificationService.createNotification(baseNotification);

    expect(result).toEqual({ created: false, suppressed: "in_app_disabled" });
  });

  test("deduplicates by user and dedupe key", async () => {
    const result = await notificationService.createNotification({
      ...baseNotification,
      dedupeKey: "budget_threshold:b1:2026-11-01:90",
    });

    expect(result).toEqual({ created: true, deduplicated: false });
    expect(NotificationModel.updateOne).toHaveBeenCalledWith(
      { userID: "user-1", dedupeKey: "budget_threshold:b1:2026-11-01:90" },
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ category: "budget" }) }),
      { upsert: true },
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      "notification.created",
      expect.objectContaining({ userId: "user-1", category: "budget" }),
      { source: "notification" },
    );

    NotificationModel.updateOne.mockResolvedValue({ upsertedCount: 0 });
    const second = await notificationService.createNotification({
      ...baseNotification,
      dedupeKey: "budget_threshold:b1:2026-11-01:90",
    });

    expect(second).toEqual({ created: false, deduplicated: true });
  });

  test("treats a unique-index race as a duplicate, not an error", async () => {
    NotificationModel.create.mockRejectedValue(
      Object.assign(new Error("dup"), { code: 11000 }),
    );

    const result = await notificationService.createNotification(baseNotification);

    expect(result).toEqual({ created: false, deduplicated: true });
  });
});
