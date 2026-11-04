const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const IncomeSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    amount: {
      type: Number,
      required: true,
    },
    source: {
      type: String, // e.g., "Freelance Project", "Company A"
    },
    date: {
      type: Date,
      default: Date.now,
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
    },
  },
  {
    timestamps: true,
  },
);

IncomeSchema.index({
  userID:1,
  recurringId: 1,
  recurringOccurrenceDate: 1,
},
{
  unique: true,
  partialFilterExpression:{
    recurringId: { $type: "objectId"},
    recurringOccurrenceDate: {$type: "date"},
  },
  name:"unique_recurring_income_occurrence",
});

IncomeSchema.index({
  userID: 1,
  date: -1,
})
module.exports = mongoose.model("income", IncomeSchema);
