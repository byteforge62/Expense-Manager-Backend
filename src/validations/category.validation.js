const { z } = require("zod");

const createCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(50),

  type: z.enum([
    "Expense",
    "Income",
  ]),
});

const updateCategorySchema =
    createCategorySchema.partial();

module.exports = {
    createCategorySchema,
    updateCategorySchema,
};