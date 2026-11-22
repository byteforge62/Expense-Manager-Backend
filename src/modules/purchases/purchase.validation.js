const { z } = require("zod");
const { objectIdSchema } = require("../../validations/common.validation");

/**
 * Purchase record request contracts.
 *
 * `syncExpense` / `expenseCategoryID` control the optional financial link:
 * the purchase log always saves, and the expense is created only when the
 * client explicitly asks for it.
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

const PURCHASE_STATUSES = [
  "ORDERED",
  "SHIPPED",
  "DELIVERED",
  "RETURNED",
  "CANCELLED",
];

const purchaseFields = {
  name: z
    .string()
    .trim()
    .min(2, "Product name must contain at least 2 characters")
    .max(160),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(80).optional(),
  merchant: z.string().trim().max(120).optional(),
  sourceWebsite: z.string().trim().max(200).optional(),
  productUrl: httpUrlSchema.optional(),
  imageUrl: httpUrlSchema.optional(),
  unitPrice: z.coerce
    .number()
    .finite()
    .min(0, "Price cannot be negative"),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1").max(9999),
  // Deliberately no currency field: purchase totals are aggregated into INR
  // reports, so accepting another currency here would mix units silently.
  purchaseDate: z.coerce.date().optional(),
  orderId: z.string().trim().max(120).optional(),
  paymentMethod: z.string().trim().max(60).optional(),
  warrantyUntil: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(PURCHASE_STATUSES).optional(),
  syncExpense: z.boolean().optional(),
  expenseCategoryID: objectIdSchema.optional(),
};

const createPurchaseSchema = z
  .object({
    ...purchaseFields,
    unitPrice: z.coerce
      .number()
      .finite()
      .positive("Price must be greater than 0"),
    quantity: z.coerce.number().int().min(1).max(9999).default(1),
    // A category is required to book an expense, so asking for a link
    // without one is rejected up front instead of silently ignored.
    syncExpense: z.boolean().optional(),
    expenseCategoryID: objectIdSchema.optional(),
  })
  .strict()
  .refine(
    (value) => !value.syncExpense || Boolean(value.expenseCategoryID),
    {
      path: ["expenseCategoryID"],
      message:
        "Choose an expense category to record this purchase as spending",
    },
  );

const updatePurchaseSchema = z
  .object({
    ...purchaseFields,
    // Every field is optional on update; the shared field map marks `name` as
    // required for creation, so it is relaxed explicitly here.
    name: z.string().trim().min(2, "Product name must contain at least 2 characters").max(160).optional(),
    unitPrice: z.coerce.number().finite().min(0).optional(),
    quantity: z.coerce.number().int().min(1).max(9999).optional(),
    status: z.enum(PURCHASE_STATUSES).optional(),
    // `null` explicitly removes the stored value (e.g. clearing a URL).
    productUrl: httpUrlSchema.nullable().optional(),
    imageUrl: httpUrlSchema.nullable().optional(),
    orderId: z.string().trim().max(120).nullable().optional(),
    warrantyUntil: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const purchaseListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(80).optional(),
  merchant: z.string().trim().max(120).optional(),
  status: z.enum(PURCHASE_STATUSES).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sortBy: z.enum(["purchaseDate", "totalAmount", "createdAt"]).default("purchaseDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const purchaseSummaryQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(80).optional(),
  merchant: z.string().trim().max(120).optional(),
  status: z.enum(PURCHASE_STATUSES).optional(),
});

const purchaseIdParamSchema = z.object({ id: objectIdSchema });

module.exports = {
  createPurchaseSchema,
  updatePurchaseSchema,
  purchaseListQuerySchema,
  purchaseSummaryQuerySchema,
  purchaseIdParamSchema,
  PURCHASE_STATUSES,
};
