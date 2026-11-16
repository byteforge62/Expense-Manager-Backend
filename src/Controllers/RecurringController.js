const { asyncHandler } = require("../utiles/response");
const RecurringService = require("../services/recurring.service");
const { sendSuccess } = require("../utiles/response");

const createRecurring = asyncHandler(async (req, res) => {
  const recurring = await RecurringService.createRecurring(
    req.body,
    req.user.id,
    { requestId: req.id },
  );

  return sendSuccess(res, 201, "Recurring transaction created", recurring);
});

const getRecurringByUser = asyncHandler(async (req, res) => {
  const { items, meta } = await RecurringService.getRecurringByUser(
    req.user.id,
    { ...req.query, requestId: req.id },
  );

  return sendSuccess(
    res,
    200,
    "Recurring transactions fetched successfully",
    items,
    meta,
  );
});

const deleteRecurring = asyncHandler(async (req, res) => {
  await RecurringService.deleteRecurring(req.params.id, req.user.id, {
    requestId: req.id,
  });

  return sendSuccess(
    res,
    200,
    "Recurring transaction deleted"
  );
});

const updateRecurring = asyncHandler(async (req, res) => {
  const recurring = await RecurringService.updateRecurring(
    req.params.id,
    req.body,
    req.user.id,
    { requestId: req.id },
  );

  return sendSuccess(res, 200, "Recurring updated successfully", recurring);
});

const getUpcomingRecurring = asyncHandler(async (req, res) => {
  const upcoming = await RecurringService.getUpcomingRecurring(
    req.user.id,
    req.query.limit,
  );

  return sendSuccess(
    res,
    200,
    "Upcoming recurring transactions fetched successfully",
    upcoming,
  );
});

const toggleRecurringStatus = asyncHandler(async (req, res) => {
  const recurring = await RecurringService.toggleRecurringStatus(
    req.params.id,
    req.user.id,
    { requestId: req.id },
  );

  return sendSuccess(res, 200, "Recurring status updated", recurring);
});

module.exports = {
  createRecurring,
  getRecurringByUser,
  deleteRecurring,
  updateRecurring,
  getUpcomingRecurring,
  toggleRecurringStatus,
};
