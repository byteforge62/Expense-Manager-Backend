const RecurringModel = require("../models/RecurringModel");
const ExpenseModel = require("../models/ExpenseModel");
const IncomeModel = require("../models/IncomeModel");
const CategoryModel = require("../models/CategoryModel");

const addFrequency = (date, frequency) => {
  const next = new Date(date);

  switch (frequency) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;

    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      break;

    case "monthly": {
      const originalDay = next.getUTCDate();

      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);

      const lastDay = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
      ).getUTCDate();

      next.setUTCDate(Math.min(originalDay, lastDay));
      break;
    }

    case "yearly": {
      const originalMonth = next.getUTCMonth();
      const originalDay = next.getUTCDate();

      next.setUTCDate(1);
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      next.setUTCMonth(originalMonth);

      const lastDay = new Date(
        Date.UTC(next.getUTCFullYear(), originalMonth + 1, 0),
      ).getUTCDate();

      next.setUTCDate(Math.min(originalDay, lastDay));
      break;
    }

    default:
      throw new Error(`Unsupported recurring frequency: ${frequency}`);
  }

  return next;
};

const createExpenseOccurrence = async (recurring, occurrenceDate) => {
  const category = await CategoryModel.findOne({
    name: recurring.category.trim(),
    type: "expense",
  }).select("_id");

  if (!category) {
    throw new Error(
      `Expense category "${recurring.category}" was not found for recurring schedule ${recurring._id}`,
    );
  }

  await ExpenseModel.updateOne(
    {
      userID: recurring.userId,
      recurringId: recurring._id,
      recurringOccurrenceDate: occurrenceDate,
    },
    {
      $setOnInsert: {
        userID: recurring.userId,
        categoryID: category._id,
        amount: recurring.amount,
        date: occurrenceDate,
        description: recurring.title,
        recurringId: recurring._id,
        recurringOccurrenceDate: occurrenceDate,
      },
    },
    {
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: false,
    },
  );
};

const createIncomeOccurrence = async (recurring, occurrenceDate) => {
  await IncomeModel.updateOne(
    {
      userID: recurring.userId,
      recurringId: recurring._id,
      recurringOccurrenceDate: occurrenceDate,
    },
    {
      $setOnInsert: {
        userID: recurring.userId,
        amount: recurring.amount,
        source: recurring.title,
        date: occurrenceDate,
        recurringId: recurring._id,
        recurringOccurrenceDate: occurrenceDate,
      },
    },
    {
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: false,
    },
  );
};

const createOccurrence = async (recurring, occurrenceDate) => {
  if (recurring.type === "EXPENSE") {
    await createExpenseOccurrence(recurring, occurrenceDate);
    return;
  }

  if (recurring.type === "INCOME") {
    await createIncomeOccurrence(recurring, occurrenceDate);
    return;
  }

  throw new Error(
    `Recurring schedule ${recurring._id} has an unsupported type`,
  );
};

const processRecurringSchedule = async (initialSchedule, now) => {
  let schedule = initialSchedule;
  let generated = 0;

  while (
    schedule &&
    schedule.isActive &&
    new Date(schedule.nextDate).getTime() <= now.getTime()
  ) {
    const occurrenceDate = new Date(schedule.nextDate);

    // Idempotent creation: retrying this occurrence cannot create a duplicate.
    await createOccurrence(schedule, occurrenceDate);

    const nextDate = addFrequency(occurrenceDate, schedule.frequency);

    // Advance only if this worker still owns the current occurrence.
    const advancedSchedule = await RecurringModel.findOneAndUpdate(
      {
        _id: schedule._id,
        userId: schedule.userId,
        isActive: true,
        nextDate: occurrenceDate,
      },
      {
        $set: {
          nextDate,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (advancedSchedule) {
      schedule = advancedSchedule;
      generated += 1;
      continue;
    }

    // Another worker may have advanced or disabled this schedule.
    schedule = await RecurringModel.findById(schedule._id);
  }

  return generated;
};

const processDueRecurringTransactions = async (now = new Date()) => {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("A valid processing date is required.");
  }

  const dueSchedules = await RecurringModel.find({
    isActive: true,
    type: { $in: ["INCOME", "EXPENSE"] },
    nextDate: {
      $lte: now,
    },
  }).sort({
    nextDate: 1,
  });

  const result = {
    schedulesChecked: dueSchedules.length,
    occurrencesGenerated: 0,
    failures: [],
  };

  for (const schedule of dueSchedules) {
    try {
      result.occurrencesGenerated += await processRecurringSchedule(
        schedule,
        now,
      );
    } catch (error) {
      result.failures.push({
        recurringId: schedule._id.toString(),
        message: error.message,
      });
    }
  }

  return result;
};

module.exports = {
  addFrequency,
  processRecurringSchedule,
  processDueRecurringTransactions,
};
