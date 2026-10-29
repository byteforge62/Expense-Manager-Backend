
const { generateAIResponse } = require("../src/services/aiService");

describe("AI service configuration", () => {
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  });

  it("rejects requests when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(generateAIResponse("test prompt")).rejects.toMatchObject({
      message:
        "AI service is not configured. Please contact the administrator.",
      statusCode: 503,
    });
  });
});
