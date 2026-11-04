jest.mock("../../src/models/RecurringModel", () => ({
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findById: jest.fn(),
}));

jest.mock("../../src/models/ExpenseModel", () => ({
  updateOne: jest.fn(),
}));

jest.mock("../../src/models/IncomeModel", () => ({
  updateOne: jest.fn(),
}));

jest.mock("../../src/models/CategoryModel", () => ({
  findOne: jest.fn(),
}));

const RecurringModel = require("../../src/models/RecurringModel");
const ExpenseModel = require("../../src/models/ExpenseModel");
const IncomeModel = require("../../src/models/IncomeModel");
const CategoryModel = require("../../src/models/CategoryModel");

const {
  addFrequency,
  processRecurringSchedule,
  processDueRecurringTransactions,
} = require("../../src/services/recurring-engine.service");

describe("Recurring transaction engine", () => {
  const now = new Date("2026-11-04T12:00:00.000Z");

  const baseSchedule = {
    _id: "schedule-123",
    userId: "user-123",
    title: "Monthly payment",
    amount: 5000,
    category: "Rent",
    type: "EXPENSE",
    frequency: "monthly",
    nextDate: new Date("2026-11-01T00:00:00.000Z"),
    isActive: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    CategoryModel.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: "category-123",
      }),
    });

    ExpenseModel.updateOne.mockResolvedValue({
      acknowledged: true,
      upsertedCount: 1,
    });

    IncomeModel.updateOne.mockResolvedValue({
      acknowledged: true,
      upsertedCount: 1,
    });
  });

  describe("addFrequency", () => {
    test("adds one day for daily schedules", () => {
      const result = addFrequency(
        new Date("2026-11-04T00:00:00.000Z"),
        "daily",
      );

      expect(result.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    });

    test("adds seven days for weekly schedules", () => {
      const result = addFrequency(
        new Date("2026-11-04T00:00:00.000Z"),
        "weekly",
      );

      expect(result.toISOString()).toBe("2026-11-11T00:00:00.000Z");
    });

    test("handles January 31 correctly when adding a month", () => {
      const result = addFrequency(
        new Date("2026-01-31T00:00:00.000Z"),
        "monthly",
      );

      expect(result.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    });

    test("handles leap-year February correctly", () => {
      const result = addFrequency(
        new Date("2028-01-31T00:00:00.000Z"),
        "monthly",
      );

      expect(result.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    });

    test("handles yearly schedules", () => {
      const result = addFrequency(
        new Date("2026-06-15T00:00:00.000Z"),
        "yearly",
      );

      expect(result.toISOString()).toBe("2027-06-15T00:00:00.000Z");
    });

    test("rejects unsupported frequencies", () => {
      expect(() => addFrequency(now, "hourly")).toThrow(
        "Unsupported recurring frequency",
      );
    });
  });

  describe("processRecurringSchedule", () => {
    test("creates an expense occurrence using the correct schema fields", async () => {
      const nextDate = new Date("2026-12-01T00:00:00.000Z");

      RecurringModel.findOneAndUpdate.mockResolvedValue({
        ...baseSchedule,
        nextDate,
      });

      const generated = await processRecurringSchedule(baseSchedule, now);

      expect(generated).toBe(1);

      expect(CategoryModel.findOne).toHaveBeenCalledWith({
        name: "Rent",
        type: "expense",
      });

      expect(ExpenseModel.updateOne).toHaveBeenCalledWith(
        {
          userID: baseSchedule.userId,
          recurringId: baseSchedule._id,
          recurringOccurrenceDate: baseSchedule.nextDate,
        },
        {
          $setOnInsert: expect.objectContaining({
            userID: baseSchedule.userId,
            categoryID: "category-123",
            amount: 5000,
            date: baseSchedule.nextDate,
            description: "Monthly payment",
            recurringId: baseSchedule._id,
            recurringOccurrenceDate: baseSchedule.nextDate,
          }),
        },
        {
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: false,
        },
      );
    });

    test("creates an income occurrence using the correct schema fields", async () => {
      const incomeSchedule = {
        ...baseSchedule,
        type: "INCOME",
        title: "Monthly salary",
        category: "",
      };

      const nextDate = new Date("2026-12-01T00:00:00.000Z");

      RecurringModel.findOneAndUpdate.mockResolvedValue({
        ...incomeSchedule,
        nextDate,
      });

      const generated = await processRecurringSchedule(incomeSchedule, now);

      expect(generated).toBe(1);

      expect(IncomeModel.updateOne).toHaveBeenCalledWith(
        {
          userID: incomeSchedule.userId,
          recurringId: incomeSchedule._id,
          recurringOccurrenceDate: incomeSchedule.nextDate,
        },
        {
          $setOnInsert: expect.objectContaining({
            userID: incomeSchedule.userId,
            amount: incomeSchedule.amount,
            source: incomeSchedule.title,
            date: incomeSchedule.nextDate,
            recurringId: incomeSchedule._id,
            recurringOccurrenceDate: incomeSchedule.nextDate,
          }),
        },
        {
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: false,
        },
      );

      expect(CategoryModel.findOne).not.toHaveBeenCalled();
      expect(ExpenseModel.updateOne).not.toHaveBeenCalled();
    });

    test("does not generate an occurrence when the schedule is not due", async () => {
      const futureSchedule = {
        ...baseSchedule,
        nextDate: new Date("2026-12-01T00:00:00.000Z"),
      };

      const generated = await processRecurringSchedule(futureSchedule, now);

      expect(generated).toBe(0);
      expect(ExpenseModel.updateOne).not.toHaveBeenCalled();
      expect(RecurringModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test("does not process inactive schedules", async () => {
      const inactiveSchedule = {
        ...baseSchedule,
        isActive: false,
      };

      const generated = await processRecurringSchedule(inactiveSchedule, now);

      expect(generated).toBe(0);
      expect(ExpenseModel.updateOne).not.toHaveBeenCalled();
    });

    test("reports a missing expense category without advancing the schedule", async () => {
      CategoryModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      await expect(processRecurringSchedule(baseSchedule, now)).rejects.toThrow(
        'Expense category "Rent" was not found',
      );

      expect(RecurringModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(ExpenseModel.updateOne).not.toHaveBeenCalled();
    });

    test("processes multiple missed occurrences", async () => {
      const schedule = {
        ...baseSchedule,
        frequency: "daily",
        nextDate: new Date("2026-11-01T00:00:00.000Z"),
      };

      RecurringModel.findOneAndUpdate.mockImplementation(
        async (filter, update) => ({
          ...schedule,
          nextDate: update.$set.nextDate,
        }),
      );

      const generated = await processRecurringSchedule(schedule, now);

      expect(generated).toBe(4);
      expect(ExpenseModel.updateOne).toHaveBeenCalledTimes(4);
      expect(RecurringModel.findOneAndUpdate).toHaveBeenCalledTimes(4);
    });

    test("uses an idempotent occurrence key when creating transactions", async () => {
      const nextDate = new Date("2026-12-01T00:00:00.000Z");

      RecurringModel.findOneAndUpdate.mockResolvedValue({
        ...baseSchedule,
        nextDate,
      });

      await processRecurringSchedule(baseSchedule, now);

      const [filter, update, options] = ExpenseModel.updateOne.mock.calls[0];

      expect(filter).toEqual({
        userID: baseSchedule.userId,
        recurringId: baseSchedule._id,
        recurringOccurrenceDate: baseSchedule.nextDate,
      });

      expect(update.$setOnInsert).toBeDefined();
      expect(options.upsert).toBe(true);
    });
  });

  describe("processDueRecurringTransactions", () => {
    test("processes due classified schedules", async () => {
      const schedule = {
        ...baseSchedule,
        nextDate: new Date("2026-11-01T00:00:00.000Z"),
      };

      RecurringModel.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([schedule]),
      });

      RecurringModel.findOneAndUpdate.mockResolvedValue({
        ...schedule,
        nextDate: new Date("2026-12-01T00:00:00.000Z"),
      });

      const result = await processDueRecurringTransactions(now);

      expect(result).toEqual({
        schedulesChecked: 1,
        occurrencesGenerated: 1,
        failures: [],
      });

      expect(RecurringModel.find).toHaveBeenCalledWith({
        isActive: true,
        type: { $in: ["INCOME", "EXPENSE"] },
        nextDate: { $lte: now },
      });
    });

    test("returns individual schedule failures without stopping the batch", async () => {
      const failingSchedule = {
        ...baseSchedule,
        _id: "schedule-failing",
      };

      const validSchedule = {
        ...baseSchedule,
        _id: "schedule-valid",
        nextDate: new Date("2026-11-01T00:00:00.000Z"),
      };

      RecurringModel.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([failingSchedule, validSchedule]),
      });

      CategoryModel.findOne
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue(null),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({
            _id: "category-123",
          }),
        });

      RecurringModel.findOneAndUpdate.mockResolvedValue({
        ...validSchedule,
        nextDate: new Date("2026-12-01T00:00:00.000Z"),
      });

      const result = await processDueRecurringTransactions(now);

      expect(result.schedulesChecked).toBe(2);
      expect(result.occurrencesGenerated).toBe(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].recurringId).toBe("schedule-failing");
    });

    test("rejects an invalid processing date", async () => {
      await expect(
        processDueRecurringTransactions("not-a-date"),
      ).rejects.toThrow("A valid processing date is required");
    });
  });
});


describe("addFrequency recurrence anchors", () => {
  const {
    addFrequency,
  } = require("../../src/services/recurring-engine.service");

  test("preserves day 31 after a February occurrence", () => {
    const anchor = {
      recurrenceAnchorDay: 31,
      recurrenceAnchorMonth: 0,
    };

    const february = addFrequency(
      new Date("2027-01-31T00:00:00.000Z"),
      "monthly",
      anchor,
    );

    const march = addFrequency(february, "monthly", anchor);

    expect(february.toISOString()).toBe("2027-02-28T00:00:00.000Z");
    expect(march.toISOString()).toBe("2027-03-31T00:00:00.000Z");
  });

  test("preserves leap-day yearly recurrence", () => {
    const anchor = {
      recurrenceAnchorDay: 29,
      recurrenceAnchorMonth: 1,
    };

    const nextYear = addFrequency(
      new Date("2024-02-29T00:00:00.000Z"),
      "yearly",
      anchor,
    );

    const followingYear = addFrequency(nextYear, "yearly", anchor);

    expect(nextYear.toISOString()).toBe("2025-02-28T00:00:00.000Z");
    expect(followingYear.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  test("preserves the original month and day after a leap year", () => {
    const anchor = {
      recurrenceAnchorDay: 29,
      recurrenceAnchorMonth: 1,
    };

    const nextYear = addFrequency(
      new Date("2024-02-29T00:00:00.000Z"),
      "yearly",
      anchor,
    );

    const leapYear = addFrequency(nextYear, "yearly", anchor);

    expect(leapYear.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
});

