const { z } = require("zod");
const {
  getInclusiveDays,
  MAX_WINDOW_DAYS,
} = require("../utils/date.utils");

const overviewQuerySchema = z
  .object({
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((data, context) => {
    const now = new Date();
    const end = data.endDate ? new Date(data.endDate) : now;
    const start = data.startDate
      ? new Date(data.startDate)
      : new Date(Date.UTC(
          end.getUTCFullYear(),
          end.getUTCMonth(),
          end.getUTCDate() - 89,
        ));

    if (start > end) {
      context.addIssue({
        code: "custom",
        message: "startDate must be less than or equal to endDate",
        path: ["startDate"],
      });
      return;
    }

    if (getInclusiveDays(start, end) > MAX_WINDOW_DAYS) {
      context.addIssue({
        code: "custom",
        message: `The date range cannot exceed ${MAX_WINDOW_DAYS} calendar days`,
        path: ["endDate"],
      });
    }
  });

module.exports = {
  overviewQuerySchema,
};
