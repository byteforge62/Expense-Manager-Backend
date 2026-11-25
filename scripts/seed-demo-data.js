const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const {
  DEMO_ACCOUNTS,
  seedDemoWorkspace,
} = require("../src/services/demo-data.service");

/**
 * Manual runner for the demo workspace.
 *
 *   npm run seed:demo            # create accounts + seed the demo ledger
 *   npm run seed:demo -- --reset # wipe the demo user's records first
 *
 * The same seeding also runs automatically when the development server starts.
 */

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data in production.");
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing from your .env file.");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS:
      Number(process.env.MONGO_SERVER_SELECTION_MS) || 10_000,
  });

  console.log("Connected to database.");

  const reset = process.argv.includes("--reset");
  const result = await seedDemoWorkspace({ reset });

  console.log("\nDemo accounts:");
  console.table(
    DEMO_ACCOUNTS.map((account) => ({
      email: account.email,
      password: account.password,
      role: account.role,
    })),
  );

  if (reset) {
    console.log(`Removed ${result.removed} previous records for the demo user.`);
  }

  if (result.seed.seeded) {
    console.log("\nDemo ledger inserted:");
    console.table(result.seed.counts);
  } else {
    console.log(
      `\nLedger not seeded: ${result.seed.reason} (${result.seed.counts?.expenses ?? 0} expenses already exist).`,
    );
  }

  console.log("\nOpen http://localhost:5174/login and sign in as either account.");
}

main()
  .catch((error) => {
    console.error("\nDemo seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
