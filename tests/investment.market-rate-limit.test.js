const request = require("supertest");

// Set before the app is loaded: the limiter reads its budget at module scope.
// Each test file has its own module registry, so this suite also gets its own
// in-memory limiter store.
process.env.INVESTMENT_MARKET_RATE_LIMIT = "2";

const app = require("../app");

const market = require("../src/modules/investments/market-data.service");
const UserModel = require("../src/models/UserModel");

jest.setTimeout(30000);

/**
 * Market data is proxied to keyless public providers and cached in-process.
 * The quote and search routes share one per-user budget, so no single client
 * can fill the cache or spend the free upstream quota.
 *
 * The providers are stubbed: this suite is about the limiter, and every test
 * here would otherwise be an external network call.
 */
describe("Investment market data rate limiting", () => {
  let server;
  let token;
  let otherToken;
  let searchSpy;
  let quoteSpy;

  const createdUserIds = [];

  const register = async (label) => {
    const credentials = {
      name: label,
      email: `${label}_${Date.now()}@mail.com`,
      password: "Password123",
    };

    const signup = await request(server).post("/api/user").send(credentials);
    expect(signup.statusCode).toBe(201);
    createdUserIds.push(signup.body.data._id);

    const login = await request(server)
      .post("/api/user/login")
      .send({ email: credentials.email, password: credentials.password });

    expect(login.statusCode).toBe(200);
    return login.body.data.token;
  };

  const auth = (req, value = token) =>
    req.set("Authorization", `Bearer ${value}`);

  const search = (term, value) =>
    auth(
      request(server).get("/api/investments/market/search").query({ q: term }),
      value,
    );

  const quote = (value) =>
    auth(
      request(server)
        .get("/api/investments/market/quote")
        .query({ kind: "STOCK", symbol: "RELIANCE.NS" }),
      value,
    );

  beforeAll(async () => {
    searchSpy = jest.spyOn(market, "searchAssets").mockResolvedValue([
      {
        kind: "STOCK",
        symbol: "RELIANCE.NS",
        name: "Reliance Industries",
        exchange: "NSE",
        type: "Equity",
      },
    ]);

    quoteSpy = jest.spyOn(market, "quote").mockResolvedValue({
      kind: "STOCK",
      symbol: "RELIANCE.NS",
      name: "Reliance Industries",
      price: 1387.9,
      change: 8.7,
      changePercent: 0.63,
    });

    // A listening server, not `request(app)`: same pattern as the other
    // investment suites on this machine.
    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    token = await register("marketlimit");
    otherToken = await register("marketlimitother");
  }, 30000);

  afterAll(async () => {
    searchSpy.mockRestore();
    quoteSpy.mockRestore();

    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }

    await new Promise((resolve) => server.close(resolve));
  });

  test("allows the budget, then blocks with a 429", async () => {
    for (const term of ["reliance", "infosys"]) {
      const allowed = await search(term);

      expect(allowed.statusCode).toBe(200);
      expect(allowed.body.data).toHaveLength(1);
    }

    const blocked = await search("tata consultancy");

    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toMatchObject({
      success: false,
      message: "Too many market data requests. Wait a minute and try again.",
    });
    expect(blocked.headers["ratelimit-limit"]).toBe("2");

    // The blocked request never reached the provider.
    expect(searchSpy).toHaveBeenCalledTimes(2);
  });

  test("the quote route shares the same per-user budget", async () => {
    // This user's budget was exhausted by the previous test in this window.
    const blocked = await quote();

    expect(blocked.statusCode).toBe(429);
    expect(quoteSpy).not.toHaveBeenCalled();
  });

  test("gives another user their own budget", async () => {
    const allowed = await quote(otherToken);

    expect(allowed.statusCode).toBe(200);
    expect(allowed.body.data.symbol).toBe("RELIANCE.NS");
    expect(quoteSpy).toHaveBeenCalledTimes(1);

    // And that budget is a real limit, not an exemption.
    const second = await search("reliance", otherToken);
    expect(second.statusCode).toBe(200);

    const blocked = await quote(otherToken);
    expect(blocked.statusCode).toBe(429);
  });
});
