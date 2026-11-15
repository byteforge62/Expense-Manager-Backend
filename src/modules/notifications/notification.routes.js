const router = require("express").Router();
const { z } = require("zod");
const { requireAuth } = require("../../middleware/auth.middleware");
const validate = require("../../middleware/validate.middleware");
const { idParamSchema } = require("../../validations/common.validation");
const { notificationsListQuerySchema } = require("../../validations/query.validation");
const controller = require("./notification.controller");

const preferencesSchema = z
  .object({
    inApp: z.boolean().optional(),
    budgetAlerts: z.boolean().optional(),
    billReminders: z.boolean().optional(),
    recurringActivity: z.boolean().optional(),
    anomalies: z.boolean().optional(),
    recommendations: z.boolean().optional(),
    minimumPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one preference must be provided",
  });

router.use(requireAuth);

router.get("/", validate({ query: notificationsListQuerySchema }), controller.listNotifications);
router.get("/unread-count", controller.unreadCount);
router.patch("/read-all", controller.markAllRead);
router.get("/preferences", controller.getPreferences);
router.put(
  "/preferences",
  validate({ body: preferencesSchema }),
  controller.updatePreferences,
);
router.patch("/:id/read", validate({ params: idParamSchema }), controller.markRead);
router.delete("/:id", validate({ params: idParamSchema }), controller.deleteNotification);

module.exports = router;
