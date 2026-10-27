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

  
  test("rejects an existing access token when the user is deactivated", async () => {
    const bcrypt = require("bcrypt");
    const UserModel = require("../src/models/UserModel");

    const email = `inactive_token_${Date.now()}@mail.com`;
    const password = "Password123";

    const user = await UserModel.create({
      name: "Inactive Token Test",
      email,
      password: await bcrypt.hash(password, 10),
      role: "User",
      is_active: true,
    });

    const jwt = require("jsonwebtoken");
    const token = jwt.sign(
      { id: user._id.toString(), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    user.is_active = false;
    await user.save();

    const res = await request(app)
      .get("/api/expenses/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(401);
  });


});
