const request = require("supertest");
const app = require("../app");

const Category = require("../src/models/CategoryModel");
const Expense = require("../src/models/ExpenseModel");
const Purchase = require("../src/modules/purchases/models/PurchaseModel");

jest.setTimeout(30000);

/**
 * Purchase records: ownership, totals, the optional expense link, duplicate
 * prevention and the server-side analytics aggregation.
 */
describe("Purchase records", () => {
  let token;
  let otherToken;
  let categoryId;
  let purchaseId;
  let linkedExpenseId;
  let linkedPurchaseId;

  const buyer = {
    name: "Purchase Buyer",
    email: `buyer_${Date.now()}@mail.com`,
    password: "Password123",
  };

  const otherBuyer = {
    name: "Other Buyer",
    email: `buyer_other_${Date.now()}@mail.com`,
    password: "Password123",
  };

  const auth = (req, value = token) =>
    req.set("Authorization", `Bearer ${value}`);

  beforeAll(async () => {
    await request(app).post("/api/user").send(buyer);
    const login = await request(app)
      .post("/api/user/login")
      .send({ email: buyer.email, password: buyer.password });
    token = login.body.data.token;

    await request(app).post("/api/user").send(otherBuyer);
    const otherLogin = await request(app)
      .post("/api/user/login")
      .send({ email: otherBuyer.email, password: otherBuyer.password });
    otherToken = otherLogin.body.data.token;

    const category = await Category.create({ name: "Electronics", type: "expense" });
    categoryId = category._id.toString();
  });

  test("requires authentication to list purchases", async () => {
    const response = await request(app).get("/api/purchases/me");
    expect(response.statusCode).toBe(401);
  });

  test("records a purchase and computes the total from price and quantity", async () => {
    const response = await auth(request(app).post("/api/purchases")).send({
      name: "Wireless mouse",
      merchant: "Amazon",
      sourceWebsite: "amazon.in",
      productUrl: "https://www.amazon.in/example-mouse",
      category: "Electronics",
      unitPrice: 1500,
      quantity: 2,
      orderId: "ORD-1001",
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.data.totalAmount).toBe(3000);
    expect(response.body.data.quantity).toBe(2);
    expect(response.body.data.linkedExpenseId).toBeUndefined();

    purchaseId = response.body.data._id;

    // No expense is created unless the client asks for one.
    expect(await Expense.countDocuments({})).toBe(0);
  });

  test("rejects a second purchase with the same order id for the same user", async () => {
    const response = await auth(request(app).post("/api/purchases")).send({
      name: "Wireless mouse duplicate",
      unitPrice: 1500,
      orderId: "ORD-1001",
    });

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toMatch(/order id/i);
  });

  test("requires an expense category when the purchase should be booked as spending", async () => {
    const response = await auth(request(app).post("/api/purchases")).send({
      name: "Mechanical keyboard",
      unitPrice: 2499,
      syncExpense: true,
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.errors[0].message).toMatch(/expense category/i);
  });

  test("creates one linked expense for a purchase booked as spending", async () => {
    const response = await auth(request(app).post("/api/purchases")).send({
      name: "Mechanical keyboard",
      merchant: "Flipkart",
      unitPrice: 2499,
      quantity: 1,
      syncExpense: true,
      expenseCategoryID: categoryId,
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.data.linkedExpenseId).toBeDefined();

    linkedPurchaseId = response.body.data._id;
    linkedExpenseId = response.body.data.linkedExpenseId;

    const expense = await Expense.findById(linkedExpenseId).lean();
    expect(expense).toBeTruthy();
    expect(expense.amount).toBe(2499);
    expect(expense.description).toContain("Mechanical keyboard");
    expect(expense.description).toContain("Flipkart");
    expect(String(expense.categoryID)).toBe(categoryId);
  });

  test("does not create a second expense when the same purchase is re-sent", async () => {
    // The frontend sends an Idempotency-Key on financial mutations; reusing it
    // must replay the first response rather than book the purchase twice.
    const key = `purchase-${Date.now()}`;
    const payload = {
      name: "Desk lamp",
      unitPrice: 800,
      syncExpense: true,
      expenseCategoryID: categoryId,
    };

    const first = await auth(request(app).post("/api/purchases"))
      .set("Idempotency-Key", key)
      .send(payload);
    const second = await auth(request(app).post("/api/purchases"))
      .set("Idempotency-Key", key)
      .send(payload);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.body.data._id).toBe(first.body.data._id);

    expect(await Purchase.countDocuments({ name: "Desk lamp" })).toBe(1);
    expect(
      await Expense.countDocuments({ description: /Desk lamp/ }),
    ).toBe(1);
  });

  test("aggregates real purchase analytics for the authenticated user", async () => {
    const response = await auth(request(app).get("/api/purchases/summary"));

    expect(response.statusCode).toBe(200);

    const { totals, byCategory, byMerchant, recent } = response.body.data;

    expect(totals.purchaseCount).toBe(3);
    expect(totals.totalSpend).toBe(6299);
    expect(totals.itemCount).toBe(4);
    expect(totals.averageSpend).toBeCloseTo(6299 / 3, 2);

    const electronics = byCategory.find((row) => row.category === "Electronics");
    expect(electronics.spend).toBe(3000);

    expect(byMerchant[0].merchant).toBe("Amazon");
    expect(byMerchant[0].spend).toBe(3000);
    expect(recent.length).toBeGreaterThan(0);
  });

  test("filters the list and the analytics by category", async () => {
    const list = await auth(
      request(app).get("/api/purchases/me").query({ category: "Electronics" }),
    );
    expect(list.statusCode).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].name).toBe("Wireless mouse");

    const summary = await auth(
      request(app).get("/api/purchases/summary").query({ category: "Electronics" }),
    );
    expect(summary.body.data.totals.totalSpend).toBe(3000);
    expect(summary.body.data.totals.purchaseCount).toBe(1);
  });

  test("updates the purchase and keeps its linked expense in sync", async () => {
    const response = await auth(
      request(app).put(`/api/purchases/${linkedPurchaseId}`),
    ).send({ unitPrice: 3000, quantity: 2 });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.totalAmount).toBe(6000);

    const expense = await Expense.findById(linkedExpenseId).lean();
    expect(expense.amount).toBe(6000);
  });

  test("another user cannot read the purchase", async () => {
    const response = await auth(
      request(app).get(`/api/purchases/${purchaseId}`),
      otherToken,
    );

    expect([403, 404]).toContain(response.statusCode);
  });

  test("deleting a purchase removes its linked expense", async () => {
    const response = await auth(
      request(app).delete(`/api/purchases/${linkedPurchaseId}`),
    );

    expect(response.statusCode).toBe(200);
    expect(await Purchase.findById(linkedPurchaseId)).toBeNull();
    expect(await Expense.findById(linkedExpenseId)).toBeNull();
  });

  test("validates the product URL protocol", async () => {
    const response = await auth(request(app).post("/api/purchases")).send({
      name: "Bad URL item",
      unitPrice: 100,
      productUrl: "javascript:alert(1)",
    });

    expect(response.statusCode).toBe(400);
  });
});
