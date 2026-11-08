const { z } = require("zod");

const ruleConfigurationSchema = z
  .object({
    budgetUtilization: z
      .object({
        warning: z.number().gt(0).lte(1),
        critical: z.number().gt(0).lte(2),
      })
      .strict()
      .optional(),
    savingsRate: z
      .object({
        target: z.number().min(-1).max(1),
      })
      .strict()
      .optional(),
    expenseGrowth: z
      .object({
        growthPercent: z.number().min(0).max(1000),
      })
      .strict()
      .optional(),
    recurringCommitment: z
      .object({
        maximumRatio: z.number().min(0).max(10),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      config.budgetUtilization &&
      config.budgetUtilization.critical <= config.budgetUtilization.warning
    ) {
      context.addIssue({
        code: "custom",
        message: "critical utilization must be greater than warning utilization",
        path: ["budgetUtilization", "critical"],
      });
    }
  });

const validateRuleConfiguration = (config = {}) =>
  ruleConfigurationSchema.parse(config);

module.exports = {
  ruleConfigurationSchema,
  validateRuleConfiguration,
};
