const {z} = require("zod");
const signupSchema = z.object({
    name:z
    .string()
    .trim()
    .min(2,"Name must be at least 2 characters")
    .max(50,"Name cannot exceed 50 characters"),

    email:z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((email) => email.toLowerCase()),

    password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password cannot exceed 100 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
      "Password must contain uppercase, lowercase and a number"
    ),
});

const loginSchema = z.object({
    email:z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((email)=> email.toLowerCase()),

    password:z
    .string()
    .min(1,"Password is required")
});

module.exports = {
    signupSchema,
    loginSchema
};
                                    