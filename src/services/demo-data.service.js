const bcrypt = require("bcrypt");

const UserModel = require("../models/UserModel");
const CategoryModel = require("../models/CategoryModel");
const ExpenseModel = require("../models/ExpenseModel");
const IncomeModel = require("../models/IncomeModel");
const BudgetModel = require("../models/BudgetModel");
const BillModel = require("../models/BillModel");
const RecurringModel = require("../models/RecurringModel");
const logger = require("../infrastructure/logger");

/**
 * --- DEVELOPMENT DEMO WORKSPACE ---
 *
 * Creates the two accounts the project is explored with and fills the normal
 * user's ledger with believable records, so every page (overview, expenses,
 * income, budgets, bills, recurring, reports, forecast) has something real to
 * render. Purchases are deliberately not seeded: that list only ever holds
 * records imported from the user's own store accounts.
 *
 * Safe to run on every server start:
 * - accounts are upserted by email and their passwords are only re-hashed when
 *   the required demo password no longer matches;
 * - the ledger is only seeded when the demo user has no expenses, so restarts
 *   never duplicate records.
 *
 * Never runs in production, test or e2e environments, and can be switched off
 * with SEED_DEMO_DATA=false.
 */

const BCRYPT_ROUNDS = 10;

const DEMO_ACCOUNTS = Object.freeze([
  Object.freeze({
    name: "Muhammad Patel",
    email: "patelmuhammad192@gmail.com",
    password: "Muhammad192",
    role: "User",
  }),
  Object.freeze({
    name: "Admin",
    email: "admin@fintrack.com",
    password: "Admin@192",
    role: "Admin",
  }),
]);

const DEMO_USER_EMAIL = DEMO_ACCOUNTS[0].email;

const EXPENSE_CATEGORIES = [
  "Housing",
  "Groceries",
  "Transport",
  "Utilities",
  "Food & Dining",
  "Shopping",
  "Health",
  "Entertainment",
  "Education",
];

const INCOME_CATEGORIES = ["Salary", "Freelance", "Investments"];

const INCOME_RECORDS = [
  { daysAgo: 4, amount: 85000, source: "Monthly salary" },
  { daysAgo: 18, amount: 18500, source: "Freelance project" },
  { daysAgo: 34, amount: 85000, source: "Monthly salary" },
  { daysAgo: 44, amount: 12000, source: "Website redesign" },
  { daysAgo: 64, amount: 85000, source: "Monthly salary" },
  { daysAgo: 70, amount: 1250, source: "Savings account interest" },
];

const EXPENSE_RECORDS = [
  { daysAgo: 1, category: "Food & Dining", amount: 640, description: "Dinner with family" },
  { daysAgo: 2, category: "Transport", amount: 420, description: "Cab to office" },
  { daysAgo: 3, category: "Groceries", amount: 3240, description: "Weekly grocery run" },
  { daysAgo: 5, category: "Utilities", amount: 999, description: "Internet bill" },
  { daysAgo: 6, category: "Shopping", amount: 3499, description: "Wireless headphones" },
  { daysAgo: 7, category: "Entertainment", amount: 499, description: "Streaming subscription" },
  { daysAgo: 9, category: "Health", amount: 1200, description: "Pharmacy" },
  { daysAgo: 10, category: "Food & Dining", amount: 1890, description: "Weekend lunch" },
  { daysAgo: 12, category: "Transport", amount: 1500, description: "Fuel" },
  { daysAgo: 14, category: "Groceries", amount: 2180, description: "Groceries" },
  { daysAgo: 16, category: "Utilities", amount: 2450, description: "Electricity bill" },
  { daysAgo: 18, category: "Shopping", amount: 1899, description: "Running shoes" },
  { daysAgo: 20, category: "Education", amount: 2000, description: "Online course" },
  { daysAgo: 22, category: "Food & Dining", amount: 850, description: "Dinner out" },
  { daysAgo: 24, category: "Health", amount: 2500, description: "Dental check-up" },
  { daysAgo: 26, category: "Transport", amount: 2100, description: "Bike service" },
  { daysAgo: 28, category: "Groceries", amount: 4150, description: "Monthly groceries" },
  { daysAgo: 30, category: "Housing", amount: 24000, description: "Monthly rent" },
  { daysAgo: 32, category: "Entertainment", amount: 1600, description: "Movie and dinner" },
  { daysAgo: 36, category: "Utilities", amount: 599, description: "Mobile recharge" },
  { daysAgo: 41, category: "Food & Dining", amount: 1240, description: "Lunch with colleagues" },
  { daysAgo: 46, category: "Groceries", amount: 2760, description: "Groceries" },
  { daysAgo: 52, category: "Transport", amount: 300, description: "Metro card recharge" },
  { daysAgo: 60, category: "Housing", amount: 24000, description: "Monthly rent" },
  { daysAgo: 66, category: "Utilities", amount: 2200, description: "Electricity bill" },
  { daysAgo: 74, category: "Shopping", amount: 2650, description: "Home essentials" },
];

const BUDGET_RECORDS = [
  { category: "Housing", amount: 25000 },
  { category: "Groceries", amount: 12000 },
  { category: "Transport", amount: 6000 },
  { category: "Food & Dining", amount: 8000 },
  { category: "Shopping", amount: 7000 },
  { category: "Utilities", amount: 5000 },
  { category: "Entertainment", amount: 3000 },
  { category: "Health", amount: 4000 },
];

const BILL_RECORDS = [
  { name: "Monthly rent", amount: 24000, dueInDays: 4 },
  { name: "Electricity bill", amount: 2450, dueInDays: 8 },
  { name: "Internet bill", amount: 999, dueInDays: 12 },
  { name: "Credit card payment", amount: 8500, dueInDays: 18 },
];

const RECURRING_RECORDS = [
  {
    title: "Monthly rent",
    amount: 24000,
    category: "Housing",
    type: "EXPENSE",
    frequency: "monthly",
    nextDate: 3,
  },
  {
    title: "Monthly salary",
    amount: 85000,
    category: "Salary",
    type: "INCOME",
    frequency: "monthly",
    nextDate: 28,
  },
  {
    title: "Streaming subscription",
    amount: 499,
    category: "Entertainment",
    type: "EXPENSE",
    frequency: "monthly",
    nextDate: 7,
  },
];

const daysAgo = (days, hour = 12) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date;
};

const daysAhead = (days, hour = 12) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
};

const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
};

const endOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
};

const ensureCategory = async (name, type) => {
  const existing = await CategoryModel.findOne({ name, type });

  if (existing) {
    return existing;
  }

  try {
    return await CategoryModel.create({ name, type });
  } catch (error) {
    // A concurrent seed created it between the read and the write.
    if (error?.code === 11000) {
      return CategoryModel.findOne({ name, type });
    }

    throw error;
  }
};

const ensureCategoryMap = async () => {
  const categories = new Map();

  for (const name of EXPENSE_CATEGORIES) {
    const category = await ensureCategory(name, "expense");
    categories.set(name, category._id);
  }

  for (const name of INCOME_CATEGORIES) {
    await ensureCategory(name, "income");
  }

  return categories;
};

const ensureDemoAccount = async (account) => {
  const email = account.email.trim().toLowerCase();
  let user = await UserModel.findOne({ email });

  if (!user) {
    const password = await bcrypt.hash(account.password, BCRYPT_ROUNDS);
    return UserModel.create({
      name: account.name,
      email,
      password,
      role: account.role,
      is_active: true,
    });
  }

  let changed = false;

  if (user.name !== account.name) {
    user.name = account.name;
    changed = true;
  }

  if (user.role !== account.role) {
    user.role = account.role;
    changed = true;
  }

  if (user.is_active === false) {
    user.is_active = true;
    changed = true;
  }

  const passwordMatches = await bcrypt.compare(account.password, user.password);

  if (!passwordMatches) {
    user.password = await bcrypt.hash(account.password, BCRYPT_ROUNDS);
    changed = true;
  }

  if (changed) {
    await user.save();
  }

  return user;
};

const resetDemoUserData = async (userId) => {
  const scopes = [
    ExpenseModel.deleteMany({ userID: userId }),
    IncomeModel.deleteMany({ userID: userId }),
    BudgetModel.deleteMany({ userID: userId }),
    BillModel.deleteMany({ userID: userId }),
    RecurringModel.deleteMany({ userId }),
  ];

  const results = await Promise.all(scopes);

  return results.reduce((deleted, result) => deleted + (result.deletedCount || 0), 0);
};

const seedDemoDataForUser = async (userId) => {
  const user = await UserModel.findById(userId).select("_id email role");

  if (!user) {
    throw new Error("Demo seed target user was not found.");
  }

  const existingExpenses = await ExpenseModel.countDocuments({ userID: userId });

  if (existingExpenses > 0) {
    return {
      seeded: false,
      reason: "already_has_expenses",
      counts: { expenses: existingExpenses },
    };
  }

  const categories = await ensureCategoryMap();
  const monthStart = startOfMonth();
  const monthEnd = endOfMonth();

  const incomes = INCOME_RECORDS.map((record) => ({
    userID: userId,
    amount: record.amount,
    source: record.source,
    date: daysAgo(record.daysAgo),
  }));

  const expenses = EXPENSE_RECORDS.map((record) => ({
    userID: userId,
    categoryID: categories.get(record.category),
    amount: record.amount,
    description: record.description,
    date: daysAgo(record.daysAgo),
  }));

  const budgets = BUDGET_RECORDS.map((record) => ({
    userID: userId,
    categoryID: categories.get(record.category),
    amount: record.amount,
    description: `${record.category} budget for this month`,
    start_date: monthStart,
    end_date: monthEnd,
  }));

  const bills = BILL_RECORDS.map((record) => ({
    userID: userId,
    name: record.name,
    amount: record.amount,
    dueDate: daysAhead(record.dueInDays),
    status: "pending",
  }));

  const recurring = RECURRING_RECORDS.map((record) => ({
    userId,
    title: record.title,
    amount: record.amount,
    category: record.category,
    type: record.type,
    frequency: record.frequency,
    nextDate: daysAhead(record.nextDate),
    isActive: true,
  }));

  const [insertedIncomes, insertedExpenses, insertedBudgets, insertedBills, insertedRecurring] =
    await Promise.all([
      IncomeModel.insertMany(incomes),
      ExpenseModel.insertMany(expenses),
      BudgetModel.insertMany(budgets),
      BillModel.insertMany(bills),
      RecurringModel.insertMany(recurring),
    ]);

  return {
    seeded: true,
    counts: {
      categories: categories.size,
      incomes: insertedIncomes.length,
      expenses: insertedExpenses.length,
      budgets: insertedBudgets.length,
      bills: insertedBills.length,
      recurring: insertedRecurring.length,
    },
  };
};

/**
 * Ensures both demo accounts exist and the normal user has a demo ledger.
 * `reset` is only used by the manual CLI script.
 */
const seedDemoWorkspace = async ({ reset = false } = {}) => {
  const accounts = [];

  for (const account of DEMO_ACCOUNTS) {
    accounts.push(await ensureDemoAccount(account));
  }

  const demoUser = accounts.find(
    (account) => account.email.toLowerCase() === DEMO_USER_EMAIL,
  );

  if (!demoUser) {
    throw new Error("Demo user account could not be created.");
  }

  const removed = reset ? await resetDemoUserData(demoUser._id) : 0;
  const seed = await seedDemoDataForUser(demoUser._id);

  return {
    removed,
    accounts: accounts.map((account) => ({
      email: account.email,
      role: account.role,
    })),
    seed,
  };
};

/**
 * Called from server.js after the database connection is ready. It never
 * throws: a seed failure must not stop the API from starting.
 */
const seedDemoWorkspaceOnStartup = async () => {
  const environment = process.env.NODE_ENV || "development";

  if (environment !== "development") {
    return { skipped: true, reason: `environment:${environment}` };
  }

  if (process.env.SEED_DEMO_DATA === "false") {
    return { skipped: true, reason: "SEED_DEMO_DATA=false" };
  }

  try {
    const result = await seedDemoWorkspace();

    logger.info("demo_seed.completed", {
      accounts: result.accounts.length,
      seeded: result.seed.seeded,
      reason: result.seed.reason,
      counts: result.seed.counts,
    });

    return result;
  } catch (error) {
    logger.warn("demo_seed.failed", { error });
    return { skipped: true, reason: "failed" };
  }
};

module.exports = {
  DEMO_ACCOUNTS,
  DEMO_USER_EMAIL,
  seedDemoDataForUser,
  seedDemoWorkspace,
  seedDemoWorkspaceOnStartup,
  resetDemoUserData,
};
