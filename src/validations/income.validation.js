const { z } = require("zod");

const createIncomeSchema = z
  .object({
    amount: z.coerce
      .number()
      .finite()
      .positive("Amount must be greater than 0"),
    source: z.string().trim().max(100).optional(),
    date: z.coerce.date().optional(),
  })
  .strict();

module.exports = { createIncomeSchema };