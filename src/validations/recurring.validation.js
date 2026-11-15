const { z } = require("zod");

const recurringFields = {
  title: z.string().trim().min(1, "Title is required").max(100),

  amount: z.coerce
    .number()
    .finite()
    .positive("Amount must be greater than 0"),

  category: z.string().trim().min(1, "Category is required").max(100),

  type: z.enum(["INCOME", "EXPENSE"]),

  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),

  nextDate: z.coerce.date(),

  // Optional final occurrence. When set, the schedule deactivates itself once
  // the next occurrence would fall past this date.
  endDate: z.coerce.date().optional(),
};

const checkEndDate = (data, ctx) => {
  if (data.endDate && data.nextDate && data.endDate < data.nextDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "End date must be on or after the next occurrence date",
    });
  }
};

const createRecurringSchema = z
  .object(recurringFields)
  .strict()
  .superRefine(checkEndDate);

const updateRecurringSchema = z
  .object(recurringFields)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  })
  .superRefine(checkEndDate);

module.exports = {
  createRecurringSchema,
  updateRecurringSchema,
};
