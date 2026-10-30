const { z } = require("zod");

const createCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Category name is required")
      .max(100, "Category name cannot exceed 100 characters"),
    type: z.enum(["income", "expense"]),
  })
  .strict();

module.exports = {
  createCategorySchema,
};
