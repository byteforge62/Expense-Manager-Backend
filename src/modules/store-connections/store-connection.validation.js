const { z } = require("zod");
const { objectIdSchema } = require("../../validations/common.validation");
const { PROVIDER_KEYS } = require("./store-catalog");

/**
 * Store connection contracts.
 *
 * An imported order must carry the store's own order id: it is the only stable
 * key that lets a re-import update nothing instead of duplicating the purchase.
 */

const httpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }, "URL must use HTTP or HTTPS");

const linkStoreSchema = z
  .object({
    provider: z.enum(PROVIDER_KEYS),
    accountLabel: z
      .string()
      .trim()
      .min(3, "Enter the email or phone number used at this store")
      .max(160),
  })
  .strict();

const importOrderSchema = z
  .object({
    orderId: z.string().trim().min(1, "Each order needs an order ID").max(120),
    name: z
      .string()
      .trim()
      .min(2, "Product name must contain at least 2 characters")
      .max(160),
    unitPrice: z.coerce.number().finite().min(0, "Price cannot be negative"),
    quantity: z.coerce.number().int().min(1).max(9999).default(1),
    purchaseDate: z.coerce.date().optional(),
    category: z.string().trim().max(80).optional(),
    productUrl: httpUrlSchema.optional(),
    status: z
      .enum(["ORDERED", "SHIPPED", "DELIVERED", "RETURNED", "CANCELLED"])
      .optional(),
  })
  .strict();

const importOrdersSchema = z
  .object({
    orders: z
      .array(importOrderSchema)
      .min(1, "Import at least one order")
      .max(200, "Import up to 200 orders at a time"),
  })
  .strict();

const storeConnectionIdParamSchema = z.object({ id: objectIdSchema });

module.exports = {
  linkStoreSchema,
  importOrdersSchema,
  storeConnectionIdParamSchema,
};
