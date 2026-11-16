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
    name: `Rollback ${label}`,
    email: `rollback_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@mail.com`,
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

describe("password reset rollback", () => {
  beforeEach(() => {
    mailer.sendPasswordResetEmail.mockReset();
    mailer.sendPasswordResetEmail.mockResolvedValue({});
  });

  test("rolls back the claim when the password write fails", async () => {
    const user = await createUser("updatefail");
    const rawToken = await requestLink(user.email);

    const original = UserModel.findByIdAndUpdate;
    UserModel.findByIdAndUpdate = () => {
      throw new Error("simulated password write failure");
    };

    try {
      const res = await postReset(rawToken);
      expect(res.statusCode).toBe(500);
      // The internal error never reaches the client.
      expect(JSON.stringify(res.body)).not.toMatch(/simulated/);
    } finally {
      UserModel.findByIdAndUpdate = original;
    }

    // The claim happened inside the transaction, so it rolled back with it.
    const record = await PasswordResetTokenModel.findOne({
      user: user._id,
    }).lean();
    expect(record.usedAt).toBeNull();

    const unchanged = await UserModel.findById(user._id);
    expect(await bcrypt.compare(OLD_PASSWORD, unchanged.password)).toBe(true);

    // The same link still completes the reset afterwards.
    expect((await postReset(rawToken)).statusCode).toBe(200);
    const updated = await UserModel.findById(user._id);
    expect(await bcrypt.compare(NEW_PASSWORD, updated.password)).toBe(true);
  });

  test("does not commit a partial reset when session invalidation fails", async () => {
    const user = await createUser("sessionfail");
    const agent = await loginAgent(user.email);
    const rawToken = await requestLink(user.email);

    const original = RefreshTokenModel.deleteMany;
    RefreshTokenModel.deleteMany = () => {
      throw new Error("simulated session revoke failure");
    };

    try {
      const res = await postReset(rawToken);
      expect(res.statusCode).toBe(500);
    } finally {
      RefreshTokenModel.deleteMany = original;
    }

    // Nothing was applied: password unchanged, link unconsumed, session alive.
    const unchanged = await UserModel.findById(user._id);
    expect(await bcrypt.compare(OLD_PASSWORD, unchanged.password)).toBe(true);
    expect(await bcrypt.compare(NEW_PASSWORD, unchanged.password)).toBe(false);

    const record = await PasswordResetTokenModel.findOne({
      user: user._id,
    }).lean();
    expect(record.usedAt).toBeNull();

    expect(await RefreshTokenModel.countDocuments({ user: user._id })).toBe(1);
    const refreshed = await agent
      .post("/api/user/refresh-token")
      .set("Origin", ORIGIN);
    expect(refreshed.statusCode).toBe(200);

    // With the failure removed, the same link finishes the job.
    expect((await postReset(rawToken)).statusCode).toBe(200);
    expect(await RefreshTokenModel.countDocuments({ user: user._id })).toBe(0);
  });
});
