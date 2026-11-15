const RecurringModel = require("../models/RecurringModel");
const NotFoundError = require("../errors/NotFoundError");
const ForbiddenError = require("../errors/ForbiddenError");
const audit = require("../infrastructure/audit/audit.service");
const { executeListQuery, buildSort } = require("../utiles/list-query");

/**
 * Recurring schedule management.
 *
 * Execution itself lives in the automation layer; this service only owns CRUD
 * and the recurrence anchors that keep month-end and leap-year dates stable.
 */

const RECURRING_LIST_PROJECTION =
  "title amount category type frequency nextDate recurrenceAnchorDay recurrenceAnchorMonth isActive endDate createdAt updatedAt";

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

const createRecurring = async (data, userId, context = {}) => {
  const anchors = getRecurrenceAnchors(data.nextDate);

  const recurring = await RecurringModel.create({
    ...data,
    ...anchors,
    userId,
  });

  audit.record({
    userID: userId,
    action: "recurring.created",
    description: "Recurring schedule created",
    requestId: context.requestId,
    metadata: { recurringId: String(recurring._id) },
  });

  return recurring;
};

const buildRecurringFilter = (userId, filter = {}) => {
  const query = { userId };

  if (filter.isActive !== undefined) {
    query.isActive = filter.isActive === "true";
  }

  if (filter.type) {
    query.type = filter.type;
  }

  if (filter.frequency) {
    query.frequency = filter.frequency;
  }

  return query;
};

const getRecurringByUser = async (userId, filter = {}) =>
  executeListQuery({
    model: RecurringModel,
    filter: buildRecurringFilter(userId, filter),
    select: RECURRING_LIST_PROJECTION,
    sort: buildSort(filter.sortBy, filter.sortOrder, "nextDate"),
    params: filter,
  });

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

const deleteRecurring = async (id, userId, context = {}) => {
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

  audit.record({
    userID: userId,
    action: "recurring.deleted",
    description: "Recurring schedule deleted",
    requestId: context.requestId,
    metadata: { recurringId: String(recurring._id) },
  });

  return recurring;
};

const updateRecurring = async (id, data, userId, context = {}) => {
  const recurring = await findOwnedRecurringOrThrow(id, userId, "update");

  const updateData = { ...data };

  if (Object.prototype.hasOwnProperty.call(data, "nextDate")) {
    Object.assign(updateData, getRecurrenceAnchors(data.nextDate));
  } else {
    // Backfill anchors for legacy schedules without changing their dates.
    const fallbackAnchors = getRecurrenceAnchors(recurring.nextDate);

    updateData.recurrenceAnchorDay =
      recurring.recurrenceAnchorDay ?? fallbackAnchors.recurrenceAnchorDay;

    updateData.recurrenceAnchorMonth =
      recurring.recurrenceAnchorMonth ?? fallbackAnchors.recurrenceAnchorMonth;
  }

  const updated = await RecurringModel.findOneAndUpdate(
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

  audit.record({
    userID: userId,
    action: "recurring.updated",
    description: "Recurring schedule updated",
    requestId: context.requestId,
    metadata: { recurringId: String(id), fields: Object.keys(data) },
  });

  return updated;
};

const getUpcomingRecurring = async (userId, limit = 5) => {
  return RecurringModel.find({
    userId,
    isActive: true,
    nextDate: {
      $gte: new Date(),
    },
  })
    .select(RECURRING_LIST_PROJECTION)
    .sort({ nextDate: 1, _id: 1 })
    .limit(Math.min(Number(limit) || 5, 100))
    .lean();
};

const toggleRecurringStatus = async (id, userId, context = {}) => {
  const recurring = await findOwnedRecurringOrThrow(id, userId, "update");

  recurring.isActive = !recurring.isActive;

  await recurring.save();

  audit.record({
    userID: userId,
    action: "recurring.toggled",
    description: `Recurring schedule ${recurring.isActive ? "activated" : "deactivated"}`,
    requestId: context.requestId,
    metadata: { recurringId: String(recurring._id) },
  });

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
