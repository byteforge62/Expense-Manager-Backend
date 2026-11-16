const bcrypt = require("bcrypt");
const request = require("supertest");

process.env.PASSWORD_RESET_RATE_LIMIT = "100";

jest.mock("../src/infrastructure/email/mailer", () => ({
  isEmailConfigured: jest.fn(() => true),
  sendPasswordResetEmail: jest.fn(),
}));

const mailer = require("../src/infrastructure/email/mailer");
const app = require("../app");
const UserModel = require("../src/models/UserModel");
const RefreshTokenModel = require("../src/models/RefreshTokenModel");
const PasswordResetTokenModel = require("../src/models/PasswordResetTokenModel");

jest.setTimeout(60000);

const ORIGIN = "http://localhost:5173";
const OLD_PASSWORD = "Password123";
const NEW_PASSWORD = "BrandNew456";

const createUser = async (label) =>
  UserModel.create({
    name: `Session ${label}`,
    email: `session_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@mail.com`,
    password: await bcrypt.hash(OLD_PASSWORD, 10),
    role: "User",
  });

const requestLink = async (email) => {
  const res = await request(app)
    .post("/api/user/forgotpassword")
    .set("Origin", ORIGIN)
    .send({ email });

  expect(res.statusCode).toBe(200);

  const { resetUrl } = mailer.sendPasswordResetEmail.mock.calls.at(-1)[0];
  return new URL(resetUrl).pathname.split("/").pop();
};

const postReset = (token, password = NEW_PASSWORD) =>
  request(app)
    .post("/api/user/resetpassword")
    .set("Origin", ORIGIN)
    .send({ token, password });

const loginAgent = async (email) => {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/user/login")
    .set("Origin", ORIGIN)
    .send({ email, password: OLD_PASSWORD });

  expect(res.statusCode).toBe(200);
  return agent;
};

describe("password reset and existing sessions", () => {
  beforeEach(() => {
    mailer.sendPasswordResetEmail.mockReset();
    mailer.sendPasswordResetEmail.mockResolvedValue({});
  });

  test("invalidates existing refresh sessions after a successful reset", async () => {
    const user = await createUser("revoked");
    const agent = await loginAgent(user.email);

    expect(await RefreshTokenModel.countDocuments({ user: user._id })).toBe(1);

    const rawToken = await requestLink(user.email);
    expect((await postReset(rawToken)).statusCode).toBe(200);

    expect(await RefreshTokenModel.countDocuments({ user: user._id })).toBe(0);

    const refreshed = await agent
      .post("/api/user/refresh-token")
      .set("Origin", ORIGIN);
    expect(refreshed.statusCode).toBe(401);
  });

  test("leaves sessions valid when the reset fails", async () => {
    const user = await createUser("kept");
    const agent = await loginAgent(user.email);

    const failed = await postReset("b".repeat(43));
    expect(failed.statusCode).toBe(400);

    expect(await RefreshTokenModel.countDocuments({ user: user._id })).toBe(1);

    const refreshed = await agent
      .post("/api/user/refresh-token")
      .set("Origin", ORIGIN);
    expect(refreshed.statusCode).toBe(200);
  });

  test("concurrent attempts with the same token cannot both succeed", async () => {
    const user = await createUser("race");
    const rawToken = await requestLink(user.email);

    const [first, second] = await Promise.all([
      postReset(rawToken, "RacerPass111"),
      postReset(rawToken, "RacerPass222"),
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 400]);

    const winner = first.statusCode === 200 ? "RacerPass111" : "RacerPass222";
    const loser = first.statusCode === 200 ? "RacerPass222" : "RacerPass111";

    const updated = await UserModel.findById(user._id);
    expect(await bcrypt.compare(winner, updated.password)).toBe(true);
    expect(await bcrypt.compare(loser, updated.password)).toBe(false);
    expect(
      await PasswordResetTokenModel.countDocuments({ user: user._id }),
    ).toBe(0);
  });
});
