const request = require("supertest");
const app = require("../app");
describe("Expense Routes Auth Protection", () => {
  test("GET /api/expenses should return 401 without token", async () => {
    const res = await request(app).get("/api/expenses");
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("Authentication required");
  });

  test("GET /api/expenses should return 401 with invalid token", async () => {
    const res = await request(app)
      .get("/api/expenses")
      .set("Authorization", "Bearer invalidtoken123");

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/Invalid|expired/i);
  });

  test("GET /api/expenses should return 401 with Basic authorization scheme", async () => {
    const res = await request(app)
      .get("/api/expenses")
      .set("Authorization", "Basic invalidtoken123");

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("GET /api/expenses should return 401 with malformed Bearer header", async () => {
    const res = await request(app)
      .get("/api/expenses")
      .set("Authorization", "Bearer");

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("GET /api/expenses should return 401 with Bearer header containing extra tokens", async () => {
    const res = await request(app)
      .get("/api/expenses")
      .set("Authorization", "Bearer token1 token2");

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

});
