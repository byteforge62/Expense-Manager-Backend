const request = require("supertest");
const app = require("../app");

describe("GET /health", () => {
  it("should return status 200 and status ok", async () => {
    const res = await request(app).get("/health");

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("JSON request body size limit", () => {
  it("should reject JSON bodies larger than 100 KB", async () => {
    const oversizedPayload = {
      data: "x".repeat(110 * 1024),
    };

    const res = await request(app)
      .post("/api/user/login")
      .send(oversizedPayload);

    expect(res.statusCode).toBe(413);
  });
});
