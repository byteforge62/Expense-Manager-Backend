const request = require("supertest");
const app = require("../app");
const UserModel = require("../src/models/UserModel");
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

});
