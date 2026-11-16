require("dotenv").config({ quiet: true });

const request = require("supertest");
const app = require("../app");
const IncomeModel = require("../src/models/IncomeModel");

jest.setTimeout(60000);

const parseBuffer = (res, callback) => {
  const chunks = [];

  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};

const signupAndLogin = async (prefix) => {
  const user = {
    name: `${prefix} Report User`,
    email: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}@mail.com`,
    password: "Password123",
  };

  const signup = await request(app).post("/api/user").send(user);
  expect(signup.statusCode).toBe(201);

  const login = await request(app)
    .post("/api/user/login")
    .send({ email: user.email, password: user.password });

  expect(login.statusCode).toBe(200);

  return { token: login.body.data.token, userId: login.body.data.user._id };
};

describe("PDF report generation", () => {
  test("returns a JSON 404 - not a broken PDF - when the user has no data", async () => {
    const { token } = await signupAndLogin("report_empty");

    const res = await request(app)
      .get("/api/reports/me")
      .set("Authorization", `Bearer ${token}`);

    // The failure is reported before any PDF header is committed.
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.body).toMatchObject({ success: false });
    expect(String(res.body.message)).toMatch(/no financial data/i);
    expect(typeof res.body.requestId).toBe("string");
  });

  test("streams a PDF once the user has reportable data", async () => {
    const { token, userId } = await signupAndLogin("report_data");

    await IncomeModel.create({
      userID: userId,
      amount: 4200,
      source: "Report Test Salary",
    });

    const res = await request(app)
      .get("/api/reports/me")
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(parseBuffer);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toContain("financial-report.pdf");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
  });

  test("requires authentication", async () => {
    const res = await request(app).get("/api/reports/me");

    expect(res.statusCode).toBe(401);
  });
});
