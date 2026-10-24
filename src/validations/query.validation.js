const {z} = require("zod");

const paginationQuerySchema = z.object({
    page:z.coerce
    .number()
    .int()
    .min(1)
    .default(1),

    limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20),

    sortBy: z
    .string()
    .optional(),

    sortOrder:z
    .enum(["asc","desc"])
    .default("desc"),

    search:z
    .string()
    .trim()
    .optional(),
});

module.exports = {
    paginationQuerySchema,
}