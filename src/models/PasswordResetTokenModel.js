const mongoose = require("mongoose");

/**
 * --- PASSWORD RESET TOKENS ---
 * A reset link is a bearer credential, so only its SHA-256 hash is stored: a
 * database read cannot be turned back into a usable link.
 *
 * Three properties make the collection self-managing:
 *  - `user` is unique. That single index is what enforces the "one live reset
 *    link per account" policy under concurrency: issuance is an upsert on
 *    `user`, so simultaneous requests can never leave two usable tokens behind.
 *  - `expiresAt` carries a TTL index, so expired links are removed by MongoDB
 *    without introducing a scheduler. A TTL delete never conflicts with the
 *    unique `user` index because issuance updates the existing document rather
 *    than inserting a second one.
 *  - `usedAt` marks consumption; the claim runs inside a transaction together
 *    with the password update, so a half-finished reset cannot burn the link.
 */
const PasswordResetTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      unique: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PasswordResetToken", PasswordResetTokenSchema);
