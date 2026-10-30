
const request = require("supertest");
const app = require("../app");
const Category = require("../src/models/CategoryModel");
const Expense = require("../src/models/ExpenseModel");

jest.setTimeout(20000);

describe("Delete Expense Authorization", () => {
  let ownerToken;
  let otherUserToken;
  let expenseId;

  const owner = {
    name: "Delete Owner",
    email: `delete_owner_${Date.now()}@mail.com`,
    password: "Password123"
  };

  const otherUser = {
    name: "Delete Other User",
    email: `delete_other_${Date.now()}@mail.com`,
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
      name: "Delete Test Category",
      type: "expense"
    });

    const expenseRes = await request(app)
      .post("/api/expense")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        categoryID: category._id,
        amount: 999,
        date: new Date(),
        description: "Expense to be deleted"
      });

    expect(expenseRes.statusCode).toBe(201);
    expenseId = expenseRes.body.data._id;
  });

  test("Another user cannot delete expense", async () => {
    const res = await request(app)
      .delete(`/api/expense/${expenseId}`)
      .set("Authorization", `Bearer ${otherUserToken}`);

    expect(res.statusCode).toBe(403);

    const savedExpense = await Expense.findById(expenseId);

    expect(savedExpense).not.toBeNull();
    expect(savedExpense.amount).toBe(999);
  });

  test("Owner can delete expense", async () => {
    const res = await request(app)
      .delete(`/api/expense/${expenseId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);

    const deletedExpense = await Expense.findById(expenseId);

    expect(deletedExpense).toBeNull();
  });
});
