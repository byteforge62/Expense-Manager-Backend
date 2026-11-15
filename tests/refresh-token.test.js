require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const UserModel = require("../src/models/UserModel");

/**
 * Error responses now always carry a correlation id in addition to the
 * pre-existing envelope, so these assertions match the documented fields and
 * separately verify that the correlation id is present and echoed in the
 * X-Request-Id header.
 */
const expectErrorEnvelope = (res, message) => {
  expect(res.statusCode).toBe(401);
  expect(res.body).toMatchObject({ success: false, message });
  expect(typeof res.body.requestId).toBe("string");
  expect(res.body.requestId.length).toBeGreaterThan(0);
  expect(res.headers["x-request-id"]).toBe(res.body.requestId);
};

describe("Refresh token validation", () => {
  test("rejects a missing refresh token", async () => {
    const res = await request(app).post("/api/user/refresh-token");

    expectErrorEnvelope(res, "Refresh token missing");
  });

  test("rejects an invalid refresh token", async () => {
    const res = await request(app)
      .post("/api/user/refresh-token")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", "refreshToken=not-a-valid-refresh-token");

    expectErrorEnvelope(res, "Invalid refresh token");
  });

  test("rejects an expired refresh token", async () => {
    const expiredToken = jwt.sign(
      { id: "507f1f77bcf86cd799439011" },
      process.env.REFRESH_SECRET,
      { expiresIn: -1 },
    );

    const res = await request(app)
      .post("/api/user/refresh-token")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", `refreshToken=${expiredToken}`);

    expectErrorEnvelope(res, "Invalid refresh token");
  });

  test("rejects refresh tokens for inactive users", async () => {
    const user = await UserModel.create({
      name: "Inactive Refresh User",
      email: `inactive_refresh_${Date.now()}@mail.com`,
      password: "unused-test-password",
      role: "User",
      is_active: false,
    });

    const token = jwt.sign(
      { id: user._id.toString() },
      process.env.REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    const res = await request(app)
      .post("/api/user/refresh-token")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", `refreshToken=${token}`);

    expectErrorEnvelope(res, "Invalid refresh token");
  });
});
