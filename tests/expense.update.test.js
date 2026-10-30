
const request = require("supertest");
const app = require("../app");
const Category = require("../src/models/CategoryModel");
const Expense = require("../src/models/ExpenseModel");

jest.setTimeout(20000);

describe("Update Expense Authorization", () => {
  let ownerToken;
  let otherUserToken;
  let expenseId;
  let categoryId;

  const owner = {
    name: "Update Owner",
    email: `update_owner_${Date.now()}@mail.com`,
    password: "Password123"
  };

  const otherUser = {
    name: "Update Other User",
    email: `update_other_${Date.now()}@mail.com`,
    password: "Password123"
  };

  const registerAndLogin = async (user) => {
    const signupRes = await request(app)
      .post("/api/user")
      .send(user);

    expect(signupRes.statusCode).toBe(201);

    const loginRes = await request(app)
      .post("/api/user/login")
      .send({
        email: user.email,
        password: user.password
      });

    expect(loginRes.statusCode).toBe(200);

    return loginRes.body.data.token;
  };

  beforeAll(async () => {
    ownerToken = await registerAndLogin(owner);
    otherUserToken = await registerAndLogin(otherUser);

    const category = await Category.create({
      name: "Update Category",
      type: "expense"
    });

    categoryId = category._id;

    const expenseRes = await request(app)
      .post("/api/expense")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        categoryID: categoryId,
        amount: 200,
        date: new Date(),
        description: "Before update"
      });

    expect(expenseRes.statusCode).toBe(201);
    expenseId = expenseRes.body.data._id;
  });

  test("Another user cannot access expense by ID", async () => {
    const res = await request(app)
      .get(`/api/expense/${expenseId}`)
      .set("Authorization", `Bearer ${otherUserToken}`);

    expect(res.statusCode).toBe(403);
  });

  test("Another user cannot update expense", async () => {
    const res = await request(app)
      .put(`/api/expense/${expenseId}`)
      .set("Authorization", `Bearer ${otherUserToken}`)
      .send({
        amount: 1,
        description: "Unauthorized modification"
      });

    expect(res.statusCode).toBe(403);

    const savedExpense = await Expense.findById(expenseId);

    expect(savedExpense).not.toBeNull();
    expect(savedExpense.amount).toBe(200);
    expect(savedExpense.description).toBe("Before update");
  });

  test("Owner can update expense", async () => {
    const res = await request(app)
      .put(`/api/expense/${expenseId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        amount: 999,
        description: "After update"
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.amount).toBe(999);
    expect(res.body.data.description).toBe("After update");
  });
});
