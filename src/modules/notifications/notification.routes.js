const router = require("express").Router();
const { z } = require("zod");
const { requireAuth } = require("../../middleware/auth.middleware");
const validate = require("../../middleware/validate.middleware");
const { asyncHandler, sendSuccess } = require("../../utiles/response");
const { resolvePagination, buildPaginationMeta } = require("../../utiles/list-query");
const { idParamSchema } = require("../../validations/common.validation");
const { notificationsListQuerySchema } = require("../../validations/query.validation");
const notificationService = require("./notification.service");

/**
 * Notifications: router plus its thin handlers. Delivery/fan-out lives in
 * notification.service.js and notification.handlers.js.
 */

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

const preferencesSchema = z
  .object({
    inApp: z.boolean().optional(),
    budgetAlerts: z.boolean().optional(),
    billReminders: z.boolean().optional(),
    recurringActivity: z.boolean().optional(),
    anomalies: z.boolean().optional(),
    recommendations: z.boolean().optional(),
    email: z.boolean().optional(),
    accountEmails: z.boolean().optional(),
    minimumPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one preference must be provided",
  });

router.use(requireAuth);

router.get("/", validate({ query: notificationsListQuerySchema }), listNotifications);
router.get("/unread-count", unreadCount);
router.patch("/read-all", markAllRead);
router.get("/preferences", getPreferences);
router.put(
  "/preferences",
  validate({ body: preferencesSchema }),
  updatePreferences,
);
router.patch("/:id/read", validate({ params: idParamSchema }), markRead);
router.delete("/:id", validate({ params: idParamSchema }), deleteNotification);

module.exports = router;
