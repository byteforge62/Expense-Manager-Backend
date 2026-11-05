
const request = require("supertest");
const app = require("../../app");

jest.setTimeout(30000);

describe("Financial Forecast API", () => {
    let token;

    const testUser = {
        name: "Forecast Integration User",
        email: `forecast_${Date.now()}@mail.com`,
        password: "Password123",
    };

    beforeAll(async () => {
        const signupResponse = await request(app)
            .post("/api/user")
            .send(testUser);

        if (signupResponse.statusCode !== 201) {
            throw new Error(
                `Test user registration failed: ${JSON.stringify(signupResponse.body)}`,
            );
        }

        const loginResponse = await request(app)
            .post("/api/user/login")
            .send({
                email: testUser.email,
                password: testUser.password,
            });

        if (loginResponse.statusCode !== 200 || !loginResponse.body.data?.token) {
            throw new Error(
                `Test user login failed: ${JSON.stringify(loginResponse.body)}`,
            );
        }

        token = loginResponse.body.data.token;
    });

    describe("Authentication", () => {
        test("rejects unauthenticated forecast requests", async () => {
            const response = await request(app)
                .post("/api/financial-forecast")
                .send({
                    openingCash: 75000,
                    horizonMonths: 6,
                });

            expect(response.statusCode).toBe(401);
            expect(response.body.message).toBe("Authentication required");
        });
    });

    describe("Forecast generation", () => {
        test("generates a forecast for an authenticated user", async () => {
            const response = await request(app)
                .post("/api/financial-forecast")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    openingCash: 75000,
                    horizonMonths: 6,
                });

            expect(response.statusCode).toBe(200);

            const payload = response.body.data ?? response.body;

            expect(payload).toBeDefined();
            expect(typeof payload).toBe("object");
            expect(payload).not.toBeNull();
        });

        test("accepts zero opening cash", async () => {
            const response = await request(app)
                .post("/api/financial-forecast")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    openingCash: 0,
                    horizonMonths: 6,
                });

            expect(response.statusCode).toBe(200);
        });
    });

    describe("Input validation", () => {
        test.each([
            ["negative opening cash", { openingCash: -100, horizonMonths: 6 }],
            ["missing opening cash", { horizonMonths: 6 }],
            ["missing horizon", { openingCash: 75000 }],
            ["unsupported horizon", { openingCash: 75000, horizonMonths: 9 }],
            ["string opening cash", { openingCash: "75000", horizonMonths: 6 }],
            ["null opening cash", { openingCash: null, horizonMonths: 6 }],
            ["empty opening cash", { openingCash: "", horizonMonths: 6 }],
        ])("rejects %s", async (_description, body) => {
            const response = await request(app)
                .post("/api/financial-forecast")
                .set("Authorization", `Bearer ${token}`)
                .send(body);

            expect(response.statusCode).toBe(400);
        });
    });

    describe("Supported forecast horizons", () => {
        test.each([3, 6, 12])(
            "accepts a %i-month forecast horizon",
            async (horizonMonths) => {
                const response = await request(app)
                    .post("/api/financial-forecast")
                    .set("Authorization", `Bearer ${token}`)
                    .send({
                        openingCash: 75000,
                        horizonMonths,
                    });

                expect(response.statusCode).toBe(200);
            },
        );
    });
});

