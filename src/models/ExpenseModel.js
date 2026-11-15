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

// List reads: scoped by user, sorted by date with an _id tiebreaker so keyset
// pagination stays stable when many expenses share a date.
ExpenseSchema.index(
  { userID: 1, date: -1, _id: -1 },
  { name: "expense_user_date_cursor" },
);

// Category filtering and per-category aggregation (budget utilization).
ExpenseSchema.index(
  { userID: 1, categoryID: 1, date: -1 },
  { name: "expense_user_category_date" },
);

// Summary reconciliation scans a user's recent writes.
ExpenseSchema.index(
  { updatedAt: -1, userID: 1 },
  { name: "expense_updated_recent" },
);

module.exports = mongoose.model("expense", ExpenseSchema);
