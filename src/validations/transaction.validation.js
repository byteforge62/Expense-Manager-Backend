const { z } = require("zod");

const createTransactionSchema = z
  .object({
    type: z.enum(["Income", "Expense"]),
    amount: z.coerce
      .number()
      .finite()
      .positive("Amount must be greater than 0"),
    date: z.coerce.date().optional(),
    description: z.string().trim().max(500).optional(),
  })
  .strict();

module.exports = { createTransactionSchema };
