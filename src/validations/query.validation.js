const { z } = require("zod");
const { objectIdSchema } = require("./common.validation");

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(200).optional(),
});

/**
 * Shared pagination + filtering contract for list endpoints.
 *
 * `sortBy` is restricted per endpoint so a caller can never force an
 * unindexed sort or inject a sort specification.
 */
const baseListQuery = {
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  // No defaults here on purpose: their absence is what selects the legacy
  // (full-array, capped) response mode that the current frontend expects.
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(256).optional(),
  search: z.string().trim().max(200).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
};

const expensesListQuerySchema = z.object({
  ...baseListQuery,
  categoryID: objectIdSchema.optional(),
  minAmount: z.coerce.number().finite().min(0).optional(),
  maxAmount: z.coerce.number().finite().min(0).optional(),
  sortBy: z.enum(["date", "amount", "createdAt"]).default("date"),
});

const incomeListQuerySchema = z.object({
  ...baseListQuery,
  sortBy: z.enum(["date", "amount", "createdAt"]).default("date"),
});

const transactionsListQuerySchema = z.object({
  ...baseListQuery,
  type: z.enum(["Income", "Expense"]).optional(),
  sortBy: z.enum(["date", "amount", "createdAt"]).default("date"),
});

const billsListQuerySchema = z.object({
  ...baseListQuery,
  status: z.enum(["pending", "paid"]).optional(),
  dueBefore: z.coerce.date().optional(),
  dueAfter: z.coerce.date().optional(),
  sortBy: z.enum(["dueDate", "amount", "createdAt"]).default("dueDate"),
});

const budgetsListQuerySchema = z.object({
  ...baseListQuery,
  categoryID: objectIdSchema.optional(),
  activeOn: z.coerce.date().optional(),
  sortBy: z.enum(["start_date", "amount", "createdAt"]).default("start_date"),
});

const recurringListQuerySchema = z.object({
  ...baseListQuery,
  isActive: z.enum(["true", "false"]).optional(),
  type: z.enum(["INCOME", "EXPENSE", "UNCLASSIFIED"]).optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  sortBy: z.enum(["nextDate", "amount", "createdAt"]).default("nextDate"),
});

const notificationsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.enum(["true", "false"]).optional(),
  category: z
    .enum(["budget", "bill", "recurring", "anomaly", "recommendation", "system"])
    .optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

const summariesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(366).default(31),
});

module.exports = {
  paginationQuerySchema,
  expensesListQuerySchema,
  incomeListQuerySchema,
  transactionsListQuerySchema,
  billsListQuerySchema,
  budgetsListQuerySchema,
  recurringListQuerySchema,
  notificationsListQuerySchema,
  summariesQuerySchema,
};
