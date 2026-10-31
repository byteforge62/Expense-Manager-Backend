const express = require("express");
const cookieParser = require("cookie-parser");
const request = require("supertest");
const createCsrfProtection = require("../src/middleware/csrf.middleware");

describe("CSRF protection", () => {
  const allowedOrigins = ["http://localhost:5173"];

  const app = express();

  app.use(cookieParser());
  app.use("/api", createCsrfProtection(allowedOrigins));

  app.post("/api/test", (req, res) => {
    res.status(200).json({ success: true });
  });

  app.get("/api/test", (req, res) => {
    res.status(200).json({ success: true });
  });

  test("allows cookie-authenticated requests from trusted origins", async () => {
    const res = await request(app)
      .post("/api/test")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", "accessToken=test-token");

    expect(res.statusCode).toBe(200);
  });

  test("rejects cookie-authenticated requests from untrusted origins", async () => {
    const res = await request(app)
      .post("/api/test")
      .set("Origin", "https://evil.example")
      .set("Cookie", "accessToken=test-token");

    expect(res.statusCode).toBe(403);
  });

  test("rejects cookie-authenticated requests without an origin", async () => {
    const res = await request(app)
      .post("/api/test")
      .set("Cookie", "accessToken=test-token");

    expect(res.statusCode).toBe(403);
  });

  test("allows safe GET requests without an origin", async () => {
    const res = await request(app)
      .get("/api/test")
      .set("Cookie", "accessToken=test-token");

    expect(res.statusCode).toBe(200);
  });

  test("allows Bearer-only requests without authentication cookies", async () => {
    const res = await request(app)
      .post("/api/test")
      .set("Authorization", "Bearer test-token");

    expect(res.statusCode).toBe(200);
  });
});
