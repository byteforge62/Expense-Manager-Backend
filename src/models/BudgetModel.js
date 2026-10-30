const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const BudgetSchema = new Schema(
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
      type: Number, // The maximum amount the user wants to spend
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    start_date: {
      type: Date,
    },
    end_date: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

BudgetSchema.index({
  userID: 1,
  categoryID: 1
});
BudgetSchema.index({
  userID: 1,
  start_date: -1
});

module.exports = mongoose.model("budget", BudgetSchema);
