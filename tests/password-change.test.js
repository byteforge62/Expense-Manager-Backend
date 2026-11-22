const request = require("supertest");
const app = require("../app");

jest.setTimeout(30000);

/**
 * In-session password change: current-password proof, policy enforcement,
 * session revocation for other devices and login with the new password.
 */
describe("Password change", () => {
  let token;
  let userId;
  let otherRefreshCookie;

  const user = {
    name: "Password User",
    email: `password_${Date.now()}@mail.com`,
    password: "Password123",
  };

  beforeAll(async () => {
    const signup = await request(app).post("/api/user").send(user);
    userId = signup.body.data?._id || signup.body.user?._id;

    const login = await request(app)
      .post("/api/user/login")
      .send({ email: user.email, password: user.password });

    token = login.body.data.token;

    // A second device session that must be revoked by the change.
    const secondLogin = await request(app)
      .post("/api/user/login")
      .send({ email: user.email, password: user.password });

    const cookies = secondLogin.headers["set-cookie"] || [];
    const refresh = cookies.find((cookie) => cookie.startsWith("refreshToken="));
    otherRefreshCookie = refresh?.split(";")[0];
  });

  test("rejects a wrong current password", async () => {
    const response = await request(app)
      .put(`/api/user/${userId}/password`)
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "WrongPass123", newPassword: "NewPassword123" });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toMatch(/current password is incorrect/i);
  });

  test("enforces the shared password policy", async () => {
    const response = await request(app)
      .put(`/api/user/${userId}/password`)
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: user.password, newPassword: "weak" });

    expect(response.statusCode).toBe(400);
  });

  test("requires authentication", async () => {
    const response = await request(app)
      .put(`/api/user/${userId}/password`)
      .send({ currentPassword: user.password, newPassword: "NewPassword123" });

    expect(response.statusCode).toBe(401);
  });

  test("changes the password and revokes other sessions", async () => {
    const response = await request(app)
      .put(`/api/user/${userId}/password`)
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: user.password, newPassword: "NewPassword123" });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.otherSessionsRevoked).toBeGreaterThanOrEqual(1);

    if (otherRefreshCookie) {
      const refresh = await request(app)
        .post("/api/user/refresh-token")
        .set("Origin", "http://localhost:5173")
        .set("Cookie", otherRefreshCookie);

      expect(refresh.statusCode).toBe(401);
    }
  });

  test("the old password no longer works and the new one does", async () => {
    const oldLogin = await request(app)
      .post("/api/user/login")
      .send({ email: user.email, password: user.password });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await request(app)
      .post("/api/user/login")
      .send({ email: user.email, password: "NewPassword123" });
    expect(newLogin.statusCode).toBe(200);
  });

  test("refuses reusing the current password", async () => {
    const login = await request(app)
      .post("/api/user/login")
      .send({ email: user.email, password: "NewPassword123" });

    const response = await request(app)
      .put(`/api/user/${userId}/password`)
      .set("Authorization", `Bearer ${login.body.data.token}`)
      .send({ currentPassword: "NewPassword123", newPassword: "NewPassword123" });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toMatch(/different/i);
  });
});
