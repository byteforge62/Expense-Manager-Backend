
const request = require("supertest");
const app = require("../app");

const BudgetModel = require("../src/models/BudgetModel");
const BillModel = require("../src/models/BillModel");
const IncomeModel = require("../src/models/IncomeModel");
const TransactionModel = require("../src/models/TransactionModel");
const RecurringModel = require("../src/models/RecurringModel");

jest.setTimeout(30000);

describe("Cross-user resource ownership authorization", () => {
  let userAToken;
  let userBToken;

  const createUser = async (prefix) => {
    const user = {
      name: `${prefix} Ownership User`,
      email: `${prefix}_${Date.now()}_${Math.random()}@mail.com`,
      password: "Password123",
    };

    const signup = await request(app).post("/api/user").send(user);

    expect(signup.statusCode).toBe(201);

    const login = await request(app).post("/api/user/login").send({
      email: user.email,
      password: user.password,
    });

    expect(login.statusCode).toBe(200);
    expect(login.body.data.token).toBeDefined();

    return login.body.data.token;
  };

  beforeAll(async () => {
    userAToken = await createUser("owner_a");
    userBToken = await createUser("owner_b");
  });

  describe("Budget ownership", () => {
    let budgetId;

    beforeAll(async () => {
      const response = await request(app)
        .post("/api/budget")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          amount: 1500,
          start_date: new Date(),
          end_date: new Date(Date.now() + 86400000),
        });

      expect(response.statusCode).toBe(201);
      budgetId = response.body.data._id;
    });

    test("another user cannot read the budget", async () => {
      const response = await request(app)
        .get(`/api/budget/${budgetId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(response.statusCode).toBe(403);
    });

    test("another user cannot delete the budget", async () => {
      const response = await request(app)
        .delete(`/api/budget/${budgetId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(response.statusCode).toBe(403);
      expect(await BudgetModel.exists({ _id: budgetId })).not.toBeNull();
    });

    test("the owner can delete the budget", async () => {
      const response = await request(app)
        .delete(`/api/budget/${budgetId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(response.statusCode).toBe(200);
      expect(await BudgetModel.exists({ _id: budgetId })).toBeNull();
    });
  });

  describe("Bill ownership", () => {
    let billId;

    beforeAll(async () => {
      const response = await request(app)
        .post("/api/bill")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          name: "Ownership Test Bill",
          dueDate: new Date(Date.now() + 86400000),
          amount: 500,
          status: "pending",
        });

      expect(response.statusCode).toBe(201);
      billId = response.body.data._id;
    });

    test("another user cannot read the bill", async () => {
      const response = await request(app)
        .get(`/api/bill/${billId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(response.statusCode).toBe(403);
    });

    test("another user cannot delete the bill", async () => {
      const response = await request(app)
        .delete(`/api/bill/${billId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(response.statusCode).toBe(403);
      expect(await BillModel.exists({ _id: billId })).not.toBeNull();
    });

    test("the owner can delete the bill", async () => {
      const response = await request(app)
        .delete(`/api/bill/${billId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(response.statusCode).toBe(200);
      expect(await BillModel.exists({ _id: billId })).toBeNull();
    });
  });

  describe("Income ownership", () => {
    let incomeId;

    beforeAll(async () => {
      const response = await request(app)
        .post("/api/income")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          amount: 2500,
          source: "Ownership Test Income",
          date: new Date(),
        });

      expect(response.statusCode).toBe(201);
      incomeId = response.body.data._id;
    });

    test("another user cannot read the income", async () => {
      const response = await request(app)
        .get(`/api/income/${incomeId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(response.statusCode).toBe(403);
    });

    test("another user cannot delete the income", async () => {
      const response = await request(app)
        .delete(`/api/income/${incomeId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(response.statusCode).toBe(403);
      expect(await IncomeModel.exists({ _id: incomeId })).not.toBeNull();
    });

    test("the owner can delete the income", async () => {
      const response = await request(app)
        .delete(`/api/income/${incomeId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(response.statusCode).toBe(200);
      expect(await IncomeModel.exists({ _id: incomeId })).toBeNull();
    });
  });

  describe("Transaction ownership", () => {
    let transactionId;

    beforeAll(async () => {
      const response = await request(app)
        .post("/api/transaction")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          type: "Expense",
          amount: 750,
          description: "Ownership Test Transaction",
          date: new Date(),
        });

      expect(response.statusCode).toBe(201);
      transactionId = response.body.data._id;
    });

    test("another user cannot read the transaction", async () => {
      const response = await request(app)
        .get(`/api/transaction/${transactionId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(response.statusCode).toBe(403);
    });

    test("another user cannot delete the transaction", async () => {
      const response = await request(app)
        .delete(`/api/transaction/${transactionId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(response.statusCode).toBe(403);
      expect(
        await TransactionModel.exists({ _id: transactionId }),
      ).not.toBeNull();
    });

    test("the owner can delete the transaction", async () => {
      const response = await request(app)
        .delete(`/api/transaction/${transactionId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(response.statusCode).toBe(200);
      expect(
        await TransactionModel.exists({ _id: transactionId }),
      ).toBeNull();
    });
  });

  describe("Recurring transaction ownership", () => {
    let recurringId;

    beforeAll(async () => {
      const response = await request(app)
        .post("/api/recurring")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "Ownership Test Recurring",
          amount: 300,
          category: "Utilities",
          frequency: "monthly",
          nextDate: new Date(Date.now() + 86400000),
        });

      expect(response.statusCode).toBe(201);
      recurringId = response.body.data._id;
    });

    test("another user cannot modify the recurring transaction", async () => {
      const response = await request(app)
        .put(`/api/recurring/${recurringId}`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ amount: 9999 });

      expect(response.statusCode).toBe(403);
    });

    test("another user cannot delete the recurring transaction", async () => {
      const response = await request(app)
        .delete(`/api/recurring/${recurringId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(response.statusCode).toBe(403);
      expect(
        await RecurringModel.exists({ _id: recurringId }),
      ).not.toBeNull();
    });

    test("the owner can delete the recurring transaction", async () => {
      const response = await request(app)
        .delete(`/api/recurring/${recurringId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(response.statusCode).toBe(200);
      expect(
        await RecurringModel.exists({ _id: recurringId }),
      ).toBeNull();
    });
  });
});
