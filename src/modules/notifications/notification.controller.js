const asyncHandler = require("../../middleware/asyncHandler");
const { sendSuccess } = require("../../utiles/response");
const { resolvePagination, buildPaginationMeta } = require("../../utiles/pagination");
const notificationService = require("./notification.service");

const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit } = resolvePagination(req.query);
  const { items, total } = await notificationService.listNotifications(req.user.id, {
    ...req.query,
    page,
    limit,
  });

  return sendSuccess(
    res,
    200,
    "Notifications fetched successfully",
    items,
    buildPaginationMeta({ page, limit, total, requestId: req.id }),
  );
});

const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.countUnread(req.user.id);
  return sendSuccess(res, 200, "Unread count fetched successfully", { count });
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markRead(req.user.id, req.params.id);
  return sendSuccess(res, 200, "Notification marked as read", notification);
});

const markAllRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllRead(req.user.id);
  return sendSuccess(res, 200, "All notifications marked as read", result);
});

const deleteNotification = asyncHandler(async (req, res) => {
  await notificationService.deleteNotification(req.user.id, req.params.id);
  return sendSuccess(res, 200, "Notification deleted successfully");
});

const getPreferences = asyncHandler(async (req, res) => {
  const preferences = await notificationService.getPreferences(req.user.id);
  return sendSuccess(res, 200, "Notification preferences fetched successfully", preferences);
});

const updatePreferences = asyncHandler(async (req, res) => {
  const preferences = await notificationService.updatePreferences(
    req.user.id,
    req.body,
  );
  return sendSuccess(res, 200, "Notification preferences updated successfully", preferences);
});

module.exports = {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  getPreferences,
  updatePreferences,
};
