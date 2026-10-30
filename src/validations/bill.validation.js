const { z } = require("zod");

const createBillSchema = z.object({
  name: z.string().trim().min(1).max(100),
  dueDate: z.coerce.date(),
  amount: z.coerce.number().positive(),
  status: z.enum(["pending", "paid"]).optional(),
}).strict();

module.exports = { createBillSchema };