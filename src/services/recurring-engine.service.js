const RecurringModel = require("../models/RecurringModel");
const ExpenseModel = require("../models/ExpenseModel");
const IncomeModel = require("../models/IncomeModel");
const CategoryModel = require("../models/CategoryModel");

/**
 * Recurring transaction engine.
 *
 * Correctness properties (unchanged from the original implementation):
 * - an occurrence is written with an upsert behind the
 *   (userID, recurringId, recurringOccurrenceDate) unique index, so retries
 *   cannot duplicate a financial record;
 * - the schedule is advanced with a conditional update on the exact
 *   occurrence date it owned, so two workers cannot both advance it.
 *
 * Added in this revision:
 * - optional `endDate` support: after the final occurrence the schedule is
 *   deactivated instead of silently continuing forever;
 * - an observation hook so automation can publish one event per generated
 *   occurrence (summaries, notifications, live clients) without changing the
 *   returned counters.
 */

const getAnchorDay = (date, schedule = {}) => {
  const anchorDay = Number(schedule.recurrenceAnchorDay);

  return Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31
    ? anchorDay
    : date.getUTCDate();
};

const getAnchorMonth = (date, schedule = {}) => {
  const anchorMonth = Number(schedule.recurrenceAnchorMonth);

  return Number.isInteger(anchorMonth) && anchorMonth >= 0 && anchorMonth <= 11
    ? anchorMonth
    : date.getUTCMonth();
};

const getLastDayOfMonth = (year, month) => {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
};

const addFrequency = (date, frequency, schedule = {}) => {
  const next = new Date(date);

  if (Number.isNaN(next.getTime())) {
    throw new TypeError("A valid recurrence date is required");
  }

  switch (frequency) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;

    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      break;

    case "monthly": {
      const anchorDay = getAnchorDay(next, schedule);

      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);

      const lastDay = getLastDayOfMonth(
        next.getUTCFullYear(),
        next.getUTCMonth(),
      );

      next.setUTCDate(Math.min(anchorDay, lastDay));
      break;
    }

    case "yearly": {
      const anchorDay = getAnchorDay(next, schedule);
      const anchorMonth = getAnchorMonth(next, schedule);
      const targetYear = next.getUTCFullYear() + 1;

      const lastDay = getLastDayOfMonth(targetYear, anchorMonth);

      next.setUTCFullYear(targetYear);
      next.setUTCMonth(anchorMonth);
      next.setUTCDate(Math.min(anchorDay, lastDay));
      break;
    }

    default:
      throw new TypeError(`Unsupported recurring frequency: ${frequency}`);
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

  const result = await ExpenseModel.updateOne(
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

  return {
    categoryID: category._id,
    transactionId: result?.upsertedId || null,
  };
};

const createIncomeOccurrence = async (recurring, occurrenceDate) => {
  const result = await IncomeModel.updateOne(
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

  return {
    categoryID: null,
    transactionId: result?.upsertedId || null,
  };
};

const createOccurrence = async (recurring, occurrenceDate) => {
  if (recurring.type === "EXPENSE") {
    return createExpenseOccurrence(recurring, occurrenceDate);
  }

  if (recurring.type === "INCOME") {
    return createIncomeOccurrence(recurring, occurrenceDate);
  }

  throw new Error(
    `Recurring schedule ${recurring._id} has an unsupported type`,
  );
};

/**
 * Stops a schedule that has passed its end date. Conditional on the current
 * occurrence so a concurrent worker cannot be clobbered.
 */
const deactivateCompletedSchedule = async (schedule, occurrenceDate) => {
  const updated = await RecurringModel.findOneAndUpdate(
    {
      _id: schedule._id,
      userId: schedule.userId,
      isActive: true,
      nextDate: occurrenceDate,
    },
    { $set: { isActive: false } },
    { new: true },
  );

  return updated || RecurringModel.findById(schedule._id);
};

const processRecurringSchedule = async (initialSchedule, now, hooks = {}) => {
  let schedule = initialSchedule;
  let generated = 0;

  while (
    schedule &&
    schedule.isActive &&
    new Date(schedule.nextDate).getTime() <= now.getTime()
  ) {
    const occurrenceDate = new Date(schedule.nextDate);
    const endDate = schedule.endDate ? new Date(schedule.endDate) : null;

    // Completed schedule: stop generating and deactivate it once.
    if (endDate && occurrenceDate.getTime() > endDate.getTime()) {
      schedule = await deactivateCompletedSchedule(schedule, occurrenceDate);

      if (schedule && schedule.isActive) {
        // Lost the race to another worker that also tried to deactivate.
        break;
      }

      break;
    }

    // Idempotent creation: retrying this occurrence cannot create a duplicate.
    const created = await createOccurrence(schedule, occurrenceDate);

    if (typeof hooks.onOccurrence === "function") {
      try {
        await hooks.onOccurrence({
          userId: schedule.userId,
          recurringId: schedule._id,
          type: schedule.type,
          title: schedule.title,
          amount: schedule.amount,
          categoryID: created.categoryID,
          transactionId: created.transactionId,
          occurrenceDate,
        });
      } catch {
        // Observation only: the financial record is already persisted and the
        // schedule must still advance.
      }
    }

    const nextDate = addFrequency(
      occurrenceDate,
      schedule.frequency,
      schedule,
    );

    if (nextDate.getTime() <= occurrenceDate.getTime()) {
      // Defensive: never loop on a non-advancing recurrence rule.
      throw new TypeError(
        `Recurrence for schedule ${schedule._id} did not advance`,
      );
    }

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

const processDueRecurringTransactions = async (now = new Date(), hooks = {}) => {
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
        hooks,
      );
    } catch (error) {
      result.failures.push({
        recurringId: schedule._id.toString(),
        userId: schedule.userId ? schedule.userId.toString() : null,
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
