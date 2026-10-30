const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SystemLogSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

SystemLogSchema.index({ createdAt: -1 });
SystemLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("SystemLog", SystemLogSchema);
