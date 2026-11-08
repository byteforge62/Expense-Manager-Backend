const request = require("supertest");
const app = require("../app");

jest.setTimeout(30000);

const CategoryModel = require("../src/models/CategoryModel");
const ExpenseModel = require("../src/models/ExpenseModel");
const IncomeModel = require("../src/models/IncomeModel");
const BillModel = require("../src/models/BillModel");

const DAY_MS = 24 * 60 * 60 * 1000;

const buildAuthUser = async () => {
  const email = `finance_${Date.now()}_${Math.random().toString(16).slice(2)}@mail.com`;
  const payload = {
    name: "Intelligence User",
    email,
    password: "Password123",
  };

  const signupRes = await request(app).post("/api/user").send(payload);
  const userId = signupRes.body.user?._id || signupRes.body.data?._id;

  const loginRes = await request(app).post("/api/user/login").send({
    email: payload.email,
    password: payload.password,
  });

  return {
    userId,
    token: loginRes.body.data.token,
  };
};

describe("Financial Intelligence overview", () => {
  test("returns metrics, behaviour, anomalies and health scores for populated data", async () => {
    const { token, userId } = await buildAuthUser();
    const category = await CategoryModel.create({ name: "Dining", type: "expense" });

    await IncomeModel.create({
      userID: userId,
      amount: 3000,
      source: "Salary",
      date: new Date(Date.now() - 45 * DAY_MS),
    });

    await IncomeModel.create({
      userID: userId,
      amount: 3000,
      source: "Salary",
      date: new Date(Date.now() - 10 * DAY_MS),
    });

    await ExpenseModel.create({
      userID: userId,
      categoryID: category._id,
      amount: 320,
      date: new Date(Date.now() - 60 * DAY_MS),
    });

    await ExpenseModel.create({
      userID: userId,
      categoryID: category._id,
      amount: 410,
      date: new Date(Date.now() - 20 * DAY_MS),
    });

    await ExpenseModel.create({
      userID: userId,
      categoryID: category._id,
      amount: 480,
      date: new Date(Date.now() - 5 * DAY_MS),
    });

    await BillModel.create({
      userID: userId,
      name: "Rent",
      amount: 900,
      dueDate: new Date(Date.now() + 15 * DAY_MS),
      status: "pending",
    });

    const startDate = new Date(Date.now() - 120 * DAY_MS).toISOString();
    const endDate = new Date(Date.now()).toISOString();

    const res = await request(app)
      .get("/api/financial-intelligence/overview")
      .query({ startDate, endDate })
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.metrics.totals.income).toBeGreaterThan(0);
    expect(res.body.data.metrics.totals.expenses).toBeGreaterThan(0);
    expect(res.body.data.behavior.observations.length).toBeGreaterThan(0);
    expect(res.body.data.financialHealth.score).toBeGreaterThanOrEqual(0);
    expect(res.body.data.financialHealth.score).toBeLessThanOrEqual(100);
    expect(res.body.data.dataConfidence.level).toMatch(/low|medium|high/i);
    expect(res.body.data.recommendations).toEqual(expect.any(Array));
    expect(res.body.data.rules).toEqual(expect.any(Array));
    expect(res.body.data.rules).toHaveLength(6);
    expect(res.body.data.ruleSummary).toMatchObject({
      total: 6,
      triggered: expect.any(Number),
      notEvaluated: expect.any(Number),
    });
  });

  test("returns low-confidence output for an empty user dataset", async () => {
    const { token, userId } = await buildAuthUser();
    const startDate = new Date(Date.now() - 90 * DAY_MS).toISOString();
    const endDate = new Date(Date.now()).toISOString();

    const res = await request(app)
      .get("/api/financial-intelligence/overview")
      .query({ startDate, endDate })
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.dataConfidence.level).toBe("low");
    expect(res.body.data.metrics.totals.income).toBe(0);
    expect(res.body.data.metrics.totals.expenses).toBe(0);
    expect(res.body.data.anomalies).toEqual([]);
    expect(res.body.data.financialHealth.score).toBeNull();
    expect(res.body.data.financialHealth.label).toBe("Insufficient data");
    expect(res.body.data.recommendations).toEqual(expect.any(Array));
    expect(res.body.data.rules).toHaveLength(6);
    expect(res.body.data.ruleSummary.notEvaluated).toBeGreaterThan(0);
    expect(userId).toBeTruthy();
  });

  test("keeps user financial records isolated", async () => {
    const firstUser = await buildAuthUser();
    const secondUser = await buildAuthUser();
    const category = await CategoryModel.create({ name: "Groceries", type: "expense" });

    await ExpenseModel.create({
      userID: firstUser.userId,
      categoryID: category._id,
      amount: 600,
      date: new Date(Date.now() - 15 * DAY_MS),
    });

    await ExpenseModel.create({
      userID: secondUser.userId,
      categoryID: category._id,
      amount: 1200,
      date: new Date(Date.now() - 15 * DAY_MS),
    });

    const startDate = new Date(Date.now() - 120 * DAY_MS).toISOString();
    const endDate = new Date(Date.now()).toISOString();

    const firstRes = await request(app)
      .get("/api/financial-intelligence/overview")
      .query({ startDate, endDate })
      .set("Authorization", `Bearer ${firstUser.token}`);

    const secondRes = await request(app)
      .get("/api/financial-intelligence/overview")
      .query({ startDate, endDate })
      .set("Authorization", `Bearer ${secondUser.token}`);

    expect(firstRes.body.data.metrics.totals.expenses).toBe(600);
    expect(secondRes.body.data.metrics.totals.expenses).toBe(1200);
    expect(firstRes.body.data.metrics.totals.expenses).not.toBe(secondRes.body.data.metrics.totals.expenses);
  });

  test("rejects invalid date windows", async () => {
    const { token } = await buildAuthUser();
    const startDate = new Date(Date.now()).toISOString();
    const endDate = new Date(Date.now() - 20 * DAY_MS).toISOString();

    const res = await request(app)
      .get("/api/financial-intelligence/overview")
      .query({ startDate, endDate })
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Validation failed");
  });
});
