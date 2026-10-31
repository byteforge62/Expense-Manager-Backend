
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");

const UserModel = require("../src/models/UserModel");
const CategoryModel = require("../src/models/CategoryModel");

jest.setTimeout(30000);

describe("Category route validation and authorization", () => {
  let adminToken;
  let userToken;
  let categoryId;

  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const createToken = (userId) =>
    jwt.sign(
      { id: userId.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

  beforeAll(async () => {
    const admin = await UserModel.create({
      name: "Category Admin Test",
      email: `category_admin_${uniqueSuffix}@mail.com`,
      password: "test-only-password",
      role: "Admin",
      is_active: true,
    });

    const user = await UserModel.create({
      name: "Category Regular Test",
      email: `category_user_${uniqueSuffix}@mail.com`,
      password: "test-only-password",
      role: "User",
      is_active: true,
    });

    adminToken = createToken(admin._id);
    userToken = createToken(user._id);

    const category = await CategoryModel.create({
      name: `Existing Category ${uniqueSuffix}`,
      type: "expense",
    });

    categoryId = category._id.toString();
  });

  describe("Category creation", () => {
    test("Admin can create a valid category", async () => {
      const response = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: `Valid Category ${uniqueSuffix}`,
          type: "expense",
        });

      expect(response.statusCode).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe(
        `Valid Category ${uniqueSuffix}`
      );
      expect(response.body.data.type).toBe("expense");
    });

    test("Rejects an empty category name", async () => {
      const response = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "   ",
          type: "expense",
        });

      expect(response.statusCode).toBe(400);
    });

    test("Rejects an unsupported category type", async () => {
      const response = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: `Invalid Type ${uniqueSuffix}`,
          type: "saving",
        });

      expect(response.statusCode).toBe(400);
    });

    test("Rejects unexpected fields such as userID", async () => {
      const response = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: `Extra Field ${uniqueSuffix}`,
          type: "expense",
          userID: "507f1f77bcf86cd799439011",
        });

      expect(response.statusCode).toBe(400);
    });

    test("Rejects unexpected _id field", async () => {
      const response = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          _id: "507f1f77bcf86cd799439011",
          name: `Injected ID ${uniqueSuffix}`,
          type: "expense",
        });

      expect(response.statusCode).toBe(400);
    });

    test("Rejects duplicate categories", async () => {
      const categoryName = `Duplicate Category ${uniqueSuffix}`;

      const firstResponse = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: categoryName,
          type: "expense",
        });

      expect(firstResponse.statusCode).toBe(201);

      const secondResponse = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: categoryName,
          type: "expense",
        });

      expect(secondResponse.statusCode).toBe(409);
    });

    test("Regular users cannot create categories", async () => {
      const response = await request(app)
        .post("/api/categories")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          name: `Unauthorized Category ${uniqueSuffix}`,
          type: "expense",
        });

      expect(response.statusCode).toBe(403);
    });

    test("Unauthenticated users cannot create categories", async () => {
      const response = await request(app)
        .post("/api/categories")
        .send({
          name: `No Auth Category ${uniqueSuffix}`,
          type: "expense",
        });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("Category ID validation", () => {
    test("Rejects invalid ObjectId when fetching a category", async () => {
      const response = await request(app)
        .get("/api/category/invalid-id")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.statusCode).toBe(400);
    });

    test("Rejects invalid ObjectId when deleting a category", async () => {
      const response = await request(app)
        .delete("/api/categories/invalid-id")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.statusCode).toBe(400);
    });
  });

  describe("Category deletion authorization", () => {
    test("Regular users cannot delete categories", async () => {
      const response = await request(app)
        .delete(`/api/categories/${categoryId}`)
        .set("Authorization", `Bearer ${userToken}`);

      expect(response.statusCode).toBe(403);

      expect(
        await CategoryModel.exists({ _id: categoryId })
      ).not.toBeNull();
    });

    test("Admin can delete a category", async () => {
      const response = await request(app)
        .delete(`/api/categories/${categoryId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.statusCode).toBe(200);

      expect(
        await CategoryModel.exists({ _id: categoryId })
      ).toBeNull();
    });
  });
});
