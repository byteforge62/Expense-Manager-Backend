
const mongoose = require("mongoose");

const recurringSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["INCOME", "EXPENSE", "UNCLASSIFIED"],
      default: "UNCLASSIFIED",
      required: true,
    },
    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly", "yearly"],
      required: true,
    },
    nextDate: {
      type: Date,
      required: true,
    },
    recurrenceAnchorDay: {
      type: Number,
      min: 1,
      max: 31,
      default: undefined,
    },
    recurrenceAnchorMonth: {
      type: Number,
      min: 0,
      max: 11,
      default: undefined,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

recurringSchema.index({
  userId: 1,
  nextDate: 1,
});

recurringSchema.index({
  userId: 1,
  isActive: 1,
});

recurringSchema.index({
  type: 1,
  isActive: 1,
  nextDate: 1,
});

module.exports = mongoose.model("recurring", recurringSchema);
