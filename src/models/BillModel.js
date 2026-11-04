const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const BillSchema = new Schema(
  {
    userID: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "paid"],
      default: "pending",
    },
    settledExpenseId: {
      type: Schema.Types.ObjectId,
      ref: "expense",
      default: undefined,
    },
    settledAt: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

BillSchema.index({
  userID: 1,
  dueDate: 1,
});

BillSchema.index({
  userID: 1,
  status: 1,
});

BillSchema.index(
  { settledExpenseId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      settledExpenseId: { $type: "objectId" },
    },
    name: "unique_bill_settlement_expense",
  },
);

module.exports = mongoose.model("bill", BillSchema);
