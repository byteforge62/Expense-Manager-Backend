require("dotenv").config({ quiet: true });

const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const realtimeRoutes = require("../src/modules/realtime/realtime.routes");

jest.setTimeout(60000);

const {
  signStreamToken,
  verifyStreamToken,
  STREAM_TOKEN_TTL_SECONDS,
} = realtimeRoutes;

const signupAndLogin = async (prefix) => {
  const user = {
    name: `${prefix} Stream User`,
    email: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}@mail.com`,
    password: "Password123",
  };

  const signup = await request(app).post("/api/user").send(user);
  expect(signup.statusCode).toBe(201);

  const login = await request(app)
    .post("/api/user/login")
    .send({ email: user.email, password: user.password });

  expect(login.statusCode).toBe(200);

  return { accessToken: login.body.data.token, userId: login.body.data.user._id };
};

describe("realtime stream tokens", () => {
  test("keeps the stream token lifetime short", () => {
    expect(STREAM_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(60);
  });

  test("verifies a token it issued", () => {
    const decoded = verifyStreamToken(signStreamToken("507f1f77bcf86cd799439011"));

    expect(decoded.sub).toBe("507f1f77bcf86cd799439011");
    expect(decoded.typ).toBe("realtime_stream");
    expect(decoded.aud).toBe("realtime");
  });

  test("rejects an API access token signed with the JWT secret", () => {
    const accessToken = jwt.sign(
      { id: "507f1f77bcf86cd799439011" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    expect(() => verifyStreamToken(accessToken)).toThrow();
  });

  test("rejects a token that claims the stream audience but was not signed for it", () => {
    const forged = jwt.sign(
      { sub: "507f1f77bcf86cd799439011", typ: "realtime_stream", scope: "realtime" },
      process.env.JWT_SECRET,
      { audience: "realtime", expiresIn: "1h" },
    );

    expect(() => verifyStreamToken(forged)).toThrow();
  });

  test("an issued stream token cannot be used as an API access token", async () => {
    const { userId } = await signupAndLogin("stream_confusion");
    const streamToken = signStreamToken(userId);

    const res = await request(app)
      .get("/api/expenses/me")
      .set("Authorization", `Bearer ${streamToken}`);

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("an API access token cannot open the SSE stream", async () => {
    const { accessToken } = await signupAndLogin("stream_api_token");

    const res = await request(app)
      .get("/api/realtime/stream")
      .query({ token: accessToken });

    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.success).toBe(false);
  });

  test("mints a scoped token through the authenticated endpoint", async () => {
    const { accessToken, userId } = await signupAndLogin("stream_mint");

    const issued = await request(app)
      .post("/api/realtime/token")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(issued.statusCode).toBe(200);
    expect(issued.body.data.expiresIn).toBe(STREAM_TOKEN_TTL_SECONDS);

    const decoded = verifyStreamToken(issued.body.data.token);

    expect(decoded.sub).toBe(String(userId));
  });
});
