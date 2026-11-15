/**
 * Performance benchmark.
 *
 * Measures, on one seeded dataset in a disposable benchmark database:
 *   1. the previous query shape ("legacy") versus the optimised services at the
 *      data layer, so the before/after comparison is on identical data;
 *   2. real HTTP latencies (P50/P95/P99), payload size and Mongo query count
 *      for the optimised endpoints.
 *
 * Usage: node scripts/benchmark-api.js [--expenses 3000] [--iterations 30]
 * Requires MONGO_URI_E2E or MONGO_URI_TEST; the database name is overridden by
 * BENCH_DB_NAME (default "<db>_bench") and dropped afterwards.
 *
 * NEVER point this at production: it writes and then drops the DB it names.
 */
require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const ExpenseModel = require("../src/models/ExpenseModel");
const IncomeModel = require("../src/models/IncomeModel");
const UserModel = require("../src/models/UserModel");
const CategoryModel = require("../src/models/CategoryModel");
const BudgetModel = require("../src/models/BudgetModel");
const BillModel = require("../src/models/BillModel");

const expenseService = require("../src/services/expense.service");
const incomeService = require("../src/services/income.service");
const summaries = require("../src/modules/summaries/summaries.service");

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? Number(process.argv[index + 1]) || fallback : fallback;
};

const EXPENSE_COUNT = argValue("expenses", 3000);
const INCOME_COUNT = argValue("incomes", 300);
const ITERATIONS = argValue("iterations", 30);
const WARMUP = 5;

const percentile = (sorted, value) => {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((value / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)];
};

let queryCount = 0;
mongoose.set("debug", () => {
  queryCount += 1;
});

const measure = async (fn, iterations = ITERATIONS) => {
  for (let i = 0; i < WARMUP; i += 1) {
    await fn();
  }

  const samples = [];
  queryCount = 0;

  for (let i = 0; i < iterations; i += 1) {
    const started = process.hrtime.bigint();
    const result = await fn();
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    samples.push(durationMs);

    if (i === iterations - 1) {
      samples.lastSize = result?.size ?? null;
    }
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;

  return {
    avgMs: round(avg),
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    p99Ms: round(percentile(sorted, 99)),
    queryCount: Math.round(queryCount / iterations),
    payloadBytes: samples.lastSize ?? null,
  };
};

const round = (value) => Math.round(value * 100) / 100;

const sizeOf = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * The previous implementations, reproduced exactly, so the comparison is
 * apples to apples on the same database.
 */
const legacy = {
  expenseList: async (userId) => {
    const docs = await ExpenseModel.find({ userID: userId })
      .populate("userID categoryID")
      .sort({ date: -1 });
    const plain = docs.map((doc) => doc.toObject());
    return { size: sizeOf(plain) };
  },
  incomeList: async (userId) => {
    const docs = await IncomeModel.find({ userID: userId });
    const plain = docs.map((doc) => doc.toObject());
    return { size: sizeOf(plain) };
  },
  totals: async (userId) => {
    const [expenses, incomes] = await Promise.all([
      ExpenseModel.find({ userID: userId }),
      IncomeModel.find({ userID: userId }),
    ]);
    const totalExpense = expenses.reduce((sum, item) => sum + item.amount, 0);
    const totalIncome = incomes.reduce((sum, item) => sum + item.amount, 0);
    return { size: sizeOf({ totalExpense, totalIncome, count: expenses.length }) };
  },
};

const optimized = {
  expenseList: async (userId) => {
    const result = await expenseService.getExpenseByUserId(userId, {});
    return { size: sizeOf(result.items) };
  },
  expensePage: async (userId) => {
    const result = await expenseService.getExpenseByUserId(userId, { page: 1, limit: 20 });
    return { size: sizeOf(result.items) };
  },
  incomeList: async (userId) => {
    const result = await incomeService.getIncomeByUserId(userId, {});
    return { size: sizeOf(result.items) };
  },
  totals: async (userId) => {
    const from = new Date(Date.now() - 365 * 86_400_000);
    const daily = await summaries.getSummaries(userId, { periodType: "daily", from, limit: 366 });
    const totals = daily.reduce(
      (acc, item) => ({
        totalExpense: acc.totalExpense + item.totalExpense,
        totalIncome: acc.totalIncome + item.totalIncome,
        count: acc.count + item.expenseCount,
      }),
      { totalExpense: 0, totalIncome: 0, count: 0 },
    );
    return { size: sizeOf(totals) };
  },
};

const seed = async (userId, categoryId) => {
  const now = Date.now();

  const expenses = Array.from({ length: EXPENSE_COUNT }, (_value, index) => ({
    userID: userId,
    categoryID: categoryId,
    amount: 50 + (index % 500),
    date: new Date(now - index * 3_600_000),
    description: `Benchmark expense ${index}`,
  }));

  for (let offset = 0; offset < expenses.length; offset += 1000) {
    await ExpenseModel.insertMany(expenses.slice(offset, offset + 1000), { ordered: false });
  }

  const incomes = Array.from({ length: INCOME_COUNT }, (_value, index) => ({
    userID: userId,
    amount: 1000 + index,
    source: `Benchmark income ${index}`,
    date: new Date(now - index * 86_400_000),
  }));

  await IncomeModel.insertMany(incomes, { ordered: false });

  await BudgetModel.create({
    userID: userId,
    categoryID: categoryId,
    amount: 50000,
    start_date: new Date(now - 30 * 86_400_000),
    end_date: new Date(now + 30 * 86_400_000),
  });

  await BillModel.create({
    userID: userId,
    name: "Benchmark bill",
    amount: 500,
    dueDate: new Date(now + 2 * 86_400_000),
    status: "pending",
  });
};

const httpBench = async (baseUrl, token) => {
  const call = async (url) => {
    const response = await fetch(`${baseUrl}${url}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`${url} -> ${response.status}`);
    }

    const text = await response.text();
    return { size: Buffer.byteLength(text, "utf8") };
  };

  const endpoints = [
    ["GET /api/expenses/me (legacy array)", "/api/expenses/me"],
    ["GET /api/expenses/me?page=1&limit=20", "/api/expenses/me?page=1&limit=20"],
    ["GET /api/expenses/me?limit=20&cursor=", "/api/expenses/me?limit=20&cursor="],
    ["GET /api/expenses/recent", "/api/expenses/recent"],
    ["GET /api/summaries/monthly", "/api/summaries/monthly"],
    ["GET /api/notifications?limit=20", "/api/notifications?limit=20"],
  ];

  const results = {};

  for (const [label, url] of endpoints) {
    results[label] = await measure(() => call(url), Math.min(ITERATIONS, 20));
  }

  return results;
};

const main = async () => {
  const baseUri = process.env.MONGO_URI_E2E || process.env.MONGO_URI_TEST;

  if (!baseUri) {
    throw new Error("MONGO_URI_E2E or MONGO_URI_TEST is required");
  }

  const dbName = process.env.BENCH_DB_NAME || "fintrack_benchmark";

  await mongoose.connect(baseUri, { dbName, serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  const user = await UserModel.create({
    name: "Benchmark User",
    email: `bench_${Date.now()}@example.com`,
    password: "not-used-by-benchmark",
    role: "User",
  });

  const category = await CategoryModel.create({
    name: `Benchmark Category ${Date.now()}`,
    type: "expense",
  });

  await seed(user._id, category._id);

  const dataLayer = {};

  for (const [label, fn] of [
    ["expense list (legacy query)", () => legacy.expenseList(user._id)],
    ["expense list (optimised)", () => optimized.expenseList(user._id)],
    ["expense page 20 (optimised)", () => optimized.expensePage(user._id)],
    ["income list (legacy query)", () => legacy.incomeList(user._id)],
    ["income list (optimised)", () => optimized.incomeList(user._id)],
  ]) {
    dataLayer[label] = await measure(fn, Math.min(ITERATIONS, 20));
  }

  // Totals comparison against a rebuilt summary (derived, bounded read).
  await summaries.rebuildAllForUser(user._id);
  dataLayer["totals (legacy in-memory reduce)"] = await measure(
    () => legacy.totals(user._id),
    Math.min(ITERATIONS, 10),
  );
  dataLayer["totals (derived summary read)"] = await measure(
    () => optimized.totals(user._id),
    Math.min(ITERATIONS, 10),
  );

  const app = require("../app");
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

  const token = jwt.sign({ id: user._id.toString(), role: "User" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  const http = await httpBench(`http://127.0.0.1:${port}`, token);

  server.close();

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: {
      expenses: EXPENSE_COUNT,
      incomes: INCOME_COUNT,
      iterations: ITERATIONS,
    },
    dataLayer,
    http,
  };

  const outDir = path.join(__dirname, "..", "benchmarks");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nSaved to ${outFile}`);

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
