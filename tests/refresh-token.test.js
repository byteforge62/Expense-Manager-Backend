
const request = require("supertest");
const app = require("../app");

describe("Refresh token validation", () => {
  test("rejects a missing refresh token", async () => {
    const res = await request(app).post("/api/user/refresh-token");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: "Refresh token missing",
    });
  });

  test("rejects an invalid refresh token", async () => {
    const res = await request(app)
      .post("/api/user/refresh-token")
      .set("Cookie", "refreshToken=not-a-valid-refresh-token");

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: "Invalid refresh token",
    });
  });
});
