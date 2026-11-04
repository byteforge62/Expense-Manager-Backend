require("dotenv").config({ path: ".env.e2e" });

const mongoose = require("mongoose");
const ExpenseModel = require("../src/models/ExpenseModel");
const IncomeModel = require("../src/models/IncomeModel");

const verifyIndexes = async () => {
  try {
    const mongoUri = process.env.MONGO_URI_E2E;

    if (!mongoUri) {
      throw new Error("MONGO_URI_E2E is not configured.");
    }

    await mongoose.connect(mongoUri);

    console.log("\nDATABASE DIAGNOSTICS:");
    console.log("Database name:", mongoose.connection.name);
    console.log("Expense collection:", ExpenseModel.collection.name);
    console.log("Income collection:", IncomeModel.collection.name);
    console.log("Mongoose autoIndex:", mongoose.get("autoIndex"));

    console.log("\nDECLARED SCHEMA INDEXES:");
    console.dir(ExpenseModel.schema.indexes(), { depth: null });
    console.dir(IncomeModel.schema.indexes(), { depth: null });

    console.log("\nDOCUMENT COUNTS:");
    console.log("Expenses:", await ExpenseModel.countDocuments());
    console.log("Income:", await IncomeModel.countDocuments());

    const expenseIndexes = await ExpenseModel.collection.indexes();
    const incomeIndexes = await IncomeModel.collection.indexes();

    console.log("\nEXPENSE INDEXES:");
    console.dir(expenseIndexes, { depth: null });

    console.log("\nINCOME INDEXES:");
    console.dir(incomeIndexes, { depth: null });

    const requiredIndexes = [
      {
        indexes: expenseIndexes,
        name: "unique_recurring_expense_occurrence",
      },
      {
        indexes: incomeIndexes,
        name: "unique_recurring_income_occurrence",
      },
    ];

    for (const item of requiredIndexes) {
      const index = item.indexes.find(
        (entry) => entry.name === item.name && entry.unique === true,
      );

      if (!index) {
        throw new Error(`Missing unique index: ${item.name}`);
      }

      console.log(`Verified: ${item.name}`);
    }

    console.log("\nAll recurring indexes verified.");
  } catch (error) {
    console.error("Index verification failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

verifyIndexes();
