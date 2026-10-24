const { z } = require("zod");
const { objectIdSchema } = require("./common.validation");

const createBudgetSchema = z.object({
  categoryID: objectIdSchema,

  amount: z.coerce
    .number()
    .positive(),

  month: z
    .number()
    .min(1)
    .max(12),

  year: z
    .number()
    .min(2020),
});

const updateBudgetSchema = createBudgetSchema.partial();

module.exports = {
  createBudgetSchema,
  updateBudgetSchema,
};