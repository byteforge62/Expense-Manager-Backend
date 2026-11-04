
const mongoose = require("mongoose");
const ExpenseModel = require("../../src/models/ExpenseModel");
const IncomeModel = require("../../src/models/IncomeModel");

describe("Recurring transaction unique indexes", () => {
    let userId;
    let recurringId;
    let categoryId;
    let occurrenceDate;

    beforeAll(async () => {
        // Ensure MongoDB has finished creating both unique indexes.
        await Promise.all([
            ExpenseModel.init(),
            IncomeModel.init(),
        ]);

        // Verify the indexes are actually installed before testing them.
        const [expenseIndexes, incomeIndexes] = await Promise.all([
            ExpenseModel.collection.indexes(),
            IncomeModel.collection.indexes(),
        ]);

        const expenseIndex = expenseIndexes.find(
            (index) => index.name === "unique_recurring_expense_occurrence",
        );

        const incomeIndex = incomeIndexes.find(
            (index) => index.name === "unique_recurring_income_occurrence",
        );

        expect(expenseIndex).toBeDefined();
        expect(expenseIndex.unique).toBe(true);

        expect(incomeIndex).toBeDefined();
        expect(incomeIndex.unique).toBe(true);
    }, 30000);

    beforeEach(async () => {
        userId = new mongoose.Types.ObjectId();
        recurringId = new mongoose.Types.ObjectId();
        categoryId = new mongoose.Types.ObjectId();
        occurrenceDate = new Date("2026-11-04T00:00:00.000Z");

        await Promise.all([
            ExpenseModel.deleteMany({ userID: userId }),
            IncomeModel.deleteMany({ userID: userId }),
        ]);
    });

    afterAll(async () => {
        if (userId) {
            await Promise.all([
                ExpenseModel.deleteMany({ userID: userId }),
                IncomeModel.deleteMany({ userID: userId }),
            ]);
        }
    });

    test("prevents duplicate recurring expense occurrences", async () => {
        const document = {
            userID: userId,
            categoryID: categoryId,
            amount: 5000,
            date: occurrenceDate,
            description: "Monthly rent",
            recurringId,
            recurringOccurrenceDate: occurrenceDate,
        };

        const results = await Promise.allSettled([
            ExpenseModel.create(document),
            ExpenseModel.create(document),
        ]);

        const successful = results.filter(
            (result) => result.status === "fulfilled",
        );

        const failed = results.filter(
            (result) => result.status === "rejected",
        );

        expect(successful).toHaveLength(1);
        expect(failed).toHaveLength(1);
        expect(failed[0].reason.code).toBe(11000);

        const count = await ExpenseModel.countDocuments({
            userID: userId,
            recurringId,
            recurringOccurrenceDate: occurrenceDate,
        });

        expect(count).toBe(1);
    });

    test("prevents duplicate recurring income occurrences", async () => {
        const document = {
            userID: userId,
            amount: 50000,
            source: "Monthly salary",
            date: occurrenceDate,
            recurringId,
            recurringOccurrenceDate: occurrenceDate,
        };

        const results = await Promise.allSettled([
            IncomeModel.create(document),
            IncomeModel.create(document),
        ]);

        const successful = results.filter(
            (result) => result.status === "fulfilled",
        );

        const failed = results.filter(
            (result) => result.status === "rejected",
        );

        expect(successful).toHaveLength(1);
        expect(failed).toHaveLength(1);
        expect(failed[0].reason.code).toBe(11000);

        const count = await IncomeModel.countDocuments({
            userID: userId,
            recurringId,
            recurringOccurrenceDate: occurrenceDate,
        });

        expect(count).toBe(1);
    });

    test("allows ordinary expenses without recurring metadata", async () => {
        const document = {
            userID: userId,
            categoryID: categoryId,
            amount: 1000,
            date: occurrenceDate,
            description: "Regular purchase",
        };

        const results = await Promise.all([
            ExpenseModel.create(document),
            ExpenseModel.create(document),
        ]);

        expect(results).toHaveLength(2);

        const count = await ExpenseModel.countDocuments({
            userID: userId,
        });

        expect(count).toBe(2);
    });
});
