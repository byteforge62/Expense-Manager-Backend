
const cron = require("node-cron");
const {
  processDueRecurringTransactions,
} = require("../services/recurring-engine.service");

cron.schedule("0 0 * * *", async () => {
  try {
    const result = await processDueRecurringTransactions();

    console.info("Recurring transaction processing completed", {
      schedulesChecked: result.schedulesChecked,
      occurrencesGenerated: result.occurrencesGenerated,
      failures: result.failures.length,
    });

    if (result.failures.length > 0) {
      console.error(
        "Recurring transaction processing failures:",
        result.failures,
      );
    }
  } catch (error) {
    console.error("Recurring transaction cron failed:", error);
  }
});

module.exports = {
  processDueRecurringTransactions,
};
