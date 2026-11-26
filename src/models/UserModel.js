const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * --- USER MODEL ---
 * The core entity representing a person using the platform.
 */

const UserSchema = new Schema(
  {
    // --- CORE IDENTITY ---
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      unique: true,
      required: true,
    },
    password: {
      type: String, // Hashed
      required: true,
    },
    age: {
      type: Number,
    },

    // --- ACCESS CONTROL ---
    role: {
      type: String,
      enum: ["Admin", "User"],
      default: "User",
    },
    is_active: {
      type: Boolean,
      default: true,
    },

    // --- PROFILE DETAILS ---
    profilePic: {
      type: String,
      default: "",
    },
    bio: {
      type: String,
    },

    // --- NOTIFICATION PREFERENCES ---
    // Additive, defaulted fields: existing users inherit the defaults with no
    // migration. Missing values are also defaulted in the notification service.
    notificationPreferences: {
      inApp: {
        type: Boolean,
        default: true,
      },
      budgetAlerts: {
        type: Boolean,
        default: true,
      },
      billReminders: {
        type: Boolean,
        default: true,
      },
      recurringActivity: {
        type: Boolean,
        default: true,
      },
      anomalies: {
        type: Boolean,
        default: true,
      },
      recommendations: {
        type: Boolean,
        default: true,
      },
      email: {
        type: Boolean,
        default: true,
      },
      accountEmails: {
        type: Boolean,
        default: true,
      },
      minimumPriority: {
        type: String,
        enum: ["low", "medium", "high", "critical"],
        default: "low",
      },
    },

    // --- PURCHASE PREFERENCES ---
    // Saved account-level choice. When `linkedStoresOnly` is true, the purchase
    // log, its analytics and the dashboard only receive purchases imported from
    // a linked store account. Manual entries stay stored, but are not returned.
    purchasePreferences: {
      linkedStoresOnly: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("users", UserSchema);

