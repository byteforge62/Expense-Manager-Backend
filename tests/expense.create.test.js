const request = require("supertest");
const app = require("../app");

const Category = require("../src/models/CategoryModel"); // adjust name if different

jest.setTimeout(20000);

describe("Create Expense Flow", () => {
  let token;
  let userId;
  let categoryId;

  const testUser = {
    name: "Expense Test User",
    email: `expense_${Date.now()}@mail.com`,
    password: "Password123",
  };

  beforeAll(async () => {
    // Signup user
    const signupRes = await request(app).post("/api/user").send(testUser);
    userId = signupRes.body.user?._id || signupRes.body.data?._id;

    // Login
    const loginRes = await request(app).post("/api/user/login").send({
      email: testUser.email,
      password: testUser.password,
    });
    token = loginRes.body.data.token;

    // Create category for expense
    const category = await Category.create({
      name: "Test Category",
      type: "expense",
    });

    categoryId = category._id;
  });

  test("Create expense with valid token", async () => {
    const expenseData = {
      userID: userId,
      categoryID: categoryId,
      amount: 500,
      date: new Date(),
      description: "Test expense",
    };

    const res = await request(app)
      .post("/api/expense")
      .set("Authorization", `Bearer ${token}`)
      .send(expenseData);

    expect(res.statusCode).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.amount).toBe(500);
  });

  test("Create expense without token should fail", async () => {
    const res = await request(app).post("/api/expense").send({ amount: 100 });

    expect(res.statusCode).toBe(401);
  });
});
