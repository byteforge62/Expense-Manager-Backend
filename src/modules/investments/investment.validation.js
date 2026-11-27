const { z } = require("zod");
const { objectIdSchema } = require("../../validations/common.validation");

/**
 * Investment contracts.
 *
 * `symbol` is a Yahoo Finance ticker for stocks/ETFs (RELIANCE.NS) or an
 * MFAPI scheme code for funds, so one text field covers both sources.
 */

/**
 * Currency scope.
 *
 * Every total, formatter and allocation share in FinTrack is in rupees, and a
 * quote is taken at face value. A US ticker would therefore add dollars into a
 * rupee total with no conversion, so the contract accepts Indian listings only:
 * NSE (.NS) or BSE (.BO) tickers for stocks and ETFs, and numeric MFAPI scheme
 * codes for mutual funds.
 */
const NSE_BSE_SYMBOL = /^[A-Za-z0-9][A-Za-z0-9.&=^-]*\.(NS|BO)$/i;
const MFAPI_SCHEME_CODE = /^\d{1,10}$/;

const isIndianListing = (kind, symbol) => {
  const value = String(symbol ?? "").trim();

  return kind === "FUND"
    ? MFAPI_SCHEME_CODE.test(value)
    : NSE_BSE_SYMBOL.test(value);
};

const listingMessage = (kind) =>
  kind === "FUND"
    ? "Use the numeric MFAPI scheme code of an Indian mutual fund"
    : "Use an Indian listing: a symbol ending in .NS (NSE) or .BO (BSE)";

/** Object-level check so the issue keeps its `symbol` field path. */
const checkListing = (value, ctx) => {
  if (!value.kind || value.symbol === undefined) return;

  if (!isIndianListing(value.kind, value.symbol)) {
    ctx.addIssue({
      code: "custom",
      path: ["symbol"],
      message: listingMessage(value.kind),
    });
  }
};

/**
 * An update may change the symbol without repeating the kind. The stored kind is
 * then unknown here, so either form is allowed — which still excludes every real
 * foreign ticker (they are neither suffixed nor numeric).
 */
const checkUpdatedListing = (value, ctx) => {
  if (value.symbol === undefined) return;

  if (value.kind) return checkListing(value, ctx);

  const symbol = value.symbol.trim();

  if (NSE_BSE_SYMBOL.test(symbol) || MFAPI_SCHEME_CODE.test(symbol)) return;

  ctx.addIssue({
    code: "custom",
    path: ["symbol"],
    message: "Use an Indian listing or a fund scheme code",
  });
};

const holdingFields = {
  kind: z.enum(["STOCK", "FUND"]),
  symbol: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(160),
  exchange: z.string().trim().max(40).optional(),
  units: z.coerce.number().finite().positive("Units must be greater than zero").max(1e9),
  avgCost: z.coerce.number().finite().min(0, "Average cost cannot be negative"),
  investedAt: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
};

const createHoldingSchema = z
  .object(holdingFields)
  .strict()
  .superRefine(checkListing);

const updateHoldingSchema = z
  .object({
    ...holdingFields,
    kind: holdingFields.kind.optional(),
    symbol: holdingFields.symbol.optional(),
    name: holdingFields.name.optional(),
    units: holdingFields.units.optional(),
    avgCost: holdingFields.avgCost.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  )
  .superRefine(checkUpdatedListing);

const investmentIdParamSchema = z.object({ id: objectIdSchema });

const transactionIdParamSchema = z.object({
  id: objectIdSchema,
  transactionId: objectIdSchema,
});

// A trade is dated and priced per unit; units and average cost on a holding are
// never sent by the client once these exist, they are derived.
const createTransactionSchema = z
  .object({
    type: z.enum(["BUY", "SELL"]),
    units: z.coerce
      .number()
      .finite()
      .positive("Units must be greater than zero")
      .max(1e9),
    price: z.coerce
      .number()
      .finite()
      .min(0, "Price cannot be negative")
      .max(1e12),
    tradedAt: z.coerce.date().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

const planSchema = z
  .object({
    targetAmount: z.coerce.number().finite().positive("Enter a target amount").max(1e12),
    years: z.coerce.number().int().min(1, "Use at least one year").max(50),
    expectedReturn: z.coerce.number().min(1).max(30).optional(),
    existingMonthly: z.coerce.number().finite().min(0).max(1e9).optional(),
  })
  .strict();

/**
 * Instrument identifiers are an allow-list, not free text.
 *
 * A ticker is an NSE/BSE listing (RELIANCE.NS, M&M.NS, BAJAJ-AUTO.NS), a Yahoo
 * index (^NSEI) or an MFAPI scheme code (118989). Anything else — path
 * separators, spaces, markup, percent escapes — is refused before it can become
 * a cache key or an upstream request.
 */
const SYMBOL_PATTERN = /^[A-Za-z0-9^][A-Za-z0-9.^&=-]{0,39}$/;

/** A search is a company or fund name: letters, digits and ordinary name punctuation. */
const SEARCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .,&'()/-]{0,79}$/;

const quoteQuerySchema = z
  .object({
    kind: z.enum(["STOCK", "FUND"]),
    symbol: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(SYMBOL_PATTERN, "Use a valid ticker or scheme code"),
  })
  .superRefine(checkListing);

const searchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, "Type at least two characters")
    .max(80)
    .regex(SEARCH_PATTERN, "Search with a company or fund name"),
});

module.exports = {
  isIndianListing,
  createHoldingSchema,
  updateHoldingSchema,
  investmentIdParamSchema,
  transactionIdParamSchema,
  createTransactionSchema,
  planSchema,
  quoteQuerySchema,
  searchQuerySchema,
};
