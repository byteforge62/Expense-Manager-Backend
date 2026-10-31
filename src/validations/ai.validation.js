const { z } = require("zod");

const askAISchema = z
  .object({
    message: z
      .string({
        error: "Message must be a string",
      })
      .trim()
      .min(1, "Message cannot be empty")
      .max(3000, "Message cannot exceed 3000 characters"),
  })
  .strict();

module.exports = {
  askAISchema,
};
