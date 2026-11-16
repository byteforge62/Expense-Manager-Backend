const request = require("supertest");

// Set before the app is loaded: the limiter reads it at module scope. Each test
// file gets its own module registry, hence its own in-memory limiter store.
process.env.PASSWORD_RESET_RATE_LIMIT = "3";

const app = require("../app");

jest.setTimeout(60000);

const ORIGIN = "http://localhost:5173";

const postForgot = (index) =>
  request(app)
    .post("/api/user/forgotpassword")
    .set("Origin", ORIGIN)
    .send({ email: `rate_${index}_${Date.now()}@mail.com` });

describe("password reset rate limiting", () => {
  test("blocks requests beyond the configured budget", async () => {
    for (let index = 0; index < 3; index += 1) {
      const allowed = await postForgot(index);
      expect(allowed.statusCode).toBe(200);
    }

    const blocked = await postForgot(3);

    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toMatchObject({
      success: false,
      message: "Too many password reset attempts. Please try again later.",
    });
    expect(blocked.headers["ratelimit-limit"]).toBe("3");
  });

  test("applies to the reset endpoint as well", async () => {
    // Budget is already exhausted by the previous test within this window.
    const res = await request(app)
      .post("/api/user/resetpassword")
      .set("Origin", ORIGIN)
      .send({ token: "c".repeat(43), password: "Password123" });

    expect(res.statusCode).toBe(429);
  });
});
