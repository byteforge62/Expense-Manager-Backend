const { z } = require("zod");

const createBillSchema = z.object({
  title: z.string().trim().min(1).max(200),

  amount: z.coerce
    .number()
    .positive(),

  dueDate: z.coerce.date(),

  recurring: z.boolean().optional(),
});

const updateBillSchema = createBillSchema.partial();

module.exports = {
  createBillSchema,
  updateBillSchema,
};