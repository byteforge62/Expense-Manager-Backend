const ExpenseModel = require("../models/ExpenseModel");
const notificationService = require("../modules/notifications/notification.service");
const logger = require("../infrastructure/logger");

/**
 * --- LOGIN WELCOME ---
 *
 * Every successful login returns a short greeting. It is also stored as an
 * in-app notification (deduplicated per user and per state), so the message
 * exists in the notification inbox and not only in the login response.
 *
 * An account with no expenses is told to add its first one; an account with
 * records gets a plain welcome-back with its expense count. Preferences are
 * honoured: if in-app delivery is off (or the greeting falls below the chosen
 * priority floor), the greeting is not stored and the login toast is skipped.
 */

const firstNameOf = (user) => {
  const name = String(user?.name || "").trim();
  const first = name.split(/\s+/)[0];

  return first || "there";
};

const buildWelcomeState = async (user) => {
  const firstName = firstNameOf(user);

  // Administrators do not keep a personal ledger on this account, so their
  // greeting points at the admin workspace instead of the expense form.
  if (user.role === "Admin") {
    return {
      hasExpenses: null,
      expenseCount: null,
      title: `Welcome back, ${firstName}`,
      message:
        "Your admin workspace is ready. Review users, categories and system activity from the sidebar.",
      dedupeKey: `welcome:admin:${user._id}`,
    };
  }

  const expenseCount = await ExpenseModel.countDocuments({ userID: user._id });
  const hasExpenses = expenseCount > 0;

  if (!hasExpenses) {
    return {
      hasExpenses,
      expenseCount,
      title: `Welcome to FinTrack, ${firstName}`,
      message:
        "Your ledger is empty. Add your first expense to see budgets, insights and forecasts built from your own records.",
      dedupeKey: `welcome:no_expenses:${user._id}`,
    };
  }

  return {
    hasExpenses,
    expenseCount,
    title: `Welcome back, ${firstName}`,
    message: `You have ${expenseCount} expense${expenseCount === 1 ? "" : "s"} on record. Your overview is up to date.`,
    dedupeKey: `welcome:has_expenses:${user._id}`,
  };
};

const destinationFor = (user) =>
  user.role === "Admin"
    ? { cta: "Open admin workspace", url: "/admin/admindashboard" }
    : { cta: "Open your dashboard", url: "/private/userdashboard" };

const ensureWelcomeNotification = async (user) => {
  const welcome = await buildWelcomeState(user);
  let suppressed = false;

  try {
    const preferences = await notificationService.getPreferences(user._id);

    if (preferences.inApp === false) {
      suppressed = true;
    } else {
      const result = await notificationService.createNotification({
        userID: user._id,
        type: "user.welcome",
        category: "system",
        priority: "low",
        title: welcome.title,
        message: welcome.message,
        data: destinationFor(user),
        dedupeKey: welcome.dedupeKey,
        respectPreferences: true,
      });

      suppressed = result.created === false && Boolean(result.suppressed);
    }
  } catch (error) {
    // The greeting is still returned to the client even if storing it fails.
    logger.warn("welcome.notification_failed", {
      userID: String(user._id),
      error,
    });
  }

  return {
    title: welcome.title,
    message: welcome.message,
    hasExpenses: welcome.hasExpenses,
    expenseCount: welcome.expenseCount,
    suppressed,
  };
};

module.exports = {
  buildWelcomeState,
  ensureWelcomeNotification,
};
