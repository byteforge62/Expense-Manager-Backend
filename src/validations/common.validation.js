const {z} = require("zod");
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/,"Invalid MongoDB ObjectId");
const uuidSchema = z.string().uuid("Invalid UUID");
const dateSchema = z.string().datetime("Invalid ISO date");
const idParamSchema = z.object({
    id:objectIdSchema
});
module.exports = {
    objectIdSchema,
    uuidSchema,
    dateSchema,
    idParamSchema
}