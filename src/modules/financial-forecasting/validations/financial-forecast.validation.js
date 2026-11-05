const { z } = require("zod");

const createForecastSchema = z
  .object({
    openingCash: z
      .number({ error: "Opening cash must be a number" })
      .finite("Opening cash must be finite")
      .min(0, "Opening cash cannot be negative"),

    horizonMonths: z
      .number({ error: "Forecast horizon must be a number" })
      .int("Forecast horizon must be an integer")
      .refine(
        (value) => [3, 6, 12].includes(value),
        "Forecast horizon must be 3, 6, or 12 months",
      ),
  })
  .strict();

module.exports = {
  createForecastSchema,
};
