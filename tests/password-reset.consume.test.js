const crypto = require("crypto");
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
const PasswordResetTokenModel = require("../src/models/PasswordResetTokenModel");

jest.setTimeout(60000);

const ORIGIN = "http://localhost:5173";
const OLD_PASSWORD = "Password123";
const NEW_PASSWORD = "BrandNew456";
const INVALID_LINK_MESSAGE = /invalid or has expired/i;

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const createUser = async (label) =>
  UserModel.create({
    name: `Consume ${label}`,
    email: `consume_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@mail.com`,
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

describe("POST /api/user/resetpassword", () => {
  beforeEach(() => {
    mailer.sendPasswordResetEmail.mockReset();
    mailer.sendPasswordResetEmail.mockResolvedValue({});
  });

  test("rejects an unknown token", async () => {
    const res = await postReset("a".repeat(43));

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(INVALID_LINK_MESSAGE);
  });

  test("rejects an expired token", async () => {
    const user = await createUser("expired");
    const rawToken = crypto.randomBytes(32).toString("base64url");

    await PasswordResetTokenModel.create({
      user: user._id,
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await postReset(rawToken);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(INVALID_LINK_MESSAGE);

    // The password is untouched and the link is not silently reusable.
    const unchanged = await UserModel.findById(user._id);
    expect(await bcrypt.compare(OLD_PASSWORD, unchanged.password)).toBe(true);
  });

  test("rejects reuse of a consumed token", async () => {
    const user = await createUser("reuse");
    const rawToken = await requestLink(user.email);

    const first = await postReset(rawToken, NEW_PASSWORD);
    expect(first.statusCode).toBe(200);

    const second = await postReset(rawToken, "AnotherPass789");
    expect(second.statusCode).toBe(400);
    expect(second.body.message).toMatch(INVALID_LINK_MESSAGE);

    const user_ = await UserModel.findById(user._id);
    expect(await bcrypt.compare(NEW_PASSWORD, user_.password)).toBe(true);
  });

  test("updates the password, stores only a hash, and burns the link", async () => {
    const user = await createUser("success");
    const rawToken = await requestLink(user.email);

    const res = await postReset(rawToken);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Password reset successfully");
    // Nothing sensitive is echoed back.
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(rawToken));

    const updated = await UserModel.findById(user._id);
    expect(updated.password).not.toBe(NEW_PASSWORD);
    expect(updated.password.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare(NEW_PASSWORD, updated.password)).toBe(true);
    expect(await bcrypt.compare(OLD_PASSWORD, updated.password)).toBe(false);

    expect(
      await PasswordResetTokenModel.countDocuments({ user: user._id }),
    ).toBe(0);
  });

  test("enforces the shared password policy", async () => {
    const user = await createUser("policy");
    const rawToken = await requestLink(user.email);

    const res = await postReset(rawToken, "weakpass");

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Validation failed");

    const unchanged = await UserModel.findById(user._id);
    expect(await bcrypt.compare(OLD_PASSWORD, unchanged.password)).toBe(true);
  });
});
