
const RecurringModel = require("../models/RecurringModel");
const NotFoundError = require("../errors/NotFoundError");
const ForbiddenError = require("../errors/ForbiddenError");

const getRecurrenceAnchors = (date) => {
  const scheduledDate = new Date(date);

  if (Number.isNaN(scheduledDate.getTime())) {
    throw new TypeError("A valid recurrence date is required");
  }

  return {
    recurrenceAnchorDay: scheduledDate.getUTCDate(),
    recurrenceAnchorMonth: scheduledDate.getUTCMonth(),
  };
};

const createRecurring = async (data, userId) => {
  const anchors = getRecurrenceAnchors(data.nextDate);

  return RecurringModel.create({
    ...data,
    ...anchors,
    userId,
  });
};

const getRecurringByUser = async (userId) => {
  return RecurringModel.find({ userId });
};

const findOwnedRecurringOrThrow = async (id, userId, action) => {
  const recurring = await RecurringModel.findOne({
    _id: id,
    userId,
  });

  if (recurring) {
    return recurring;
  }

  const exists = await RecurringModel.exists({ _id: id });

  if (!exists) {
    throw new NotFoundError("Recurring transaction not found");
  }

  throw new ForbiddenError(
    `You are not authorized to ${action} this recurring transaction`,
  );
};

const deleteRecurring = async (id, userId) => {
  const recurring = await RecurringModel.findOneAndDelete({
    _id: id,
    userId,
  });

  if (!recurring) {
    const exists = await RecurringModel.exists({ _id: id });

    if (!exists) {
      throw new NotFoundError("Recurring transaction not found");
    }

    throw new ForbiddenError(
      "You are not authorized to delete this recurring transaction",
    );
  }
};

const updateRecurring = async (id, data, userId) => {
  const recurring = await findOwnedRecurringOrThrow(
    id,
    userId,
    "update",
  );

  const updateData = { ...data };

  if (Object.prototype.hasOwnProperty.call(data, "nextDate")) {
    Object.assign(
      updateData,
      getRecurrenceAnchors(data.nextDate),
    );
  } else {
    // Backfill anchors for legacy schedules without changing their dates.
    const fallbackDate = recurring.nextDate;
    const fallbackAnchors = getRecurrenceAnchors(fallbackDate);

    updateData.recurrenceAnchorDay =
      recurring.recurrenceAnchorDay ??
      fallbackAnchors.recurrenceAnchorDay;

    updateData.recurrenceAnchorMonth =
      recurring.recurrenceAnchorMonth ??
      fallbackAnchors.recurrenceAnchorMonth;
  }

  return RecurringModel.findOneAndUpdate(
    {
      _id: id,
      userId,
    },
    {
      $set: updateData,
    },
    {
      new: true,
      runValidators: true,
    },
  );
};

const getUpcomingRecurring = async (userId) => {
  return RecurringModel.find({
    userId,
    nextDate: {
      $gte: new Date(),
    },
  })
    .sort({ nextDate: 1 })
    .limit(5);
};

const toggleRecurringStatus = async (id, userId) => {
  const recurring = await findOwnedRecurringOrThrow(
    id,
    userId,
    "update",
  );

  recurring.isActive = !recurring.isActive;

  await recurring.save();

  return recurring;
};

module.exports = {
  createRecurring,
  getRecurringByUser,
  deleteRecurring,
  updateRecurring,
  getUpcomingRecurring,
  toggleRecurringStatus,
};
