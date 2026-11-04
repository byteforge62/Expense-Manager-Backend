
const { z } = require("zod");

const objectIdSchema = z.string().regex(
  /^[0-9a-fA-F]{24}$/,
  "Invalid MongoDB ID",
);

const createBillSchema = z.object({
  name: z.string().trim().min(1).max(100),
  dueDate: z.coerce.date(),
  amount: z.coerce.number().positive(),
  status: z.enum(["pending", "paid"]).optional(),
}).strict();

const settleBillSchema = z.object({
  expenseId: objectIdSchema,
}).strict();

module.exports = {
  createBillSchema,
  settleBillSchema,
};
