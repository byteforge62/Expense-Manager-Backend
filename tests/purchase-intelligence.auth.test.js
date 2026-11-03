const request = require("supertest");
const app = require("../app");

describe("Purchase Intelligence authentication", () => {
  test("requires authentication to list tracked products", async () => {
    const response = await request(app).get("/api/purchase-intelligence");
    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Authentication required");
  });

  test("requires authentication before accepting a product", async () => {
    const response = await request(app)
      .post("/api/purchase-intelligence")
      .send({ name: "Laptop", currentPrice: 50000 });
    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Authentication required");
  });
});
