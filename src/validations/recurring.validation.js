const { z } = require("zod");

const recurringFields = {
  title: z.string().trim().min(1, "Title is required").max(100),
  amount: z.coerce.number().finite().positive("Amount must be greater than 0"),
  category: z.string().trim().min(1, "Category is required").max(100),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  nextDate: z.coerce.date(),
};

const createRecurringSchema = z.object(recurringFields).strict();

const updateRecurringSchema = z
  .object(recurringFields)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

module.exports = {
  createRecurringSchema,
  updateRecurringSchema,
};
