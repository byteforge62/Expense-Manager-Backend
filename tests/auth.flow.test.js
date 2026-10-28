const request = require("supertest");
const app = require("../app");

jest.setTimeout(20000);

describe("Auth Flow", () => {
  let token;
  let userId;
  let currentRefreshCookie;

  const testUser = {
    name: "Test User",
    email: `test_${Date.now()}@mail.com`,
    password: "Password123",
  };

  test("Signup user", async () => {
    const res = await request(app).post("/api/user").send(testUser);

    expect(res.statusCode).toBe(201);

    userId = res.body.user?._id || res.body.data?._id || res.body._id;
    expect(userId).toBeDefined();
  });

  test("Login user", async () => {
    const res = await request(app).post("/api/user/login").send({
      email: testUser.email,
      password: testUser.password,
    });

    expect(res.statusCode).toBe(200);

    token = res.body.data.token;
    expect(token).toBeDefined();

    const cookies = res.headers["set-cookie"] || [];
    const refreshTokenCookie = cookies.find((cookie) =>
      cookie.startsWith("refreshToken="),
    );

    expect(refreshTokenCookie).toBeDefined();

    currentRefreshCookie = refreshTokenCookie.split(";")[0];
  });

  test("Access protected route", async () => {
    const res = await request(app)
      .get(`/api/user/${userId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
  });

  test("Refresh token rotates and invalidates the old token", async () => {
    const oldRefreshCookie = currentRefreshCookie;

    const res = await request(app)
      .post("/api/user/refresh-token")
      .set("Cookie", oldRefreshCookie);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.token).toBeDefined();

    const cookies = res.headers["set-cookie"] || [];
    const newRefreshTokenCookie = cookies.find((cookie) =>
      cookie.startsWith("refreshToken="),
    );

    expect(newRefreshTokenCookie).toBeDefined();
    currentRefreshCookie = newRefreshTokenCookie.split(";")[0];

    // The previous refresh token must no longer work.
    const oldTokenRes = await request(app)
      .post("/api/user/refresh-token")
      .set("Cookie", oldRefreshCookie);

    expect(oldTokenRes.statusCode).toBe(401);

    // The newly issued refresh token must work.
    const newTokenRes = await request(app)
      .post("/api/user/refresh-token")
      .set("Cookie", currentRefreshCookie);

    expect(newTokenRes.statusCode).toBe(200);
    expect(newTokenRes.body.data.token).toBeDefined();

    const latestCookies = newTokenRes.headers["set-cookie"] || [];
    const latestRefreshTokenCookie = latestCookies.find((cookie) =>
      cookie.startsWith("refreshToken="),
    );

    expect(latestRefreshTokenCookie).toBeDefined();
    currentRefreshCookie = latestRefreshTokenCookie.split(";")[0];
  });

  
  test("Concurrent refresh requests allow only one successful rotation", async () => {
    const sharedRefreshCookie = currentRefreshCookie;

    const results = await Promise.all([
      request(app)
        .post("/api/user/refresh-token")
        .set("Cookie", sharedRefreshCookie),
      request(app)
        .post("/api/user/refresh-token")
        .set("Cookie", sharedRefreshCookie),
    ]);

    const statuses = results.map((res) => res.statusCode);

    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 401)).toHaveLength(1);

    // Keep the valid replacement token for the logout test.
    const successfulResponse = results.find((res) => res.statusCode === 200);
    const cookies = successfulResponse.headers["set-cookie"] || [];
    const replacementCookie = cookies.find((cookie) =>
      cookie.startsWith("refreshToken="),
    );

    expect(replacementCookie).toBeDefined();
    currentRefreshCookie = replacementCookie.split(";")[0];
  });


  test("Logout revokes the current refresh token", async () => {
    const logoutRes = await request(app)
      .post("/api/user/logout")
      .set("Cookie", currentRefreshCookie);

    expect(logoutRes.statusCode).toBe(200);

    const refreshRes = await request(app)
      .post("/api/user/refresh-token")
      .set("Cookie", currentRefreshCookie);

    expect(refreshRes.statusCode).toBe(401);
  });

  
});
