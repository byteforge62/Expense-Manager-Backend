
const request = require("supertest");
const app = require("../app");

describe("Authentication rate limiting", () => {
  test(
    "login endpoint returns 429 after exceeding its rate limit",
    async () => {
      const responses = [];

      for (let i = 0; i < 11; i += 1) {
        responses.push(
          await request(app)
            .post("/api/user/login")
            .send({
              email: "ratelimit-test@example.com",
              password: "InvalidPassword123!",
            })
        );
      }

      expect(responses[9].statusCode).not.toBe(429);
      expect(responses[10].statusCode).toBe(429);
      expect(responses[10].body.message).toMatch(
        /too many login attempts/i
      );
    },
    30000
  );
});
