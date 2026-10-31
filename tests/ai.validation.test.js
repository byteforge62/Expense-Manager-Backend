const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const UserModel = require("../src/models/UserModel");

jest.setTimeout(30000);

describe("AI request validation", () => {
  let token;

  beforeAll(async () => {
    const user = await UserModel.create({
      name: "AI Validation Test",
      email: `ai_validation_${Date.now()}@mail.com`,
      password: "test-only-password",
      role: "User",
      is_active: true,
    });

    token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
  });

  const sendRequest = (body) =>
    request(app)
      .post("/api/ai/ask")
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  test("Rejects an empty message", async () => {
    const response = await sendRequest({ message: "" });
    expect(response.statusCode).toBe(400);
  });

  test("Rejects whitespace-only messages", async () => {
    const response = await sendRequest({ message: "    " });
    expect(response.statusCode).toBe(400);
  });

  test("Rejects a missing message", async () => {
    const response = await sendRequest({});
    expect(response.statusCode).toBe(400);
  });

  test("Rejects a non-string message", async () => {
    const response = await sendRequest({ message: 123 });
    expect(response.statusCode).toBe(400);
  });

  test("Rejects messages exceeding 3000 characters", async () => {
    const response = await sendRequest({
      message: "a".repeat(3001),
    });

    expect(response.statusCode).toBe(400);
  });

  test("Rejects unexpected request properties", async () => {
    const response = await sendRequest({
      message: "Analyze my expenses",
      userId: "507f1f77bcf86cd799439011",
    });

    expect(response.statusCode).toBe(400);
  });

  test("Rejects requests without authentication", async () => {
    const response = await request(app)
      .post("/api/ai/ask")
      .send({ message: "Hello" });

    expect(response.statusCode).toBe(401);
  });

  test("Rejects a request without a JSON object", async () => {
    const response = await sendRequest(null);
    expect(response.statusCode).toBe(400);
  });
});
