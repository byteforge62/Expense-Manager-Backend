const fs = require("fs/promises");
const path = require("path");
const request = require("supertest");
const app = require("../app");

const Purchase = require("../src/modules/purchases/models/PurchaseModel");
const {
  LOCAL_PURCHASE_DIR,
} = require("../src/modules/purchases/services/purchase-image.service");

jest.setTimeout(30000);

/**
 * Product images are private: the public `/uploads` directory is gone and every
 * read needs a short-lived signed link bound to the image owner.
 */
describe("Purchase image access", () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
  ]);

  let tokenA;
  let tokenB;
  let userIdA;
  let userIdB;
  let signedUrl;
  let file;
  let awsEnv;

  const auth = (req, token = tokenA) =>
    req.set("Authorization", `Bearer ${token}`);

  const register = async (prefix) => {
    const email = `${prefix}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}@mail.com`;
    const password = "Password123";

    await request(app)
      .post("/api/user")
      .send({ name: `${prefix} user`, email, password });

    const login = await request(app)
      .post("/api/user/login")
      .send({ email, password });

    return {
      token: login.body.data.token,
      userId: login.body.data.user._id,
    };
  };

  beforeAll(async () => {
    // Exercise the on-disk path deterministically: a developer .env may point
    // at real object storage, and these tests must not upload to it or depend
    // on its credentials.
    awsEnv = {
      AWS_REGION: process.env.AWS_REGION,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME,
    };

    for (const name of Object.keys(awsEnv)) {
      delete process.env[name];
    }

    ({ token: tokenA, userId: userIdA } = await register("image_owner"));
    ({ token: tokenB, userId: userIdB } = await register("image_other"));
  });

  afterAll(async () => {
    await fs.rm(path.join(LOCAL_PURCHASE_DIR, String(userIdA)), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(LOCAL_PURCHASE_DIR, String(userIdB)), {
      recursive: true,
      force: true,
    });

    for (const [name, value] of Object.entries(awsEnv || {})) {
      if (value !== undefined) {
        process.env[name] = value;
      }
    }
  });

  test("uploads an image and returns a signed read link", async () => {
    const response = await auth(
      request(app).post("/api/purchases/upload-image"),
    ).attach("image", png, { filename: "photo.png", contentType: "image/png" });

    expect(response.statusCode).toBe(201);
    expect(response.body.data.url).toContain("/api/purchases/images/");
    expect(response.body.data.url).toContain("token=");

    signedUrl = response.body.data.url;
    file = path.basename(new URL(signedUrl).pathname);

    // Stored per owner, so a token for one user cannot resolve another's file.
    const stat = await fs.stat(path.join(LOCAL_PURCHASE_DIR, String(userIdA), file));
    expect(stat.isFile()).toBe(true);
  });

  test("serves the image through its signed link", async () => {
    const parsed = new URL(signedUrl);
    const response = await request(app).get(`${parsed.pathname}${parsed.search}`);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["cache-control"]).toContain("private");
  });

  test("rejects an unsigned read of the same image", async () => {
    const response = await request(app).get(
      `/api/purchases/images/${encodeURIComponent(file)}`,
    );

    expect(response.statusCode).toBe(401);
  });

  test("rejects a token presented for a different file", async () => {
    const parsed = new URL(signedUrl);
    const response = await request(app).get(
      `/api/purchases/images/other-file.png${parsed.search}`,
    );

    expect(response.statusCode).toBe(403);
  });

  test("no longer serves the public /uploads directory", async () => {
    const response = await request(app).get(`/uploads/purchases/${file}`);

    expect(response.statusCode).toBe(404);
  });

  test("stores a token-free reference and re-signs it on read", async () => {
    const created = await auth(request(app).post("/api/purchases")).send({
      name: "Photo item",
      unitPrice: 500,
      imageUrl: signedUrl,
    });

    expect(created.statusCode).toBe(201);
    expect(created.body.data.imageUrl).toContain("token=");

    const stored = await Purchase.findOne({ name: "Photo item" }).lean();
    expect(stored.imageUrl).toBe(`/uploads/purchases/${file}`);
    expect(stored.imageUrl).not.toContain("token");

    const list = await auth(request(app).get("/api/purchases/me"));
    const row = list.body.data.find((purchase) => purchase.name === "Photo item");
    expect(row.imageUrl).toContain("/api/purchases/images/");
    expect(row.imageUrl).toContain("token=");
  });

  test("a stolen image URL cannot be re-signed for another user", async () => {
    // B sees A's image link and attaches it to their own purchase. The server
    // signs it for B, and the resulting link resolves inside B's directory -
    // where the file does not exist.
    const created = await auth(
      request(app).post("/api/purchases"),
      tokenB,
    ).send({ name: "Stolen image", unitPrice: 10, imageUrl: signedUrl });

    expect(created.statusCode).toBe(201);

    const parsed = new URL(created.body.data.imageUrl);
    const response = await request(app).get(`${parsed.pathname}${parsed.search}`);

    expect(response.statusCode).toBe(404);
  });
});
