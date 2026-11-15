/**
 * Post-deployment backfill for derived data.
 *
 * Rebuilds financial summaries for every user and marks their financial
 * intelligence state dirty so the next refresh run recomputes it.
 *
 * Safe and idempotent: it only writes derived collections, never expenses,
 * incomes, budgets, bills or transactions.
 *
 * Usage:
 *   node scripts/backfill-derived-data.js                 # summaries + analytics
 *   node scripts/backfill-derived-data.js --indexes-only   # build indexes only
 *   node scripts/backfill-derived-data.js --limit 50      # cap users processed
 */
require("dotenv").config({ quiet: true });

if (process.env.NODE_ENV === "e2e") {
  require("dotenv").config({ path: ".env.e2e", override: true, quiet: true });
}

const mongoose = require("mongoose");
const UserModel = require("../src/models/UserModel");
const summaries = require("../src/modules/summaries/summaries.service");
const intelligenceRefresh = require("../src/modules/automation/intelligence-refresh.service");
const { mapWithConcurrency } = require("../src/infrastructure/queues/work-queue");
const logger = require("../src/infrastructure/logger");

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? Number(process.argv[index + 1]) || fallback : fallback;
};

const uri =
  process.env.MONGO_URI_E2E || process.env.MONGO_URI_TEST || process.env.MONGO_URI;

if (!uri) {
  console.error("No Mongo connection string configured.");
  process.exit(1);
}

const syncIndexes = async () => {
  const names = mongoose.modelNames();
  const results = [];

  for (const name of names) {
    try {
      await mongoose.model(name).createIndexes();
      results.push({ model: name, ok: true });
    } catch (error) {
      results.push({ model: name, ok: false, message: error.message });
    }
  }

  return results;
};

const main = async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const indexes = await syncIndexes();
  const failedIndexes = indexes.filter((entry) => !entry.ok);
  console.log(`Indexes ensured for ${indexes.length} models (${failedIndexes.length} failed).`);

  if (process.argv.includes("--indexes-only")) {
    await mongoose.disconnect();
    return;
  }

  const limit = argValue("limit", 1000);
  const users = await UserModel.find().select("_id").limit(limit).lean();

  const outcome = await mapWithConcurrency(users, 3, async (user) => {
    await summaries.rebuildAllForUser(user._id);
    await intelligenceRefresh.markDirty(user._id, 1);
  });

  logger.info("backfill.completed", {
    users: users.length,
    succeeded: outcome.succeeded,
    failures: outcome.failures.length,
  });

  for (const failure of outcome.failures) {
    console.error("Backfill failure:", failure.error?.message);
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
