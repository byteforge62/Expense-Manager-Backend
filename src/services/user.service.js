const UserModel = require("../models/UserModel");
const crypto = require("crypto");
const mongoose = require("mongoose");
const RefreshTokenModel = require("../models/RefreshTokenModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const {getS3Client} = require("../config/s3");
const { NotFoundError, ConflictError, UnauthorizedError, ValidationError, AppError } = require("../errors/AppError");
const logger = require("../infrastructure/logger");
const PasswordResetTokenModel = require("../models/PasswordResetTokenModel");
const { getClientBaseUrl } = require("../config/validateEnv");
const {
  isEmailConfigured,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} = require("../infrastructure/email/mailer");
const notificationService = require("../modules/notifications/notification.service");
const welcomeService = require("./welcome.service");

const RESET_TOKEN_TTL_MINUTES =
  Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES) || 30;
const RESET_RESPONSE_FLOOR_MS =
  Number(process.env.PASSWORD_RESET_RESPONSE_FLOOR_MS ?? 250);
const BCRYPT_SALT_ROUNDS = 10;
const EMAIL_DISABLED_ENVS = new Set(["test", "e2e"]);

/**
 * Sends the one-time signup welcome note without holding the signup response.
 *
 * Account creation must never fail because SMTP is down or unconfigured, so
 * delivery happens after the response is prepared and every failure is logged
 * without the recipient. The account-email consent is checked here, at send
 * time, so a user who turns account email off is not mailed by a later retry.
 */
const queueWelcomeEmail = (user) => {
  if (EMAIL_DISABLED_ENVS.has(process.env.NODE_ENV) || !isEmailConfigured()) {
    return;
  }

  setImmediate(async () => {
    try {
      const preferences = await notificationService.getPreferences(user._id);

      if (preferences.email === false || preferences.accountEmails === false) {
        return;
      }

      await sendWelcomeEmail({
        to: user.email,
        name: user.name,
        appUrl: getClientBaseUrl(),
      });
    } catch (error) {
      logger.warn("email.welcome_failed", {
        userID: String(user._id),
        errorName: error?.name,
        errorCode: error?.code,
      });
    }
  });
};

const extractS3Key = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.substring(1);
  } catch {
    return null;
  }
};

const getAllUsers = async () => {
  return UserModel.find().select("-password");
};

const getUserById = async (id) => {
  const user = await UserModel.findById(id).select("-password");
  if (!user) {
    throw new NotFoundError("User not found");
  }
  return user;
};

const deleteUser = async (id) => {
  const user = await UserModel.findByIdAndDelete(id);

  if (!user) {
    throw new NotFoundError("User not found");
  }

  await RefreshTokenModel.deleteMany({ user: id });

  return user;
};

const signupUser = async (data) => {
  const existingUser = await UserModel.findOne({ email: data.email });
  if (existingUser) {
    throw new ConflictError("Email already Registered");
  }
  const salt = await bcrypt.genSaltSync(10);
  const hashedPassword = await bcrypt.hashSync(data.password, salt);
  const user = await UserModel.create({
    name: data.name,
    email: data.email,
    password: hashedPassword,
    role: "User",
  });

  // Put the greeting in the notification inbox now, so it is waiting on the
  // first login, and send the branded welcome note in the background. Neither
  // step may turn a successful signup into an error.
  try {
    await welcomeService.ensureWelcomeNotification(user);
  } catch (error) {
    logger.warn("welcome.notification_failed", {
      userID: String(user._id),
      error,
    });
  }

  queueWelcomeEmail(user);

  return user;
};

const loginUser = async (data) => {
  const { email, password } = data;

  const foundUser = await UserModel.findOne({ email });
  if (!foundUser) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const isMatch = await bcrypt.compare(password, foundUser.password);
  if (!isMatch) {
    throw new UnauthorizedError("Invalid email or password");
  }

  if (!foundUser.is_active) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const accessToken = jwt.sign(
    { id: foundUser._id, role: foundUser.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  const refreshToken = jwt.sign(
    {
      id: foundUser._id,
      jti: crypto.randomUUID(),
    },
    process.env.REFRESH_SECRET,
    { expiresIn: "7d" },
  );

  const tokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");

  await RefreshTokenModel.create({
    user: foundUser._id,
    tokenHash,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  // Greets the user on every login: a stored notification plus the message
  // the client shows, which points a brand-new account at its first expense.
  const welcome = await welcomeService.ensureWelcomeNotification(foundUser);

  const userData = foundUser.toObject();
  delete userData.password;
  return {
    accessToken,
    refreshToken,
    user: userData,
    welcome,
  };
};

const refreshToken = async (token) => {
  if (!token) {
    throw new UnauthorizedError("Refresh token missing");
  }

  let decoded;

  try {
    decoded = jwt.verify(token, process.env.REFRESH_SECRET);
  } catch {
    throw new UnauthorizedError("Invalid refresh token");
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const storedToken = await RefreshTokenModel.findOneAndDelete({
    tokenHash,
    user: decoded.id,
    expiresAt: { $gt: new Date() },
  });

  if (!storedToken) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  const user = await UserModel.findById(decoded.id);

  if (!user || !user.is_active) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  const newAccessToken = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  const newRefreshToken = jwt.sign(
    {
      id: user._id,
      jti: crypto.randomUUID(),
    },
    process.env.REFRESH_SECRET,
    { expiresIn: "7d" },
  );

  const newTokenHash = crypto
    .createHash("sha256")
    .update(newRefreshToken)
    .digest("hex");

  await RefreshTokenModel.create({
    user: user._id,
    tokenHash: newTokenHash,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
};

const revokeRefreshToken = async (token) => {
  if (!token) {
    return;
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  await RefreshTokenModel.deleteOne({ tokenHash });
};

const updateUser = async (id, data) => {
  const { name, email, bio } = data;

  const updatedUser = await UserModel.findByIdAndUpdate(
    id,
    { name, email, bio },
    { new: true, runValidators: true },
  ).select("-password");

  if (!updatedUser) {
    throw new NotFoundError("User not found");
  }

  return updatedUser;
};

/**
 * Changes the password of an authenticated account.
 *
 * The current password is required (a stolen access token alone cannot lock
 * the owner out), the replacement must pass the shared policy via validation,
 * and every refresh token except the caller's own session is revoked so other
 * devices cannot keep extending their access.
 */
const changePassword = async (
  id,
  { currentPassword, newPassword, callerRefreshToken },
) => {
  const user = await UserModel.findById(id);

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const isMatch = await bcrypt.compare(currentPassword, user.password);

  if (!isMatch) {
    throw new ValidationError("Current password is incorrect");
  }

  const isReused = await bcrypt.compare(newPassword, user.password);

  if (isReused) {
    throw new ValidationError(
      "New password must be different from the current password",
    );
  }

  user.password = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  await user.save();

  const keepHash = callerRefreshToken
    ? crypto.createHash("sha256").update(callerRefreshToken).digest("hex")
    : null;

  const revoked = await RefreshTokenModel.deleteMany(
    keepHash
      ? { user: id, tokenHash: { $ne: keepHash } }
      : { user: id },
  );

  return { otherSessionsRevoked: revoked.deletedCount || 0 };
};

const uploadProfilePicture = async (id, file) => {
  if (!file) {
    throw new ValidationError("No file uploaded");
  }
  const requiredS3Variables = [
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_BUCKET_NAME",
  ];

  const missingS3Variables = requiredS3Variables.filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missingS3Variables.length > 0) {
    throw new AppError(
      "Profile image storage is not configured.",
      503,
    );
  }

  const currentUser = await UserModel.findById(id);
  if (!currentUser) {
    throw new NotFoundError("User not found");
  }

  if (currentUser.profilePic) {
    const oldKey = extractS3Key(currentUser.profilePic);
    if (oldKey) {
      try {
        await getS3Client().send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: oldKey,
          }),
        );
      } catch (deleteErr) {
        // The replacement upload still proceeds; the stale object is simply
        // left behind, and the failure is logged with correlation instead of
        // being printed to stdout.
        logger.warn("profile.old_image_delete_failed", {
          userID: String(id),
          error: deleteErr,
        });
      }
    }
  }

  const extensionByMimeType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  const extension = extensionByMimeType[file.mimetype];

  if (!extension) {
    throw new ValidationError("Unsupported profile image type");
  }

  const fileName = `profiles/${crypto.randomUUID()}.${extension}`;
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    }),
  );
  const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

  const updatedUser = await UserModel.findByIdAndUpdate(
    id,
    {
      profilePic: imageUrl,
    },
    { new: true, runValidators: true },
  ).select("-password");

  return updatedUser;
};
/**
 * Reset tokens are bearer credentials, so only their SHA-256 hash is stored
 * (the same treatment refresh tokens get). 32 random bytes give 256 bits of
 * entropy, which is why a fast hash is sufficient here.
 */
const hashResetToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

const wait = (ms) =>
  new Promise((resolve) => {
    if (ms > 0) setTimeout(resolve, ms);
    else resolve();
  });

const INVALID_RESET_TOKEN_MESSAGE =
  "This password reset link is invalid or has expired";

/**
 * Writes the one live reset token for an account.
 *
 * The unique `user` index turns this into a real single-live-token guarantee: a
 * plain delete-then-insert could interleave and leave two usable links. An
 * upsert on `user` always ends with exactly one document. Two first-time
 * requests can both attempt the insert, so the loser of that insert race
 * retries as an update - the last writer's link is the valid one, the earlier
 * link stops working, and the account never holds two valid tokens.
 */
const issueResetToken = async (user) => {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const update = {
    tokenHash: hashResetToken(rawToken),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
    usedAt: null,
  };

  try {
    await PasswordResetTokenModel.findOneAndUpdate(
      { user: user._id },
      { $set: update },
      { upsert: true, new: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;

    // A concurrent request inserted the document first; replace its link.
    await PasswordResetTokenModel.findOneAndUpdate(
      { user: user._id },
      { $set: update },
      { new: true },
    );
  }

  return rawToken;
};

/**
 * Issues a password-reset link.
 *
 * Deliberately returns nothing: the controller answers every caller with the
 * same generic message, so neither the return value nor the wording can
 * reveal whether the address belongs to an account.
 *
 * Order matters: the token record is written first and the email is only
 * handed to the provider afterwards, so a link can never be mailed without a
 * matching record. A mail failure is logged without the link or recipient and
 * is swallowed, because reporting it would enumerate accounts.
 */
const requestPasswordReset = async (email) => {
  const startedAt = Date.now();
  const user = await UserModel.findOne({ email, is_active: true });

  if (user) {
    // Replaces any outstanding link, so a delivery failure leaves behind a
    // token the user simply requests again - never an unrecoverable state.
    const rawToken = await issueResetToken(user);

    const resetUrl = `${getClientBaseUrl()}/reset-password/${rawToken}`;

    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
        expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      });
    } catch (error) {
      // Structured, and free of the token, the link and the address.
      logger.error("password_reset.email_failed", {
        stage: "delivery",
        userID: String(user._id),
        errorName: error?.name,
        errorCode: error?.code,
      });
    }
  }

  // Keep the fast "no such account" path and the slow "mail sent" path
  // indistinguishable to a caller timing the response.
  await wait(RESET_RESPONSE_FLOOR_MS - (Date.now() - startedAt));
};

/**
 * Redeems a reset link and sets the new password.
 *
 * The token is claimed with a single atomic update, so exactly one of two
 * concurrent requests can win; the loser sees the same rejection as an
 * expired, unknown or already-used token. Sessions are revoked only after the
 * password has actually been replaced - a failed reset leaves them untouched.
 */
const resetPassword = async ({ token, password }) => {
  const tokenHash = hashResetToken(token);

  // Cheap pre-check of the link's shape before spending bcrypt CPU on a token
  // that cannot be redeemed. It is not the authorization decision: the claim
  // inside the transaction below is the authoritative, atomic check.
  const candidate = await PasswordResetTokenModel.findOne({
    tokenHash,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .select("_id")
    .lean();

  if (!candidate) {
    throw new ValidationError(INVALID_RESET_TOKEN_MESSAGE);
  }

  // Hashed before the transaction starts: bcrypt is deliberately slow and must
  // not hold a session or its locks open.
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  const hashedPassword = await bcrypt.hash(password, salt);

  let userID = null;
  const session = await mongoose.startSession();

  try {
    // Claiming the token, replacing the password and revoking sessions commit
    // or roll back together, so a failure part-way never burns the link or
    // leaves a reset half-applied. The claim is still a single atomic update,
    // so of two simultaneous redemptions exactly one wins; the loser aborts
    // with the same generic invalid/expired answer.
    await session.withTransaction(async () => {
      const now = new Date();

      const claimed = await PasswordResetTokenModel.findOneAndUpdate(
        { tokenHash, usedAt: null, expiresAt: { $gt: now } },
        { $set: { usedAt: now } },
        { new: false, session },
      );

      if (!claimed) {
        throw new ValidationError(INVALID_RESET_TOKEN_MESSAGE);
      }

      const user = await UserModel.findByIdAndUpdate(
        claimed.user,
        { password: hashedPassword },
        { new: true, runValidators: true, session },
      ).select("_id");

      if (!user) {
        throw new NotFoundError("User not found");
      }

      await RefreshTokenModel.deleteMany({ user: user._id }, { session });
      await PasswordResetTokenModel.deleteMany({ user: user._id }, { session });

      userID = String(user._id);
    });
  } catch (error) {
    // 20 = IllegalOperation: the deployment is a standalone mongod, which has
    // no multi-document transactions. Logged as a configuration problem rather
    // than silently degrading into a non-atomic reset sequence.
    if (error?.code === 20) {
      logger.error("password_reset.transactions_unsupported", {
        stage: "commit",
        hint: "Password reset requires a replica set or sharded cluster",
      });
    }
    throw error;
  } finally {
    await session.endSession();
  }

  logger.info("password_reset.completed", { userID });

  return { userID };
};

module.exports = {
  getAllUsers,
  getUserById,
  deleteUser,
  signupUser,
  loginUser,
  refreshToken,
  updateUser,
  changePassword,
  uploadProfilePicture,
  revokeRefreshToken,
  requestPasswordReset,
  resetPassword,
};

