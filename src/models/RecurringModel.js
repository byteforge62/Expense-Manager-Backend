const mongoose = require("mongoose");
const recurringSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    type:{
      type: String,
      enum:["INCOME","EXPENSE","UNCLASSIFIED"],
      default: "UNCLASSIFIED",
      required: true,
    },
    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly", "yearly"],
      required: true,
    },
    nextDate: {
      type: Date, // When the next instance should be created
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true, // Can be toggled off by the user
    },
  },
  {
    timestamps: true,
  },
);
recurringSchema.index({
   userId:1,
   nextDate:1
});

recurringSchema.index({
   userId:1,
   isActive:1
});

recurringSchema.index({
  type: 1,
  isActive: 1,
  nextDate: 1,
})

module.exports = mongoose.model("recurring", recurringSchema);

