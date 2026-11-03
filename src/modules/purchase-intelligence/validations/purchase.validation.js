const { z } = require("zod");
const { objectIdSchema } = require("../../../validations/common.validation");

const safeUrlSchema = z.string().trim().url().max(2048).refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}, "Product URL must use HTTP or HTTPS");

const listingSchema = z.object({
  platform: z.string().trim().min(1).max(80).optional(),
  url: safeUrlSchema.optional(),
  price: z.coerce.number().finite().min(0),
}).strict().refine((value) => Boolean(value.platform || value.url), "A retailer name or retailer URL is required");

const createPurchaseProductSchema = z.object({
  name: z.string().trim().min(2, "Product name must contain at least 2 characters").max(160),
  category: z.string().trim().max(80).optional(),
  brand: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  productUrl: safeUrlSchema.optional(),
  imageUrl: safeUrlSchema.optional(),
  status: z.enum(["CONSIDERING", "WATCHLIST", "PURCHASED", "CANCELLED"]).optional(),
  currentPrice: z.coerce.number().finite().positive("Current price must be greater than 0"),
  targetPrice: z.coerce.number().finite().positive().optional(),
  currency: z.string().trim().length(3).default("INR"),
  listing: listingSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
}).strict();

const updatePurchaseProductSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  category: z.string().trim().max(80).optional(),
  brand: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  productUrl: safeUrlSchema.optional(),
  imageUrl: safeUrlSchema.optional(),
  status: z.enum(["CONSIDERING", "WATCHLIST", "PURCHASED", "CANCELLED"]).optional(),
  currentPrice: z.coerce.number().finite().positive().optional(),
  targetPrice: z.coerce.number().finite().positive().optional(),
  currency: z.string().trim().length(3).optional(),
  listing: listingSchema.optional(),
  purchasePrice: z.coerce.number().finite().positive().optional(),
  purchaseDate: z.coerce.date().optional(),
  paymentMethod: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

const resolveProductUrlSchema = z.object({
  url: safeUrlSchema,
}).strict();

const analyzePurchaseSchema = z.object({
  availableCash: z.coerce.number().finite().min(0, "Available cash cannot be negative"),
  purchasePrice: z.coerce.number().finite().positive().optional(),
}).strict();

const purchaseIdParamSchema = z.object({ id: objectIdSchema });

module.exports = {
  createPurchaseProductSchema,
  updatePurchaseProductSchema,
  analyzePurchaseSchema,
  resolveProductUrlSchema,
  purchaseIdParamSchema,
};
