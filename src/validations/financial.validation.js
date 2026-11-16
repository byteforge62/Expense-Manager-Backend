const { z } = require("zod");
const { objectIdSchema } = require("./common.validation");

/**
 * Validation schemas for the money-moving records: expenses, income,
 * transactions, bills, budgets, recurring schedules and categories.
 *
 * These are grouped in one feature-level module because they share primitives
 * (`objectIdSchema`, amounts, dates) and are always evolved together; each
 * schema keeps the exact messages and strictness it had when it lived alone.
 */

// --- Expenses ---

const createExpenseSchema = z.object({
  categoryID: objectIdSchema,

  amount: z.coerce.number().positive("Amount must be greater than 0"),

  description: z
    .string()
    .trim()
    .max(500, "Description cannot exceed 500 characters")
    .optional(),

  date: z.coerce.date().optional(),
});

const updateExpenseSchema = z.object({
  categoryID: objectIdSchema.optional(),

  amount: z.coerce
    .number()
    .positive("Amount must be greater than 0")
    .optional(),

  description: z.string().trim().max(500).optional(),

  date: z.coerce.date().optional(),
});

// --- Income ---

const createIncomeSchema = z
  .object({
    amount: z.coerce
      .number()
      .finite()
      .positive("Amount must be greater than 0"),
    source: z.string().trim().max(100).optional(),
    date: z.coerce.date().optional(),
  })
  .strict();

// --- Transactions ---

const createTransactionSchema = z
  .object({
    type: z.enum(["Income", "Expense"]),
    amount: z.coerce
      .number()
      .finite()
      .positive("Amount must be greater than 0"),
    date: z.coerce.date().optional(),
    description: z.string().trim().max(500).optional(),
  })
  .strict();

// --- Bills ---

// Kept separate from `common.objectIdSchema` on purpose: bill settlement has
// always reported "Invalid MongoDB ID" rather than the shared message.
const billObjectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid MongoDB ID");

const createBillSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    dueDate: z.coerce.date(),
    amount: z.coerce.number().positive(),
    status: z.enum(["pending", "paid"]).optional(),
  })
  .strict();

const settleBillSchema = z
  .object({
    expenseId: billObjectIdSchema,
  })
  .strict();

// --- Budgets ---

const createBudgetSchema = z
  .object({
    categoryID: objectIdSchema,
    amount: z.coerce
      .number()
      .finite()
      .positive("Amount must be greater than 0"),
    description: z.string().trim().max(500).optional(),
    start_date: z.coerce.date().optional(),
    end_date: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.start_date && data.end_date && data.end_date < data.start_date) {
      ctx.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "End date must be after or equal to start date",
      });
    }
  });

// --- Recurring schedules ---

const recurringFields = {
  title: z.string().trim().min(1, "Title is required").max(100),

  amount: z.coerce
    .number()
    .finite()
    .positive("Amount must be greater than 0"),

  category: z.string().trim().min(1, "Category is required").max(100),

  type: z.enum(["INCOME", "EXPENSE"]),

  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),

  nextDate: z.coerce.date(),

  // Optional final occurrence. When set, the schedule deactivates itself once
  // the next occurrence would fall past this date.
  endDate: z.coerce.date().optional(),
};

const checkEndDate = (data, ctx) => {
  if (data.endDate && data.nextDate && data.endDate < data.nextDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "End date must be on or after the next occurrence date",
    });
  }
};

const createRecurringSchema = z
  .object(recurringFields)
  .strict()
  .superRefine(checkEndDate);

const updateRecurringSchema = z
  .object(recurringFields)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  })
  .superRefine(checkEndDate);

// --- Categories ---

const createCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Category name is required")
      .max(100, "Category name cannot exceed 100 characters"),
    type: z.enum(["income", "expense"]),
  })
  .strict();

module.exports = {
  createExpenseSchema,
  updateExpenseSchema,
  createIncomeSchema,
  createTransactionSchema,
  createBillSchema,
  settleBillSchema,
  createBudgetSchema,
  createRecurringSchema,
  updateRecurringSchema,
  createCategorySchema,
};
