const NotificationModel = require("../../models/NotificationModel");
const UserModel = require("../../models/UserModel");
const NotFoundError = require("../../errors/NotFoundError");
const cache = require("../../infrastructure/cache/memory-cache");
const logger = require("../../infrastructure/logger");
const events = require("../../infrastructure/events/event-bus");
const EVENTS = require("../../infrastructure/events/event-names");

/**
 * Centralised in-app notifications.
 *
 * Design notes:
 * - Preferences are honoured on creation, not just on read, so a user who
 *   disabled a category never accumulates hidden state.
 * - `dedupeKey` makes creation idempotent per user (unique partial index), so
 *   a retried job cannot produce duplicate alerts for an unchanged condition.
 * - Only in-app delivery is implemented: no email/push provider is configured
 *   in this deployment, and inventing one would send real messages without
 *   consent.
 */

const PREFERENCES_CACHE_TTL_MS = 60_000;
const PREF_CACHE_PREFIX = "notification_prefs:";

const PRIORITY_RANK = { low: 10, medium: 20, high: 30, critical: 40 };

const DEFAULT_PREFERENCES = Object.freeze({
  inApp: true,
  budgetAlerts: true,
  billReminders: true,
  recurringActivity: true,
  anomalies: true,
  recommendations: true,
  minimumPriority: "low",
});

const CATEGORY_PREFERENCE_KEY = {
  budget: "budgetAlerts",
  bill: "billReminders",
  recurring: "recurringActivity",
  anomaly: "anomalies",
  recommendation: "recommendations",
};

const DEFAULT_RETENTION_DAYS = Number(process.env.NOTIFICATION_RETENTION_DAYS) || 90;

const normalizePreferences = (raw = {}) => ({
  ...DEFAULT_PREFERENCES,
  ...(raw || {}),
});

const getPreferences = async (userID) => {
  const cacheKey = `${PREF_CACHE_PREFIX}${userID}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const user = await UserModel.findById(userID)
    .select("notificationPreferences")
    .lean();
  const preferences = normalizePreferences(user?.notificationPreferences);

  cache.set(cacheKey, preferences, PREFERENCES_CACHE_TTL_MS);
  return preferences;
};

const updatePreferences = async (userID, patch) => {
  const user = await UserModel.findById(userID).select("notificationPreferences");

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const current = normalizePreferences(user.notificationPreferences);
  const next = normalizePreferences({ ...current, ...patch });

  user.notificationPreferences = next;
  await user.save();

  cache.del(`${PREF_CACHE_PREFIX}${userID}`);

  return next;
};

/**
 * Tells connected clients (SSE) and other consumers that an in-app
 * notification exists. Best-effort: `emit` never throws.
 */
const publishCreated = async (payload) => {
  await events.emit(
    EVENTS.NOTIFICATION_CREATED,
    {
      userId: String(payload.userID),
      type: payload.type,
      category: payload.category,
      priority: payload.priority,
      title: payload.title,
      notificationId: payload.notificationId
        ? String(payload.notificationId)
        : null,
    },
    { source: "notification" },
  );
};

const isSuppressed = (preferences, category, priority) => {
  if (preferences.inApp === false) {
    return "in_app_disabled";
  }

  const prefKey = CATEGORY_PREFERENCE_KEY[category];

  if (prefKey && preferences[prefKey] === false) {
    return "category_disabled";
  }

  const minimum = PRIORITY_RANK[preferences.minimumPriority] ?? PRIORITY_RANK.low;

  if ((PRIORITY_RANK[priority] ?? PRIORITY_RANK.medium) < minimum) {
    return "below_minimum_priority";
  }

  return null;
};

/**
 * Creates a notification, honouring preferences and deduplication.
 * Returns { created, suppressed } and never throws for preference/dedupe paths.
 */
const createNotification = async ({
  userID,
  type,
  category = "system",
  priority = "medium",
  title,
  message,
  data = {},
  dedupeKey,
  expiresAt,
  respectPreferences = true,
}) => {
  if (!userID || !type || !title || !message) {
    throw new TypeError("userID, type, title and message are required");
  }

  const preferences = await getPreferences(userID);

  if (respectPreferences) {
    const suppressed = isSuppressed(preferences, category, priority);

    if (suppressed) {
      return { created: false, suppressed };
    }
  }

  const expiry =
    expiresAt ||
    new Date(Date.now() + DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  try {
    if (dedupeKey) {
      const result = await NotificationModel.updateOne(
        { userID, dedupeKey },
        {
          $setOnInsert: {
            userID,
            type,
            category,
            priority,
            title,
            message,
            data,
            dedupeKey,
            expiresAt: expiry,
          },
        },
        { upsert: true },
      );

      if (result.upsertedCount > 0) {
        await publishCreated({ userID, type, category, priority, title, message });
      }

      return {
        created: result.upsertedCount > 0,
        deduplicated: result.upsertedCount === 0,
      };
    }

    const notification = await NotificationModel.create({
      userID,
      type,
      category,
      priority,
      title,
      message,
      data,
      expiresAt: expiry,
    });

    await publishCreated({
      userID,
      type,
      category,
      priority,
      title,
      message,
      notificationId: notification._id,
    });

    return { created: true, notification };
  } catch (error) {
    // Two workers may race on the same dedupe key; the second insert is the
    // duplicate we explicitly want to swallow.
    if (error.code === 11000) {
      return { created: false, deduplicated: true };
    }

    logger.error("notification.create_failed", { type, category, error });
    throw error;
  }
};

const listNotifications = async (
  userID,
  { page = 1, limit = 20, unread, category, priority } = {},
) => {
  const query = { userID };

  if (unread === "true") {
    query.readAt = { $exists: false };
  }

  if (category) {
    query.category = category;
  }

  if (priority) {
    query.priority = priority;
  }

  const [items, total] = await Promise.all([
    NotificationModel.find(query)
      .select("-dedupeKey -userID -__v")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NotificationModel.countDocuments(query),
  ]);

  return { items, total };
};

const countUnread = async (userID) =>
  NotificationModel.countDocuments({ userID, readAt: { $exists: false } });

const markRead = async (userID, notificationId) => {
  const notification = await NotificationModel.findOneAndUpdate(
    { _id: notificationId, userID },
    { $set: { readAt: new Date() } },
    { new: true },
  )
    .select("-dedupeKey -userID -__v")
    .lean();

  if (!notification) {
    throw new NotFoundError("Notification not found");
  }

  return notification;
};

const markAllRead = async (userID) => {
  const result = await NotificationModel.updateMany(
    { userID, readAt: { $exists: false } },
    { $set: { readAt: new Date() } },
  );

  return { modified: result.modifiedCount };
};

const deleteNotification = async (userID, notificationId) => {
  const result = await NotificationModel.deleteOne({ _id: notificationId, userID });

  if (result.deletedCount === 0) {
    throw new NotFoundError("Notification not found");
  }
};

/**
 * Retention: removes expired notifications and anything older than the
 * retention window. Called by the scheduled retention job.
 */
const purgeExpired = async (now = new Date()) => {
  const cutoff = new Date(
    now.getTime() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const result = await NotificationModel.deleteMany({
    $or: [{ expiresAt: { $lt: now } }, { createdAt: { $lt: cutoff } }],
  });

  return { deleted: result.deletedCount };
};

module.exports = {
  DEFAULT_PREFERENCES,
  PRIORITY_RANK,
  getPreferences,
  updatePreferences,
  createNotification,
  listNotifications,
  countUnread,
  markRead,
  markAllRead,
  deleteNotification,
  purgeExpired,
};
