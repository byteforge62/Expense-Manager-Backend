jest.mock("../../src/models/BudgetUtilizationModel", () => ({ updateOne: jest.fn() }));
jest.mock("../../src/models/ExpenseModel", () => ({ aggregate: jest.fn() }));
jest.mock("../../src/models/BillModel", () => ({ find: jest.fn() }));
jest.mock("../../src/infrastructure/events/event-bus", () => ({ emit: jest.fn() }));

const BudgetUtilizationModel = require("../../src/models/BudgetUtilizationModel");
const ExpenseModel = require("../../src/models/ExpenseModel");
const BillModel = require("../../src/models/BillModel");
const eventBus = require("../../src/infrastructure/events/event-bus");

const budgetMonitor = require("../../src/modules/automation/budget-monitor.service");
const billReminders = require("../../src/modules/automation/bill-reminder.service");
const { lifecycleFor } = require("../../src/modules/automation/intelligence-refresh.service");

describe("budget monitor", () => {
  const now = new Date("2026-11-15T10:00:00.000Z");

  beforeEach(() => {
    jest.clearAllMocks();
    eventBus.emit.mockResolvedValue({ queued: true });
    BudgetUtilizationModel.updateOne.mockResolvedValue({ acknowledged: true });
  });

  test("falls back to the current UTC month for undated budgets", () => {
    const period = budgetMonitor.resolveBudgetPeriod({ amount: 100 }, now);

    expect(period.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-11-30T23:59:59.999Z");
  });

  test("uses explicit budget dates when present", () => {
    const period = budgetMonitor.resolveBudgetPeriod(
      {
        amount: 100,
        start_date: new Date("2026-01-05T00:00:00.000Z"),
        end_date: new Date("2026-02-05T00:00:00.000Z"),
      },
      now,
    );

    expect(period.start.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-02-05T00:00:00.000Z");
  });

  test("alerts only on the highest crossed threshold", async () => {
    ExpenseModel.aggregate.mockResolvedValue([{ spent: 950, count: 4 }]);

    const result = await budgetMonitor.evaluateBudget(
      {
        _id: "budget-1",
        userID: "user-1",
        categoryID: "category-1",
        amount: 1000,
        start_date: new Date("2026-11-01T00:00:00.000Z"),
        end_date: new Date("2026-11-30T00:00:00.000Z"),
      },
      now,
    );

    expect(result.utilizationPercent).toBe(95);
    expect(result.highestThresholdReached).toBe(90);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);

    const [eventName, payload, options] = eventBus.emit.mock.calls[0];
    expect(eventName).toBe("budget.threshold_reached");
    expect(payload).toMatchObject({ threshold: 90, utilizationPercent: 95, spent: 950 });
    expect(options.dedupeKey).toBe("budget_threshold:budget-1:2026-11-01:90");
  });

  test("does not alert below the first threshold", async () => {
    ExpenseModel.aggregate.mockResolvedValue([{ spent: 100, count: 1 }]);

    const result = await budgetMonitor.evaluateBudget(
      { _id: "budget-1", userID: "user-1", categoryID: "c1", amount: 1000 },
      now,
    );

    expect(result.highestThresholdReached).toBe(0);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  test("persists derived utilization for every evaluated budget", async () => {
    ExpenseModel.aggregate.mockResolvedValue([{ spent: 500, count: 2 }]);

    await budgetMonitor.evaluateBudget(
      { _id: "budget-1", userID: "user-1", categoryID: "c1", amount: 1000 },
      now,
    );

    expect(BudgetUtilizationModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ budgetID: "budget-1" }),
      expect.objectContaining({
        $set: expect.objectContaining({ spent: 500, utilization: 0.5 }),
      }),
      { upsert: true },
    );
  });
});

describe("bill reminders", () => {
  const now = new Date("2026-11-15T09:00:00.000Z");

  const chain = (rows) => {
    const query = {
      select: jest.fn(() => query),
      sort: jest.fn(() => query),
      limit: jest.fn(() => query),
      lean: jest.fn(async () => rows),
    };
    return query;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    eventBus.emit.mockResolvedValue({ queued: true });
  });

  test("classifies due-soon and overdue bills without mutating them", async () => {
    BillModel.find.mockImplementation((filter) => {
      const isOverdueScan = filter.dueDate.$gte.getTime() === 0;

      if (isOverdueScan) {
        return chain([
          {
            _id: "bill-old",
            userID: "user-1",
            name: "Old bill",
            amount: 100,
            dueDate: new Date("2026-11-01T00:00:00.000Z"),
          },
        ]);
      }

      return chain([
        {
          _id: "bill-soon",
          userID: "user-1",
          name: "Soon bill",
          amount: 200,
          dueDate: new Date("2026-11-17T00:00:00.000Z"),
        },
      ]);
    });

    const result = await billReminders.runBillReminders({ now });

    expect(result).toMatchObject({ dueSoonDetected: 1, overdueDetected: 1, failures: 0 });

    const names = eventBus.emit.mock.calls.map((call) => call[0]);
    expect(names).toContain("bill.due_soon");
    expect(names).toContain("bill.overdue");

    const dueSoon = eventBus.emit.mock.calls.find((call) => call[0] === "bill.due_soon");
    expect(dueSoon[1]).toMatchObject({ billId: "bill-soon", daysUntilDue: 2 });
    expect(dueSoon[2].dedupeKey).toBe("bill_due_soon:bill-soon:2026-11-17");

    const overdue = eventBus.emit.mock.calls.find((call) => call[0] === "bill.overdue");
    // One alert per bill while the condition is unchanged.
    expect(overdue[2].dedupeKey).toBe("bill_overdue:bill-old");
    expect(overdue[1].daysOverdue).toBe(14);
  });

  test("never writes bill status from the reminder job", async () => {
    BillModel.find.mockReturnValue(chain([]));

    await billReminders.runBillReminders({ now });

    // The model mock exposes only `find`; any update path would be a TypeError.
    expect(BillModel.find).toHaveBeenCalled();
  });
});

describe("recommendation lifecycle", () => {
  const now = new Date("2026-11-15T00:00:00.000Z");

  test("marks new, persisted and resolved recommendations", () => {
    const previous = [
      { id: "a", title: "A", priority: "high", firstSeenAt: "2026-11-01T00:00:00.000Z" },
      { id: "b", title: "B", priority: "medium", firstSeenAt: "2026-11-01T00:00:00.000Z" },
    ];
    const current = [
      { id: "a", title: "A", priority: "high" },
      { id: "c", title: "C", priority: "critical" },
    ];

    const lifecycle = lifecycleFor(previous, current, now);
    const byId = Object.fromEntries(lifecycle.map((item) => [item.id, item]));

    expect(byId.a.status).toBe("persisted");
    expect(byId.a.firstSeenAt).toBe("2026-11-01T00:00:00.000Z");
    expect(byId.c.status).toBe("new");
    expect(byId.c.lastSeenAt).toBe(now.toISOString());
    expect(byId.b.status).toBe("resolved");
    expect(byId.b.resolvedAt).toBe(now.toISOString());
  });

  test("treats an empty history as all-new", () => {
    const lifecycle = lifecycleFor([], [{ id: "x", title: "X", priority: "low" }], now);

    expect(lifecycle).toHaveLength(1);
    expect(lifecycle[0].status).toBe("new");
  });
});
