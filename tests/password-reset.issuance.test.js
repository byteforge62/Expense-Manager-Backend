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

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const createUser = async (label) =>
  UserModel.create({
    name: `Issue ${label}`,
    email: `issue_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@mail.com`,
    password: await bcrypt.hash("Password123", 10),
    role: "User",
  });

const postForgot = (email) =>
  request(app)
    .post("/api/user/forgotpassword")
    .set("Origin", ORIGIN)
    .send({ email });

const postReset = (token, password = "Recovered123") =>
  request(app)
    .post("/api/user/resetpassword")
    .set("Origin", ORIGIN)
    .send({ token, password });

const lastToken = () => {
  const calls = mailer.sendPasswordResetEmail.mock.calls;
  const { resetUrl } = calls[calls.length - 1][0];
  return new URL(resetUrl).pathname.split("/").pop();
};

describe("password reset issuance", () => {
  beforeAll(async () => {
    // The unique `user` index is the guarantee under test; make sure it exists.
    await PasswordResetTokenModel.init();
  });

  beforeEach(() => {
    mailer.sendPasswordResetEmail.mockReset();
    mailer.sendPasswordResetEmail.mockResolvedValue({});
  });

  test("simultaneous requests leave exactly one live token", async () => {
    const user = await createUser("race");

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postForgot(user.email)),
    );
    responses.forEach((res) => expect(res.statusCode).toBe(200));

    const stored = await PasswordResetTokenModel.find({ user: user._id }).lean();
    expect(stored).toHaveLength(1);

    // Every request was answered, but only the surviving link can be redeemed.
    const issued = mailer.sendPasswordResetEmail.mock.calls.map(([args]) =>
      new URL(args.resetUrl).pathname.split("/").pop(),
    );
    expect(issued).toHaveLength(5);
    expect(
      issued.filter((raw) => sha256(raw) === stored[0].tokenHash),
    ).toHaveLength(1);
  });

  test("a failed delivery still leaves the account recoverable", async () => {
    const user = await createUser("recovery");

    mailer.sendPasswordResetEmail.mockRejectedValueOnce(new Error("SMTP down"));
    expect((await postForgot(user.email)).statusCode).toBe(200);
    const undeliveredToken = lastToken();

    await postForgot(user.email);
    const deliveredToken = lastToken();

    expect(undeliveredToken).not.toBe(deliveredToken);

    // The link the user never received is dead, and the new one works.
    expect((await postReset(undeliveredToken)).statusCode).toBe(400);
    expect((await postReset(deliveredToken)).statusCode).toBe(200);
  });
});
