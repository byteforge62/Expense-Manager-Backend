const { z } = require("zod");

const createIncomeSchema = z.object({
  amount: z.coerce
    .number()
    .positive("Amount must be greater than 0"),

  source: z
    .string()
    .trim()
    .min(1, "Source is required")
    .max(200, "Source cannot exceed 200 characters"),

  date: z.coerce
    .date()
    .optional(),
});

const updateIncomeSchema = z.object({
  amount: z.coerce
    .number()
    .positive("Amount must be greater than 0")
    .optional(),

  source: z
    .string()
    .trim()
    .max(200, "Source cannot exceed 200 characters")
    .optional(),

  date: z.coerce
    .date()
    .optional(),
});

module.exports = {
  createIncomeSchema,
  updateIncomeSchema,
}; 