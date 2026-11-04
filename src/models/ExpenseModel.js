const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ExpenseSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    categoryID: {
      type: Schema.Types.ObjectId,
      ref: "category",
    },
    amount: {
      type: Number,
      required: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    description: {
      type: String, // Optional notes about the purchase
    },
    recurringId: {
      type: Schema.Types.ObjectId,
      ref: "recurring",
      default: undefined,
      select: false,
    },
    recurringOccurrenceDate: {
      type: Date,
      default: undefined,
      select: false,
    }
  },
  {
    timestamps: true,
  },
);

ExpenseSchema.index({
  userID: 1,
  recurringId: 1,
  recurringOccurrenceDate: 1
},
  {
    unique: true,
    partialFilterExpression: {
      recurringId: { $type: "objectId" },
      recurringOccurrenceDate: { $type: "date" },
    },
    name: "unique_recurring_expense_occurrence",
  })

module.exports = mongoose.model("expense", ExpenseSchema);
