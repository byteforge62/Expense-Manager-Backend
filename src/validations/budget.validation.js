const { z } = require("zod");
const { objectIdSchema } = require("./common.validation");

const createBudgetSchema = z
  .object({
    categoryID: objectIdSchema,
    amount: z.coerce
      .number()
      .finite()
      .positive("Amount must be greater than 0"),
    description: z.string().trim().max(500).optional(),
    start_date: z.coerce.date().optional(),
    end_date: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.start_date && data.end_date && data.end_date < data.start_date) {
      ctx.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "End date must be after or equal to start date",
      });
    }
  });

module.exports = { createBudgetSchema };
