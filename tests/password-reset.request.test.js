const crypto = require("crypto");
const bcrypt = require("bcrypt");
const request = require("supertest");

// The reset limiter is exercised in its own file; raise the budget here so the
// functional cases are not affected by how many requests they make.
process.env.PASSWORD_RESET_RATE_LIMIT = "100";

jest.mock("../src/infrastructure/email/mailer", () => ({
  isEmailConfigured: jest.fn(() => true),
  sendPasswordResetEmail: jest.fn(),
}));

const mailer = require("../src/infrastructure/email/mailer");
const app = require("../app");
const UserModel = require("../src/models/UserModel");
const PasswordResetTokenModel = require("../src/models/PasswordResetTokenModel");
const logger = require("../src/infrastructure/logger");
const { getClientBaseUrl } = require("../src/config/validateEnv");

jest.setTimeout(60000);

const ORIGIN = "http://localhost:5173";
const PASSWORD = "Password123";

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const createUser = async (label, overrides = {}) =>
  UserModel.create({
    name: `Reset ${label}`,
    email: `reset_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@mail.com`,
    password: await bcrypt.hash(PASSWORD, 10),
    role: "User",
    ...overrides,
  });

const postForgot = (email) =>
  request(app)
    .post("/api/user/forgotpassword")
    .set("Origin", ORIGIN)
    .send({ email });

const lastResetUrl = () => {
  const calls = mailer.sendPasswordResetEmail.mock.calls;
  return calls[calls.length - 1]?.[0]?.resetUrl;
};

const tokenFromUrl = (url) => new URL(url).pathname.split("/").pop();

describe("POST /api/user/forgotpassword", () => {
  beforeEach(() => {
    mailer.sendPasswordResetEmail.mockReset();
    mailer.sendPasswordResetEmail.mockResolvedValue({});
  });

  test("issues a single-use link for an existing account and answers generically", async () => {
    const user = await createUser("issue");

    const res = await postForgot(user.email);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/if an account exists/i);
    // No credential material in the response.
    expect(JSON.stringify(res.body)).not.toMatch(/reset-password/);
    // The shared envelope always includes data; here it is empty.
    expect(res.body.data).toBeNull();

    expect(mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(1);

    const resetUrl = lastResetUrl();
    expect(resetUrl.startsWith(`${getClientBaseUrl()}/reset-password/`)).toBe(true);

    const rawToken = tokenFromUrl(resetUrl);
    expect(rawToken.length).toBeGreaterThanOrEqual(43);

    const stored = await PasswordResetTokenModel.find({ user: user._id }).lean();
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(sha256(rawToken));
    expect(stored[0].usedAt).toBeNull();
    expect(stored[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    // Short-lived: 15-30 minutes by design.
    expect(stored[0].expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 31 * 60 * 1000,
    );
  });

  test("answers identically for an unknown address and sends nothing", async () => {
    const known = await createUser("known");
    const knownResponse = await postForgot(known.email);
    const unknownResponse = await postForgot(`ghost_${Date.now()}@mail.com`);

    expect(unknownResponse.statusCode).toBe(knownResponse.statusCode);
    expect(unknownResponse.body).toEqual(knownResponse.body);
    // Only the existing account produced an email.
    expect(mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  test("normalizes the email before lookup", async () => {
    const user = await createUser("normalize");

    const res = await postForgot(`  ${user.email.toUpperCase()}  `);

    expect(res.statusCode).toBe(200);
    expect(mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(
      await PasswordResetTokenModel.countDocuments({ user: user._id }),
    ).toBe(1);
  });

  test("never persists the raw token", async () => {
    const user = await createUser("hashonly");

    await postForgot(user.email);

    const rawToken = tokenFromUrl(lastResetUrl());
    const { tokenHash } = await PasswordResetTokenModel.findOne({
      user: user._id,
    }).lean();

    expect(tokenHash).not.toBe(rawToken);
    expect(tokenHash).toHaveLength(64);
    expect(await PasswordResetTokenModel.findOne({ tokenHash: rawToken })).toBeNull();
    expect(await PasswordResetTokenModel.findOne({ tokenHash: sha256(rawToken) })).not.toBeNull();

    // A database dump therefore contains no usable link.
    const everything = await PasswordResetTokenModel.find({}).lean();
    expect(everything.some((doc) => doc.tokenHash === rawToken)).toBe(false);
  });

  test("supersedes outstanding links when a new one is requested", async () => {
    const user = await createUser("supersede");

    await postForgot(user.email);
    const firstToken = tokenFromUrl(lastResetUrl());

    await postForgot(user.email);
    const secondToken = tokenFromUrl(lastResetUrl());

    const stored = await PasswordResetTokenModel.find({ user: user._id }).lean();

    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(sha256(secondToken));
    expect(stored[0].tokenHash).not.toBe(sha256(firstToken));
    expect(firstToken).not.toBe(secondToken);
  });

  test("rejects a malformed address without touching the mailer", async () => {
    const res = await postForgot("not-an-email");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Validation failed");
    expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test("handles a mail-provider failure without leaking internals", async () => {
    const user = await createUser("mailfail");
    mailer.sendPasswordResetEmail.mockRejectedValue(
      Object.assign(new Error("SMTP 550 mailbox unavailable"), { code: "EENVELOPE" }),
    );

    const res = await postForgot(user.email);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/if an account exists/i);
    expect(JSON.stringify(res.body)).not.toMatch(/SMTP|EENVELOPE|reset-password/i);

    // The record is written before the send is attempted, so a failed mail never
    // leaves a dangling link and never reports the account's existence.
    expect(
      await PasswordResetTokenModel.countDocuments({ user: user._id }),
    ).toBe(1);
  });

  test("logs a mail failure without any credential material", async () => {
    const user = await createUser("mailfaillog");
    mailer.sendPasswordResetEmail.mockRejectedValue(
      Object.assign(new Error("SMTP 550 rejected"), { code: "EENVELOPE" }),
    );

    const logSpy = jest.spyOn(logger, "error").mockImplementation(() => {});

    let entry;
    try {
      const res = await postForgot(user.email);
      expect(res.statusCode).toBe(200);
      // Read before restoring: mockRestore() clears the recorded calls.
      entry = logSpy.mock.calls.find(
        ([event]) => event === "password_reset.email_failed",
      );
    } finally {
      logSpy.mockRestore();
    }

    expect(entry).toBeDefined();

    const record = entry[1];
    expect(record).toMatchObject({
      stage: "delivery",
      errorName: "Error",
      errorCode: "EENVELOPE",
      userID: String(user._id),
    });

    const serialized = JSON.stringify(record);
    expect(serialized).not.toMatch(/reset-password/);
    expect(serialized).not.toMatch(user.email);
    expect(Object.values(record)).not.toContain(tokenFromUrl(lastResetUrl()));
  });
});
