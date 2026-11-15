jest.mock("../../src/models/RecurringModel", () => ({
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findById: jest.fn(),
}));

jest.mock("../../src/models/ExpenseModel", () => ({ updateOne: jest.fn() }));
jest.mock("../../src/models/IncomeModel", () => ({ updateOne: jest.fn() }));
jest.mock("../../src/models/CategoryModel", () => ({ findOne: jest.fn() }));

const RecurringModel = require("../../src/models/RecurringModel");
const ExpenseModel = require("../../src/models/ExpenseModel");
const CategoryModel = require("../../src/models/CategoryModel");
const {
  processRecurringSchedule,
} = require("../../src/services/recurring-engine.service");

const base = {
  _id: "schedule-1",
  userId: "user-1",
  title: "Rent",
  amount: 1000,
  category: "Rent",
  type: "EXPENSE",
  frequency: "monthly",
  recurrenceAnchorDay: 31,
  isActive: true,
};

describe("recurring engine end-date handling", () => {
  const now = new Date("2026-12-31T12:00:00.000Z");

  beforeEach(() => {
    jest.clearAllMocks();
    CategoryModel.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: "category-1" }),
    });
    ExpenseModel.updateOne.mockResolvedValue({ acknowledged: true, upsertedId: "expense-1" });
  });

  test("stops and deactivates a schedule once the next occurrence is past endDate", async () => {
    const schedule = {
      ...base,
      nextDate: new Date("2026-11-30T00:00:00.000Z"),
      endDate: new Date("2026-12-15T00:00:00.000Z"),
    };

    // First (and only) occurrence is within bounds, then the schedule is done.
    RecurringModel.findOneAndUpdate.mockResolvedValueOnce({
      ...schedule,
      nextDate: new Date("2026-12-31T00:00:00.000Z"),
    });

    const generated = await processRecurringSchedule(schedule, now, {});

    expect(generated).toBe(1);
    expect(ExpenseModel.updateOne).toHaveBeenCalledTimes(1);
  });

  test("does not generate an occurrence beyond endDate", async () => {
    // Due now, but already past the schedule's final date.
    const completed = {
      ...base,
      nextDate: new Date("2026-12-31T00:00:00.000Z"),
      endDate: new Date("2026-12-15T00:00:00.000Z"),
    };

    RecurringModel.findOneAndUpdate.mockResolvedValue({
      ...completed,
      isActive: false,
    });

    const generated = await processRecurringSchedule(completed, now, {});

    expect(generated).toBe(0);
    expect(ExpenseModel.updateOne).not.toHaveBeenCalled();
    expect(RecurringModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "schedule-1", userId: "user-1", isActive: true }),
      { $set: { isActive: false } },
      { new: true },
    );
  });

  test("reports each generated occurrence to the observation hook", async () => {
    const schedule = { ...base, frequency: "daily", nextDate: new Date("2026-12-29T00:00:00.000Z") };
    const onOccurrence = jest.fn();

    RecurringModel.findOneAndUpdate.mockImplementation(async (filter, update) => ({
      ...schedule,
      nextDate: update.$set.nextDate,
    }));

    const generated = await processRecurringSchedule(schedule, now, { onOccurrence });

    expect(generated).toBe(3);
    expect(onOccurrence).toHaveBeenCalledTimes(3);
    expect(onOccurrence.mock.calls[0][0]).toMatchObject({
      userId: "user-1",
      recurringId: "schedule-1",
      type: "EXPENSE",
      amount: 1000,
      categoryID: "category-1",
      transactionId: "expense-1",
    });
  });

  test("a failing observation hook never blocks the financial write", async () => {
    const schedule = { ...base, nextDate: new Date("2026-12-30T00:00:00.000Z") };

    RecurringModel.findOneAndUpdate.mockResolvedValue({
      ...schedule,
      nextDate: new Date("2027-01-30T00:00:00.000Z"),
    });

    const generated = await processRecurringSchedule(schedule, now, {
      onOccurrence: () => {
        throw new Error("consumer exploded");
      },
    });

    expect(generated).toBe(1);
    expect(ExpenseModel.updateOne).toHaveBeenCalledTimes(1);
  });
});
