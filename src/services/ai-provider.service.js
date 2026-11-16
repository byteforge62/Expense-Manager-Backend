
const { GoogleGenerativeAI } = require("@google/generative-ai");

let genAI;

const getAIClient = () => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    const error = new Error(
      "AI service is not configured. Please contact the administrator.",
    );
    error.statusCode = 503;
    throw error;
  }

  if (!genAI) {
    genAI = new GoogleGenerativeAI(apiKey);
  }

  return genAI;
};

const generateAIResponse = async (prompt) => {
  const client = getAIClient();
  const model = client.getGenerativeModel({
    model: "gemini-2.5-flash",
  });

  const result = await model.generateContent(prompt);
  const response = await result.response;

  return response.text();
};

module.exports = { generateAIResponse };
