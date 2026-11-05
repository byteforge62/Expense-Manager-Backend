const { z } = require("zod");

const openingCashSchema = z.preprocess(
  (value) => (value === null || value === "" ? Number.NaN : value),
  z.coerce
    .number()
    .finite("Opening cash must be a valid number")
    .min(0, "Opening cash cannot be negative"),
);

const horizonSchema = z.coerce
  .number()
  .int("Forecast horizon must be a whole number")
  .refine((value) => [3, 6, 12].includes(value), {
    message: "Forecast horizon must be 3, 6, or 12 months",
  });

const createForecastSchema = z
  .object({
    openingCash: openingCashSchema,
    horizonMonths: horizonSchema,
  })
  .strict();

module.exports = {
  createForecastSchema,
};
