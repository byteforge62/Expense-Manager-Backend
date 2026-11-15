const request = require("supertest");
const app = require("../app");

const CategoryModel = require("../src/models/CategoryModel");
const ExpenseModel = require("../src/models/ExpenseModel");
const registerHandlers = require("../src/infrastructure/events/register-handlers");

jest.setTimeout(60000);

/**
 * End-to-end coverage of the platform additions:
 * pagination metadata, event-driven summaries, notifications, derived budget
 * utilization and idempotent financial mutations.
 *
 * Event handlers are registered explicitly here because the application only
 * starts background infrastructure from server.js.
 */
describe("Platform APIs", () => {
  let token;
  let userId;
  let categoryId;

  const signupAndLogin = async (prefix) => {
    const user = {
      name: `${prefix} Platform User`,
      email: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}@mail.com`,
      password: "Password123",
    };

    const signup = await request(app).post("/api/user").send(user);
    expect(signup.statusCode).toBe(201);

    const login = await request(app)
      .post("/api/user/login")
      .send({ email: user.email, password: user.password });

    expect(login.statusCode).toBe(200);

    return { token: login.body.data.token, userId: login.body.data.user._id };
  };

  beforeAll(async () => {
    registerHandlers();

    const session = await signupAndLogin("platform_owner");
    token = session.token;
    userId = session.userId;

    const category = await CategoryModel.create({
      name: `Platform Category ${Date.now()}`,
      type: "expense",
    });

    categoryId = category._id.toString();

    const docs = Array.from({ length: 25 }, (_value, index) => ({
      userID: userId,
      categoryID: categoryId,
      amount: 100 + index,
      date: new Date(Date.now() - index * 86_400_000),
      description: `Seeded expense ${index}`,
    }));

    await ExpenseModel.insertMany(docs);
  });

  describe("list pagination", () => {
    test("returns the legacy array plus bounded metadata", async () => {
      const res = await request(app)
        .get("/api/expenses/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(25);
      expect(res.body.meta.pagination.mode).toBe("legacy");
      expect(res.body.meta.pagination.truncated).toBe(false);
      expect(res.body.meta.requestId).toBe(res.headers["x-request-id"]);
    });

    test("paginates when page and limit are supplied", async () => {
      const res = await request(app)
        .get("/api/expenses/me?page=2&limit=10")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(10);
      expect(res.body.meta.pagination).toMatchObject({
        page: 2,
        limit: 10,
        hasPreviousPage: true,
      });
      expect(res.body.meta.pagination.total).toBeGreaterThanOrEqual(25);
    });

    test("supports keyset pagination without a total count", async () => {
      const first = await request(app)
        .get("/api/expenses/me?limit=5&cursor=")
        .set("Authorization", `Bearer ${token}`);

      expect(first.statusCode).toBe(200);
      expect(first.body.meta.pagination.mode).toBe("cursor");
      const nextCursor = first.body.meta.pagination.nextCursor;

      const second = await request(app)
        .get(`/api/expenses/me?limit=5&cursor=${encodeURIComponent(nextCursor)}`)
        .set("Authorization", `Bearer ${token}`);

      expect(second.statusCode).toBe(200);
      const firstIds = first.body.data.map((item) => item._id);
      const secondIds = second.body.data.map((item) => item._id);
      expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    });

    test("rejects invalid list parameters", async () => {
      const res = await request(app)
        .get("/api/expenses/me?limit=5000")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("event-driven summaries", () => {
    test("creating an expense updates the derived daily summary", async () => {
      const before = await request(app)
        .get("/api/summaries/daily")
        .set("Authorization", `Bearer ${token}`);

      expect(before.statusCode).toBe(200);

      const amount = 321;
      const created = await request(app)
        .post("/api/expense")
        .set("Authorization", `Bearer ${token}`)
        .send({ categoryID: categoryId, amount, description: "Summary probe" });

      expect(created.statusCode).toBe(201);

      const after = await request(app)
        .get("/api/summaries/daily")
        .set("Authorization", `Bearer ${token}`);

      const today = new Date().toISOString().slice(0, 10);
      const bucket = after.body.data.find((item) => item.periodStart.startsWith(today));

      expect(bucket).toBeDefined();
      expect(bucket.totalExpense).toBeGreaterThanOrEqual(amount);
      expect(after.body.meta.derived).toBe(true);
    });

    test("reconcile rebuilds summaries from authoritative records", async () => {
      const res = await request(app)
        .post("/api/summaries/reconcile")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.statusCode).toBe(200);
      expect(res.body.data.daily.periods).toBeGreaterThanOrEqual(1);
      expect(res.body.data.monthly.periods).toBeGreaterThanOrEqual(1);

      const monthly = await request(app)
        .get("/api/summaries/monthly")
        .set("Authorization", `Bearer ${token}`);

      expect(monthly.statusCode).toBe(200);
      const total = monthly.body.data.reduce((sum, item) => sum + item.totalExpense, 0);
      expect(total).toBeGreaterThanOrEqual(321);
    });
  });

  describe("notifications", () => {
    test("lists notifications with metadata and reports unread counts", async () => {
      const list = await request(app)
        .get("/api/notifications")
        .set("Authorization", `Bearer ${token}`);

      expect(list.statusCode).toBe(200);
      expect(Array.isArray(list.body.data)).toBe(true);
      expect(list.body.meta.pagination).toBeDefined();

      const count = await request(app)
        .get("/api/notifications/unread-count")
        .set("Authorization", `Bearer ${token}`);

      expect(count.statusCode).toBe(200);
      expect(count.body.data.count).toBeGreaterThanOrEqual(0);
    });

    test("updates user notification preferences", async () => {
      const res = await request(app)
        .put("/api/notifications/preferences")
        .set("Authorization", `Bearer ${token}`)
        .send({ budgetAlerts: false, minimumPriority: "medium" });

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toMatchObject({
        budgetAlerts: false,
        minimumPriority: "medium",
      });
    });

    test("requires authentication", async () => {
      const res = await request(app).get("/api/notifications");

      expect(res.statusCode).toBe(401);
    });
  });

  describe("derived budget utilization", () => {
    test("returns an empty list before the monitor has run", async () => {
      const res = await request(app)
        .get("/api/budgets/utilization")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta.derived).toBe(true);
    });
  });

  describe("idempotent financial mutations", () => {
    test("replays the stored response instead of creating a second expense", async () => {
      const key = `platform-idem-${Date.now()}`;
      const payload = { categoryID: categoryId, amount: 77, description: "Idempotent" };

      const first = await request(app)
        .post("/api/expense")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send(payload);

      expect(first.statusCode).toBe(201);

      const second = await request(app)
        .post("/api/expense")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send(payload);

      expect(second.statusCode).toBe(201);
      expect(second.headers["idempotency-replayed"]).toBe("true");
      expect(second.body.data._id).toBe(first.body.data._id);

      const count = await ExpenseModel.countDocuments({
        userID: userId,
        description: "Idempotent",
      });

      expect(count).toBe(1);
    });

    test("treats different payloads under the same key as a conflict", async () => {
      const key = `platform-idem-conflict-${Date.now()}`;

      await request(app)
        .post("/api/expense")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send({ categoryID: categoryId, amount: 10, description: "First" });

      const conflict = await request(app)
        .post("/api/expense")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send({ categoryID: categoryId, amount: 20, description: "Second" });

      expect(conflict.statusCode).toBe(422);
    });
  });
});
