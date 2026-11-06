
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const User = require("../src/models/UserModel");
const Income = require("../src/models/IncomeModel");
const Expense = require("../src/models/ExpenseModel");
const Category = require("../src/models/CategoryModel");

const MARKER = "FORECAST_TEST_SEED_V1";

const INCOME_RECORDS = [
  { daysAgo: 87, amount: 42000, source: "Salary payment" },
  { daysAgo: 75, amount: 8500, source: "Freelance project" },
  { daysAgo: 63, amount: 42000, source: "Salary payment" },
  { daysAgo: 51, amount: 12000, source: "Website development" },
  { daysAgo: 39, amount: 44000, source: "Salary payment" },
  { daysAgo: 27, amount: 6500, source: "Freelance project" },
  { daysAgo: 15, amount: 44000, source: "Salary payment" },
  { daysAgo: 4, amount: 15000, source: "Freelance project" },
];

const EXPENSE_RECORDS = [
  { daysAgo: 88, amount: 4500, category: "Housing", description: "Monthly rent" },
  { daysAgo: 85, amount: 850, category: "Groceries", description: "Grocery shopping" },
  { daysAgo: 81, amount: 450, category: "Transport", description: "Fuel" },
  { daysAgo: 77, amount: 1200, category: "Utilities", description: "Electricity bill" },
  { daysAgo: 73, amount: 650, category: "Food", description: "Restaurant" },
  { daysAgo: 69, amount: 2200, category: "Shopping", description: "Clothing" },
  { daysAgo: 65, amount: 500, category: "Transport", description: "Cab expenses" },
  { daysAgo: 60, amount: 900, category: "Groceries", description: "Weekly groceries" },
  { daysAgo: 56, amount: 4500, category: "Housing", description: "Monthly rent" },
  { daysAgo: 52, amount: 750, category: "Food", description: "Dining out" },
  { daysAgo: 48, amount: 1100, category: "Utilities", description: "Internet and mobile" },
  { daysAgo: 44, amount: 1800, category: "Health", description: "Medical expenses" },
  { daysAgo: 40, amount: 600, category: "Transport", description: "Fuel" },
  { daysAgo: 36, amount: 950, category: "Groceries", description: "Grocery shopping" },
  { daysAgo: 32, amount: 4500, category: "Housing", description: "Monthly rent" },
  { daysAgo: 28, amount: 1400, category: "Shopping", description: "Household items" },
  { daysAgo: 24, amount: 550, category: "Food", description: "Restaurant" },
  { daysAgo: 20, amount: 700, category: "Transport", description: "Fuel" },
  { daysAgo: 16, amount: 1250, category: "Utilities", description: "Electricity and internet" },
  { daysAgo: 12, amount: 900, category: "Groceries", description: "Weekly groceries" },
  { daysAgo: 9, amount: 2100, category: "Health", description: "Healthcare expenses" },
  { daysAgo: 6, amount: 4500, category: "Housing", description: "Monthly rent" },
  { daysAgo: 3, amount: 850, category: "Food", description: "Dining out" },
  { daysAgo: 1, amount: 600, category: "Transport", description: "Local transport" },
];

function dateDaysAgo(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(12, 0, 0, 0);
  return date;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function removePreviousSeedData(userId) {
  const incomeResult = await Income.deleteMany({
    userID: userId,
    source: new RegExp(`^${MARKER}`),
  });

  const expenseResult = await Expense.deleteMany({
    userID: userId,
    description: new RegExp(`^${MARKER}`),
  });

  console.log("Previous generated records removed:", {
    income: incomeResult.deletedCount,
    expenses: expenseResult.deletedCount,
  });
}

async function seedForecastData() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed data in production.");
  }

  if (process.env.ALLOW_FORECAST_TEST_DATA !== "true") {
    throw new Error(
      "Set ALLOW_FORECAST_TEST_DATA=true in your environment before running this script."
    );
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing from your .env file.");
  }

  const userEmail = process.env.FORECAST_TEST_USER_EMAIL?.trim();

  if (!userEmail) {
    throw new Error(
      "Set FORECAST_TEST_USER_EMAIL to the email of your local test account."
    );
  }

  await mongoose.connect(process.env.MONGO_URI);

  console.log("Connected to development database.");

  const user = await User.findOne({
    email: new RegExp(`^${escapeRegex(userEmail)}$`, "i"),
  }).select("_id email");

  if (!user) {
    throw new Error(
      `No user found for ${userEmail}. Check your local database and email.`
    );
  }

  console.log("Target user:", user.email);
  console.log("Target user ID:", user._id.toString());

  const categoryNames = [
    ...new Set(EXPENSE_RECORDS.map((record) => record.category)),
  ];

  const categories = new Map();

  for (const name of categoryNames) {
    let category = await Category.findOne({
      name,
      type: "expense",
    });

    if (!category) {
      category = await Category.create({
        name,
        type: "expense",
      });
    }

    categories.set(name, category._id);
  }

  // Remove only records created by this script.
  // Genuine user transactions are not touched.
  await removePreviousSeedData(user._id);

  const incomes = INCOME_RECORDS.map((record) => ({
    userID: user._id,
    amount: record.amount,
    source: `${MARKER} | ${record.source}`,
    date: dateDaysAgo(record.daysAgo),
  }));

  const expenses = EXPENSE_RECORDS.map((record) => ({
    userID: user._id,
    categoryID: categories.get(record.category),
    amount: record.amount,
    date: dateDaysAgo(record.daysAgo),
    description: `${MARKER} | ${record.description}`,
  }));

  await Income.insertMany(incomes);
  await Expense.insertMany(expenses);

  console.log("\nForecast test data inserted successfully.");
  console.table({
    user: user.email,
    incomeRecords: incomes.length,
    expenseRecords: expenses.length,
    categories: categories.size,
    historicalWindow: "Previous 90 days",
  });

  console.log(
    "\nGenerated records are tagged with:",
    MARKER
  );

  console.log(
    "Run this script again to replace only its previously generated records."
  );
}

async function cleanupForecastData() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing cleanup in production.");
  }

  if (process.env.ALLOW_FORECAST_TEST_DATA !== "true") {
    throw new Error(
      "Set ALLOW_FORECAST_TEST_DATA=true before cleanup."
    );
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing.");
  }

  const userEmail = process.env.FORECAST_TEST_USER_EMAIL?.trim();

  if (!userEmail) {
    throw new Error("FORECAST_TEST_USER_EMAIL is missing.");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({
    email: new RegExp(`^${escapeRegex(userEmail)}$`, "i"),
  }).select("_id email");

  if (!user) {
    throw new Error("Target user was not found.");
  }

  console.log("Cleaning generated data for:", user.email);

  await removePreviousSeedData(user._id);

  console.log("Forecast test data cleanup completed.");
}

async function main() {
  try {
    if (process.argv.includes("--cleanup")) {
      await cleanupForecastData();
    } else {
      await seedForecastData();
    }
  } catch (error) {
    console.error("\nForecast seed operation failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

main();
