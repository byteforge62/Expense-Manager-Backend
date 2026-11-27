const request = require("supertest");
const mongoose = require("mongoose");

const app = require("../app");

const InvestmentModel = require("../src/modules/investments/models/InvestmentModel");
const InvestmentTransactionModel = require("../src/modules/investments/models/InvestmentTransactionModel");
const UserModel = require("../src/models/UserModel");

jest.setTimeout(30000);

/**
 * Investment API surface: authentication, the goal-plan contract, the market
 * quote/search query contracts, and ownership of a holding. Valuation itself
 * is covered by the service tests; these tests never reach the market provider
 * because every upstream call here would be an unsafe external dependency.
 */
describe("Investment API", () => {
  let server;
  let token;
  let otherToken;
  let holdingId;
  let saleId;

  const createdUserIds = [];

  const owner = {
    name: "Portfolio Owner",
    email: `investor_${Date.now()}@mail.com`,
    password: "Password123",
  };

  const otherInvestor = {
    name: "Other Investor",
    email: `investor_other_${Date.now()}@mail.com`,
    password: "Password123",
  };

  const auth = (req, value = token) =>
    req.set("Authorization", `Bearer ${value}`);

  const registerAndLogin = async (credentials) => {
    const signup = await request(server).post("/api/user").send(credentials);
    expect(signup.statusCode).toBe(201);
    createdUserIds.push(signup.body.data._id);

    const login = await request(server)
      .post("/api/user/login")
      .send({ email: credentials.email, password: credentials.password });

    expect(login.statusCode).toBe(200);
    return login.body.data.token;
  };

  beforeAll(async () => {
    // Supertest is given a listening server instead of the Express app so the
    // request URL never depends on its implicit `listen(0)` completing first.
    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    token = await registerAndLogin(owner);
    otherToken = await registerAndLogin(otherInvestor);
  }, 30000);

  afterAll(async () => {
    await InvestmentTransactionModel.deleteMany({
      userID: { $in: createdUserIds },
    });

    await InvestmentModel.deleteMany({
      userID: { $in: createdUserIds },
    });

    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }

    await new Promise((resolve) => server.close(resolve));
  });

  describe("Authentication", () => {
    test.each([
      ["portfolio", "get", "/api/investments"],
      ["plan", "post", "/api/investments/plan"],
      [
        "quote",
        "get",
        "/api/investments/market/quote?kind=STOCK&symbol=RELIANCE.NS",
      ],
      ["search", "get", "/api/investments/market/search?q=reliance"],
      ["holding creation", "post", "/api/investments"],
    ])("requires a token for %s", async (_, method, path) => {
      const response = await request(server)[method](path);

      // Auth runs before validation, so even a body-less POST is a 401 rather
      // than a 400 from the schema.
      expect(response.statusCode).toBe(401);
    });
  });

  describe("Goal plan", () => {
    test("builds a plan from the user's recorded cash flow", async () => {
      const response = await auth(
        request(server).post("/api/investments/plan"),
      ).send({ targetAmount: 1000000, years: 10, expectedReturn: 12 });

      expect(response.statusCode).toBe(200);

      const { snapshot, goal, allocation, portfolio, recommendations } =
        response.body.data;

      // This user has no income or expense rows yet, so the plan must not
      // invent a surplus or recommend investing money that is not there.
      expect(snapshot.monthlySurplus).toBe(0);
      expect(snapshot.savingsRate).toBeNull();
      expect(goal.requiredMonthly).toBeCloseTo(4347, 0);
      expect(goal.contributionCap).toBe(0);
      expect(goal.feasible).toBe(false);
      expect(goal.suggestedMonthly).toBe(0);

      expect(allocation.map((row) => row.share)).toEqual([70, 20, 10]);
      expect(portfolio.holdingCount).toBe(0);
      expect(recommendations[0]).toMatch(/Add your income records/);
    });

    test.each([
      ["no target", { years: 10 }],
      ["a zero-year horizon", { targetAmount: 100000, years: 0 }],
      ["a horizon beyond 50 years", { targetAmount: 100000, years: 51 }],
      [
        "a return above 30%",
        { targetAmount: 100000, years: 10, expectedReturn: 31 },
      ],
      [
        "a negative existing contribution",
        { targetAmount: 100000, years: 10, existingMonthly: -1 },
      ],
      [
        "an unknown field",
        { targetAmount: 100000, years: 10, riskProfile: "aggressive" },
      ],
    ])("rejects a plan with %s", async (_, payload) => {
      const response = await auth(
        request(server).post("/api/investments/plan"),
      ).send(payload);

      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe("Validation failed");
      expect(response.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe("Quote and search validation", () => {
    test.each([
      ["no symbol", { kind: "STOCK" }],
      ["an unsupported kind", { kind: "CRYPTO", symbol: "BTC-USD" }],
      ["a blank symbol", { kind: "STOCK", symbol: "   " }],
      [
        "a path traversal attempt",
        { kind: "STOCK", symbol: "../../etc/passwd" },
      ],
      ["a space in a symbol", { kind: "STOCK", symbol: "RELIANCE NS" }],
      ["markup in a symbol", { kind: "STOCK", symbol: "<script>" }],
      ["a malformed fund code", { kind: "FUND", symbol: "abc/123" }],
      ["a US listing", { kind: "STOCK", symbol: "AAPL" }],
      ["a US index", { kind: "STOCK", symbol: "^GSPC" }],
      ["a fund ticker", { kind: "FUND", symbol: "VFIAX" }],
    ])("rejects a quote query with %s", async (_, query) => {
      const response = await auth(
        request(server).get("/api/investments/market/quote").query(query),
      );

      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe("Validation failed");
      expect(
        response.body.errors.every((error) =>
          error.field.startsWith("query."),
        ),
      ).toBe(true);
    });

    test("rejects a search term shorter than two characters", async () => {
      const response = await auth(
        request(server).get("/api/investments/market/search").query({ q: "a" }),
      );

      expect(response.statusCode).toBe(400);
      expect(response.body.errors[0].field).toBe("query.q");
    });

    test("rejects a search with no term", async () => {
      const response = await auth(
        request(server).get("/api/investments/market/search"),
      );

      expect(response.statusCode).toBe(400);
      expect(response.body.errors[0].field).toBe("query.q");
    });

    test.each([
      ["a path separator", "../../etc"],
      ["a percent escape", "reliance%20ns"],
      ["markup", "<script>"],
      ["a quote", 'reliance"'],
    ])("rejects a search term with %s", async (_, term) => {
      const response = await auth(
        request(server).get("/api/investments/market/search").query({ q: term }),
      );

      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe("Validation failed");
      expect(response.body.errors[0].field).toBe("query.q");
    });
  });

  describe("Holding ownership", () => {
    test("records a holding for the authenticated user", async () => {
      const response = await auth(request(server).post("/api/investments")).send({
        kind: "STOCK",
        symbol: "reliance.ns",
        name: "Reliance Industries",
        units: 10,
        avgCost: 1300,
        investedAt: "2024-01-01",
      });

      expect(response.statusCode).toBe(201);
      expect(response.body.data.symbol).toBe("RELIANCE.NS");
      expect(response.body.data.units).toBe(10);

      holdingId = response.body.data._id;
    });

    test("refuses a holding quoted in another currency", async () => {
      const response = await auth(request(server).post("/api/investments")).send({
        kind: "STOCK",
        symbol: "AAPL",
        name: "Apple Inc",
        units: 1,
        avgCost: 100,
      });

      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe("Validation failed");
      expect(response.body.errors[0].field).toBe("body.symbol");
    });

    test("another user cannot update the holding", async () => {
      const response = await auth(
        request(server).put(`/api/investments/${holdingId}`),
        otherToken,
      ).send({ units: 99 });

      expect(response.statusCode).toBe(403);

      const stored = await InvestmentModel.findById(holdingId).lean();
      expect(stored.units).toBe(10);
    });

    test("another user cannot delete the holding", async () => {
      const response = await auth(
        request(server).delete(`/api/investments/${holdingId}`),
        otherToken,
      );

      expect(response.statusCode).toBe(403);
      expect(await InvestmentModel.findById(holdingId)).not.toBeNull();
    });

    test("another user's portfolio does not include the holding", async () => {
      const response = await auth(
        request(server).get("/api/investments"),
        otherToken,
      );

      expect(response.statusCode).toBe(200);
      expect(response.body.data.holdings).toEqual([]);
      expect(response.body.data.totals.holdingCount).toBe(0);
    });

    test("rejects a malformed holding id", async () => {
      const response = await auth(
        request(server).delete("/api/investments/not-an-object-id"),
      );

      expect(response.statusCode).toBe(400);
    });

    test("returns 404 for a holding that does not exist", async () => {
      const response = await auth(
        request(server).delete(
          `/api/investments/${new mongoose.Types.ObjectId()}`,
        ),
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe("Transaction ledger", () => {
    const anyId = new mongoose.Types.ObjectId().toString();

    test.each([
      ["the ledger", "get", `/api/investments/${anyId}/transactions`],
      ["a new trade", "post", `/api/investments/${anyId}/transactions`],
      [
        "a removal",
        "delete",
        `/api/investments/${anyId}/transactions/${anyId}`,
      ],
    ])("requires a token for %s", async (_, method, path) => {
      const response = await request(server)[method](path);

      expect(response.statusCode).toBe(401);
    });

    test.each([
      ["an unknown direction", { type: "TRANSFER", units: 1, price: 10 }],
      ["zero units", { type: "BUY", units: 0, price: 10 }],
      ["a negative price", { type: "BUY", units: 1, price: -1 }],
      [
        "an unknown field",
        { type: "BUY", units: 1, price: 10, broker: "zerodha" },
      ],
    ])("rejects a trade with %s", async (_, payload) => {
      const response = await auth(
        request(server).post(`/api/investments/${holdingId}/transactions`),
      ).send(payload);

      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe("Validation failed");
      expect(
        response.body.errors.every((error) => error.field.startsWith("body.")),
      ).toBe(true);
    });

    test("another user cannot add a trade to the holding", async () => {
      const response = await auth(
        request(server).post(`/api/investments/${holdingId}/transactions`),
        otherToken,
      ).send({ type: "BUY", units: 1, price: 100 });

      expect(response.statusCode).toBe(403);
    });

    test("another user cannot read the ledger", async () => {
      const response = await auth(
        request(server).get(`/api/investments/${holdingId}/transactions`),
        otherToken,
      );

      expect(response.statusCode).toBe(403);
    });

    test("records a buy and derives the holding from its trades", async () => {
      const response = await auth(
        request(server).post(`/api/investments/${holdingId}/transactions`),
      ).send({
        type: "BUY",
        units: 10,
        price: 200,
        tradedAt: "2024-02-01",
      });

      expect(response.statusCode).toBe(201);

      // 13,000 + 2,000 for 20 units.
      expect(response.body.data.ledger).toMatchObject({
        units: 20,
        avgCost: 750,
        costBasis: 15000,
        realizedGain: 0,
        transactionCount: 2,
      });
      expect(response.body.data.holding.units).toBe(20);
      expect(response.body.data.holding.avgCost).toBe(750);
    });

    test("returns the dated history oldest first", async () => {
      const response = await auth(
        request(server).get(`/api/investments/${holdingId}/transactions`),
      );

      expect(response.statusCode).toBe(200);

      const { ledger, transactions } = response.body.data;

      expect(transactions).toHaveLength(2);
      expect(transactions[0]).toMatchObject({
        type: "BUY",
        units: 10,
        price: 1300,
        notes: "Opening balance",
      });
      expect(transactions[1]).toMatchObject({ type: "BUY", units: 10, price: 200 });
      expect(ledger).toMatchObject({
        units: 20,
        avgCost: 750,
        untracked: false,
      });
    });

    test("realizes gain on a sale", async () => {
      const response = await auth(
        request(server).post(`/api/investments/${holdingId}/transactions`),
      ).send({
        type: "SELL",
        units: 5,
        price: 900,
        tradedAt: "2024-03-01",
      });

      expect(response.statusCode).toBe(201);
      expect(response.body.data.ledger).toMatchObject({
        units: 15,
        avgCost: 750,
        costBasis: 11250,
        realizedGain: 750,
        sellProceeds: 4500,
      });

      saleId = response.body.data.transaction._id;
    });

    test("rejects a sale larger than the position with the units held", async () => {
      const response = await auth(
        request(server).post(`/api/investments/${holdingId}/transactions`),
      ).send({ type: "SELL", units: 100, price: 900 });

      expect(response.statusCode).toBe(400);
      expect(response.body.message).toMatch(/cannot sell 100 units/);

      const stored = await InvestmentModel.findById(holdingId).lean();
      expect(stored.units).toBe(15);
    });

    test("removing a sale restores the position", async () => {
      const response = await auth(
        request(server).delete(
          `/api/investments/${holdingId}/transactions/${saleId}`,
        ),
      );

      expect(response.statusCode).toBe(200);
      expect(response.body.data.ledger).toMatchObject({
        units: 20,
        realizedGain: 0,
        transactionCount: 2,
      });
      expect(response.body.data.holding.units).toBe(20);
    });

    test("returns 404 for a transaction that does not exist", async () => {
      const response = await auth(
        request(server).delete(
          `/api/investments/${holdingId}/transactions/${new mongoose.Types.ObjectId()}`,
        ),
      );

      expect(response.statusCode).toBe(404);
    });
  });
});
