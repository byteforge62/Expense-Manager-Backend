const { z } = require("zod");

/**
 * Request schemas for the account/auth endpoints.
 *
 * The password policy lives in one place so signup and password reset cannot
 * drift apart, and so a reset can never be weaker than the original rule.
 */
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(100, "Password cannot exceed 100 characters")
  .regex(
    PASSWORD_RULE,
    "Password must contain uppercase, lowercase and a number",
  );

const emailSchema = z
  .string()
  .trim()
  .email("Invalid email address")
  .transform((email) => email.toLowerCase());

const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name cannot exceed 50 characters"),

  email: emailSchema,

  password: passwordSchema,
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

const updateUserSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(50, "Name cannot exceed 50 characters")
      .optional(),

    email: emailSchema.optional(),

    bio: z
      .string()
      .trim()
      .max(500, "Bio cannot exceed 500 characters")
      .optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one valid field is required",
  );

/**
 * In-session password change. Requires the current password, and the new one
 * must satisfy the same policy as signup and reset.
 */
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
  })
  .strict();

/**
 * Password-reset request. Strict so extra fields cannot smuggle state, and the
 * email is normalized exactly like login/signup.
 */
const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

/**
 * Password-reset completion. The token shape is only length-checked here: it is
 * never echoed back, and unknown/expired/used tokens all produce the same
 * rejection from the service layer.
 */
const resetPasswordSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(16, "Invalid or expired reset link")
      .max(256, "Invalid or expired reset link"),
    password: passwordSchema,
  })
  .strict();

module.exports = {
  signupSchema,
  loginSchema,
  updateUserSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  passwordSchema,
};
