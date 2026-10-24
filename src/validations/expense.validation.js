const { z } = require("zod");
const { objectIdSchema } = require("./common.validation");

const createExpenseSchema = z.object({
  categoryID: objectIdSchema,

  amount: z.coerce
    .number()
    .positive("Amount must be greater than 0"),

  description: z
    .string()
    .trim()
    .max(500, "Description cannot exceed 500 characters")
    .optional(),

  date: z.coerce
    .date()
    .optional(),
});

const updateExpenseSchema = z.object({
  categoryID: objectIdSchema.optional(),

  amount: z.coerce
    .number()
    .positive("Amount must be greater than 0")
    .optional(),

  description: z
    .string()
    .trim()
    .max(500)
    .optional(),

  date: z.coerce
    .date()
    .optional(),
});

module.exports = {
  createExpenseSchema,
  updateExpenseSchema,
};