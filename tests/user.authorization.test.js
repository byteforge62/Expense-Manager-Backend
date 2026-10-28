const request = require("supertest");
const app = require("../app");
const UserModel = require("../src/models/UserModel");
const RefreshTokenModel = require("../src/models/RefreshTokenModel");
const jwt = require("jsonwebtoken");


jest.setTimeout(20000);

describe("User authorization", () => {
    let userA;
    let userB;
    let tokenA;
    let adminToken;

    const makeUser = (suffix) => ({
        name: `Authorization User ${suffix}`,
        email: `authorization_${suffix}_${Date.now()}@mail.com`,
        password: "Password123",
    });

    const signupAndLogin = async (user) => {
        const signup = await request(app).post("/api/user").send(user);
        expect(signup.statusCode).toBe(201);

        const login = await request(app)
            .post("/api/user/login")
            .send({ email: user.email, password: user.password });

        expect(login.statusCode).toBe(200);

        return {
            id: signup.body.data?._id || signup.body.user?._id || signup.body._id,
            token: login.body.data.token,
        };
    };

    beforeAll(async () => {
        userA = await signupAndLogin(makeUser("A"));
        userB = await signupAndLogin(makeUser("B"));

        tokenA = userA.token;

        const admin = await UserModel.create({
            name: "Authorization Admin",
            email: `authorization_admin_${Date.now()}@mail.com`,
            password: "$2b$10$wQwQwQwQwQwQwQwQwQwQwO",
            role: "Admin",
        });

        adminToken = jwt.sign(
            { id: admin._id.toString(), role: "Admin" },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );
    });

    test("user can access their own profile", async () => {
        const res = await request(app)
            .get(`/api/user/${userA.id}`)
            .set("Authorization", `Bearer ${tokenA}`);

        expect(res.statusCode).toBe(200);
    });

    test("updating own profile does not expose password hash", async () => {
        const res = await request(app)
            .put(`/api/user/${userA.id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ name: "Updated Authorization User" });

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toBeDefined();
        expect(res.body.data).not.toHaveProperty("password");
    });

    test("user cannot access another user's profile", async () => {
        const res = await request(app)
            .get(`/api/user/${userB.id}`)
            .set("Authorization", `Bearer ${tokenA}`);

        expect(res.statusCode).toBe(403);
    });

    test("user cannot update another user's profile", async () => {
        const res = await request(app)
            .put(`/api/user/${userB.id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ name: "Unauthorized Change" });

        expect(res.statusCode).toBe(403);
    });

    test("regular user cannot delete an account", async () => {
        const res = await request(app)
            .delete(`/api/user/${userB.id}`)
            .set("Authorization", `Bearer ${tokenA}`);

        expect(res.statusCode).toBe(403);
    });

    test("admin can access another user's profile", async () => {
        const res = await request(app)
            .get(`/api/user/${userA.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(res.statusCode).toBe(200);
    });

    test("user cannot upload a profile image for another user", async () => {
        const res = await request(app)
            .post(`/api/user/upload-profile/${userB.id}`)
            .set("Authorization", `Bearer ${tokenA}`);

        expect(res.statusCode).toBe(403);
    });


    test("rejects unsupported profile image types", async () => {
        const res = await request(app)
            .post(`/api/user/upload-profile/${userA.id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .attach("profilePic", Buffer.from("not an image"), {
                filename: "payload.txt",
                contentType: "text/plain",
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/JPEG, PNG, and WebP/i);
    });

    test("rejects profile images larger than 5 MB", async () => {
        const oversizedImage = Buffer.alloc(5 * 1024 * 1024 + 1);

        const res = await request(app)
            .post(`/api/user/upload-profile/${userA.id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .attach("profilePic", oversizedImage, {
                filename: "large.png",
                contentType: "image/png",
            });

        expect(res.statusCode).toBe(413);
        expect(res.body.message).toMatch(/5 MB/i);
    });


    test("rejects files that claim to be PNG but contain non-image data", async () => {
        const res = await request(app)
            .post(`/api/user/upload-profile/${userA.id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .attach("profilePic", Buffer.from("not a real PNG image"), {
                filename: "fake.png",
                contentType: "image/png",
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/content does not match/i);
    });

    
    test("inactive user cannot log in with valid credentials", async () => {
        const password = "Password123";
        const bcrypt = require("bcrypt");

        const inactiveUser = await UserModel.create({
            name: "Inactive Test User",
            email: `inactive_${Date.now()}@mail.com`,
            password: await bcrypt.hash(password, 10),
            role: "User",
            is_active: false,
        });

        const res = await request(app)
            .post("/api/user/login")
            .send({
                email: inactiveUser.email,
                password,
            });

        expect(res.statusCode).toBe(401);
        expect(res.body).toMatchObject({
            success: false,
            message: "Invalid email or password",
        });
    });

    test("admin deleting a user removes their refresh tokens", async () => {
      const target = await signupAndLogin(makeUser("delete_cleanup"));

      await RefreshTokenModel.create({
        user: target.id,
        tokenHash: `test_hash_${Date.now()}_${Math.random()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const deleteRes = await request(app)
        .delete(`/api/user/${target.id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(deleteRes.statusCode).toBe(200);

      const remainingTokens = await RefreshTokenModel.countDocuments({
        user: target.id,
      });

      expect(remainingTokens).toBe(0);
    });
});
