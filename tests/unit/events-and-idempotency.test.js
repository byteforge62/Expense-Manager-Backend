jest.mock("../../src/models/OutboxEventModel", () => ({
  create: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock("../../src/models/ProcessedEventModel", () => ({
  create: jest.fn(),
  deleteOne: jest.fn(),
}));

jest.mock("../../src/models/IdempotencyKeyModel", () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
}));

const OutboxEventModel = require("../../src/models/OutboxEventModel");
const ProcessedEventModel = require("../../src/models/ProcessedEventModel");
const IdempotencyKeyModel = require("../../src/models/IdempotencyKeyModel");
const eventBus = require("../../src/infrastructure/events/event-bus");
const { runOnce } = require("../../src/infrastructure/events/idempotent");
const idempotency = require("../../src/middleware/idempotency.middleware");

describe("event bus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eventBus.clearHandlers();
    OutboxEventModel.create.mockResolvedValue({ _id: "outbox-1", eventId: "evt-1" });
    OutboxEventModel.updateOne.mockResolvedValue({ acknowledged: true });
  });

  test("isolates a failing consumer from healthy ones", async () => {
    const healthy = jest.fn();
    eventBus.register("thing.happened", () => {
      throw new Error("boom");
    }, { id: "bad" });
    eventBus.register("thing.happened", healthy, { id: "good" });

    const result = await eventBus.dispatch("thing.happened", { userId: "u1" }, { eventId: "evt-1" });

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(result.handled).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].handlerId).toBe("bad");
  });

  test("publishes to the outbox then dispatches immediately", async () => {
    const handler = jest.fn();
    eventBus.register("expense.created", handler, { id: "h1" });

    const result = await eventBus.emit("expense.created", { userId: "u1" }, { requestId: "req-1" });

    expect(OutboxEventModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "expense.created", status: "pending" }),
    );
    expect(handler).toHaveBeenCalledWith({ userId: "u1" }, expect.objectContaining({ requestId: "req-1", eventId: "evt-1" }));
    expect(result).toMatchObject({ queued: true, dispatched: true });
    expect(OutboxEventModel.updateOne).toHaveBeenCalledWith(
      { _id: "outbox-1" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "dispatched" }) }),
    );
  });

  test("never throws when the outbox write fails", async () => {
    OutboxEventModel.create.mockRejectedValue(new Error("mongo down"));

    const result = await eventBus.emit("expense.created", { userId: "u1" });

    expect(result.queued).toBe(false);
    expect(result.error).toContain("mongo down");
  });

  test("suppresses duplicate dedupe keys as a success", async () => {
    const duplicate = Object.assign(new Error("dup"), { code: 11000 });
    OutboxEventModel.create.mockRejectedValue(duplicate);

    const result = await eventBus.emit("bill.overdue", { userId: "u1" }, { dedupeKey: "bill:1" });

    expect(result).toEqual({ queued: false, duplicate: true });
  });

  test("leaves a failed delivery queued for retry", async () => {
    eventBus.register("expense.created", () => {
      throw new Error("consumer down");
    }, { id: "failing" });

    const result = await eventBus.emit("expense.created", { userId: "u1" });

    expect(result.queued).toBe(true);
    expect(result.dispatched).toBe(false);
    expect(OutboxEventModel.updateOne).toHaveBeenCalledWith(
      { _id: "outbox-1" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "failed", attempts: 1 }),
      }),
    );
  });
});

describe("idempotent consumers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("runs the consumer once per event", async () => {
    const work = jest.fn().mockResolvedValue("done");
    ProcessedEventModel.create.mockResolvedValue({});

    const first = await runOnce("summary", "evt-1", work);

    expect(first).toBe("done");
    expect(work).toHaveBeenCalledTimes(1);

    ProcessedEventModel.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));

    const second = await runOnce("summary", "evt-1", work);

    expect(second).toEqual({ skipped: true, reason: "already_processed" });
    expect(work).toHaveBeenCalledTimes(1);
  });

  test("releases the ledger entry when the consumer fails", async () => {
    ProcessedEventModel.create.mockResolvedValue({});
    ProcessedEventModel.deleteOne.mockResolvedValue({});

    await expect(
      runOnce("summary", "evt-2", async () => {
        throw new Error("partial failure");
      }),
    ).rejects.toThrow("partial failure");

    expect(ProcessedEventModel.deleteOne).toHaveBeenCalledWith({
      eventId: "evt-2",
      consumer: "summary",
    });
  });

  test("runs without a ledger when no event id exists", async () => {
    const work = jest.fn().mockResolvedValue("ok");

    expect(await runOnce("summary", undefined, work)).toBe("ok");
    expect(ProcessedEventModel.create).not.toHaveBeenCalled();
  });
});

describe("idempotency middleware", () => {
  const buildRes = () => {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      req: { id: "req-1" },
      setHeader: jest.fn((key, value) => {
        res.headers[key] = value;
      }),
      status: jest.fn((code) => {
        res.statusCode = code;
        return res;
      }),
      json: jest.fn((body) => {
        res.body = body;
        return res;
      }),
      on: jest.fn(),
      writableEnded: false,
    };

    return res;
  };

  const buildReq = (overrides = {}) => ({
    method: "POST",
    baseUrl: "/api",
    path: "/expense",
    body: { amount: 10 },
    id: "req-1",
    user: { id: "user-1" },
    get: jest.fn(() => overrides.key),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    IdempotencyKeyModel.updateOne.mockResolvedValue({});
    IdempotencyKeyModel.deleteOne.mockResolvedValue({});
  });

  test("passes through without a key", async () => {
    const next = jest.fn();
    await idempotency()(buildReq(), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(IdempotencyKeyModel.findOne).not.toHaveBeenCalled();
  });

  test("rejects malformed keys", async () => {
    const res = buildRes();
    const next = jest.fn();

    await idempotency()(buildReq({ key: "short" }), res, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  const withStoredKey = (value) => {
    IdempotencyKeyModel.findOne.mockReturnValue({ lean: async () => value });
  };

  test("replays a completed response without re-running the handler", async () => {
    withStoredKey({
      status: "completed",
      statusCode: 201,
      requestHash: null,
      responseBody: { success: true, message: "cached", data: { _id: "e1" } },
    });

    const res = buildRes();
    const next = jest.fn();

    await idempotency()(buildReq({ key: "key-123456" }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ message: "cached" });
    expect(res.headers["Idempotency-Replayed"]).toBe("true");
  });

  test("rejects a concurrent duplicate", async () => {
    withStoredKey({ status: "in_progress" });

    const res = buildRes();
    const next = jest.fn();

    await idempotency()(buildReq({ key: "key-123456" }), res, next);

    expect(res.statusCode).toBe(409);
    expect(next).not.toHaveBeenCalled();
  });

  test("stores the response of a new request", async () => {
    withStoredKey(null);
    IdempotencyKeyModel.create.mockResolvedValue({});

    const req = buildReq({ key: "key-123456" });
    const res = buildRes();
    const next = jest.fn();

    await idempotency()(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(IdempotencyKeyModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ userID: "user-1", key: "key-123456", status: "in_progress" }),
    );

    res.status(201);
    res.json({ success: true, data: { _id: "e1" } });

    expect(IdempotencyKeyModel.updateOne).toHaveBeenCalledWith(
      { userID: "user-1", key: "key-123456" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "completed", statusCode: 201 }),
      }),
    );
  });
});
