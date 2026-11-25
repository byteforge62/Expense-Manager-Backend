const request = require("supertest");
const app = require("../app");

const Purchase = require("../src/modules/purchases/models/PurchaseModel");
const StoreConnection = require("../src/modules/store-connections/models/StoreConnectionModel");

jest.setTimeout(30000);

/**
 * Store connections: linking, ownership, order import and the guarantee that
 * importing the same store export twice never double-counts purchases.
 */
describe("Store connections", () => {
  let token;
  let otherToken;
  let connectionId;

  const shopper = {
    name: "Store Shopper",
    email: `shopper_${Date.now()}@mail.com`,
    password: "Password123",
  };

  const otherShopper = {
    name: "Other Shopper",
    email: `shopper_other_${Date.now()}@mail.com`,
    password: "Password123",
  };

  const auth = (req, value = token) =>
    req.set("Authorization", `Bearer ${value}`);

  beforeAll(async () => {
    await request(app).post("/api/user").send(shopper);
    const login = await request(app)
      .post("/api/user/login")
      .send({ email: shopper.email, password: shopper.password });
    token = login.body.data.token;

    await request(app).post("/api/user").send(otherShopper);
    const otherLogin = await request(app)
      .post("/api/user/login")
      .send({ email: otherShopper.email, password: otherShopper.password });
    otherToken = otherLogin.body.data.token;
  });

  test("requires authentication", async () => {
    const response = await request(app).get("/api/store-connections");
    expect(response.statusCode).toBe(401);
  });

  test("lists the supported stores before anything is linked", async () => {
    const response = await auth(request(app).get("/api/store-connections"));

    expect(response.statusCode).toBe(200);
    expect(response.body.data.stores.length).toBeGreaterThanOrEqual(8);
    expect(
      response.body.data.stores.map((store) => store.key),
    ).toEqual(expect.arrayContaining(["amazon", "flipkart"]));
    expect(response.body.data.connections).toEqual([]);
  });

  test("rejects an unsupported store", async () => {
    const response = await auth(request(app).post("/api/store-connections")).send({
      provider: "not-a-store",
      accountLabel: "someone@mail.com",
    });

    expect(response.statusCode).toBe(400);
  });

  test("links a store account without storing any credential", async () => {
    const response = await auth(request(app).post("/api/store-connections")).send({
      provider: "amazon",
      accountLabel: "shopper@mail.com",
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.data.provider).toBe("amazon");
    expect(response.body.data.providerName).toBe("Amazon");
    expect(response.body.data.accountLabel).toBe("shopper@mail.com");

    connectionId = response.body.data._id;

    const stored = await StoreConnection.findById(connectionId).lean();
    expect(stored.password).toBeUndefined();
    expect(stored.accessToken).toBeUndefined();
  });

  test("does not link the same store twice for one user", async () => {
    const response = await auth(request(app).post("/api/store-connections")).send({
      provider: "amazon",
      accountLabel: "shopper@mail.com",
    });

    expect(response.statusCode).toBe(409);
  });

  test("imports store orders as purchase records", async () => {
    const response = await auth(
      request(app).post(`/api/store-connections/${connectionId}/import`),
    ).send({
      orders: [
        {
          orderId: "AMZ-1",
          name: "Noise cancelling headphones",
          unitPrice: 8999,
          quantity: 1,
          purchaseDate: "2026-10-04",
          category: "Electronics",
        },
        {
          orderId: "AMZ-2",
          name: "USB-C cable",
          unitPrice: 399,
          quantity: 2,
          purchaseDate: "2026-10-06",
          category: "Electronics",
        },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.imported).toBe(2);
    expect(response.body.data.duplicates).toBe(0);

    const purchases = await Purchase.find({ orderId: { $in: ["AMZ-1", "AMZ-2"] } }).lean();
    expect(purchases).toHaveLength(2);

    const cable = purchases.find((row) => row.orderId === "AMZ-2");
    expect(cable.merchant).toBe("Amazon");
    expect(cable.totalAmount).toBe(798);
    expect(cable.notes).toMatch(/imported from amazon/i);

    const summary = await auth(request(app).get("/api/purchases/summary"));
    expect(summary.body.data.totals.purchaseCount).toBe(2);
    expect(summary.body.data.totals.totalSpend).toBe(9797);
  });

  test("re-importing the same export skips duplicates instead of double counting", async () => {
    const response = await auth(
      request(app).post(`/api/store-connections/${connectionId}/import`),
    ).send({
      orders: [
        {
          orderId: "AMZ-1",
          name: "Noise cancelling headphones",
          unitPrice: 8999,
          quantity: 1,
        },
        {
          orderId: "AMZ-3",
          name: "Laptop stand",
          unitPrice: 1499,
          quantity: 1,
        },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.imported).toBe(1);
    expect(response.body.data.duplicates).toBe(1);

    expect(await Purchase.countDocuments({ orderId: "AMZ-1" })).toBe(1);
    expect(await Purchase.countDocuments({ merchant: "Amazon" })).toBe(3);
  });

  test("records the import on the connection", async () => {
    const response = await auth(request(app).get("/api/store-connections"));
    const connection = response.body.data.connections[0];

    expect(connection.lastImportCount).toBe(1);
    expect(connection.totalImported).toBe(3);
    expect(connection.lastSyncedAt).toBeTruthy();
  });

  test("another user cannot import into someone else's linked account", async () => {
    const response = await auth(
      request(app).post(`/api/store-connections/${connectionId}/import`),
      otherToken,
    ).send({
      orders: [
        { orderId: "AMZ-9", name: "Someone else's order", unitPrice: 100 },
      ],
    });

    expect([403, 404]).toContain(response.statusCode);
    expect(await Purchase.countDocuments({ orderId: "AMZ-9" })).toBe(0);
  });

  test("unlinks the store account but keeps the imported purchases", async () => {
    const response = await auth(
      request(app).delete(`/api/store-connections/${connectionId}`),
    );

    expect(response.statusCode).toBe(200);
    expect(await StoreConnection.findById(connectionId)).toBeNull();
    expect(await Purchase.countDocuments({ merchant: "Amazon" })).toBe(3);
  });
});
