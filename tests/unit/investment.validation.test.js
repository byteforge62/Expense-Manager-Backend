const {
  quoteQuerySchema,
  createHoldingSchema,
  updateHoldingSchema,
  isIndianListing,
} = require("../../src/modules/investments/investment.validation");

/**
 * Currency scope of the investment contract.
 *
 * FinTrack reports every total in rupees, so a symbol whose quote is in another
 * currency must be refused at the edge rather than converted or silently added.
 */

const issuesOf = (result) => result.error.issues.map((issue) => issue.path.join("."));

describe("Investment currency scope", () => {
  test.each([
    ["a US listing", "AAPL"],
    ["another US listing", "MSFT"],
    ["a US index", "^GSPC"],
    ["a US ETF", "VOO"],
    ["an unsuffixed ticker", "RELIANCE"],
    ["a Hong Kong listing", "0700.HK"],
    ["an Indian fund code used as a stock", "118989"],
  ])("rejects %s on the quote route", (_, symbol) => {
    const result = quoteQuerySchema.safeParse({ kind: "STOCK", symbol });

    expect(result.success).toBe(false);
    expect(issuesOf(result)).toContain("symbol");
    expect(result.error.issues[0].message).toMatch(
      /symbol ending in \.NS \(NSE\) or \.BO \(BSE\)/,
    );
  });

  test.each([
    ["RELIANCE.NS"],
    ["M&M.NS"],
    ["BAJAJ-AUTO.NS"],
    ["3MINDIA.NS"],
    ["reliance.ns"],
    ["500325.BO"],
  ])("accepts the Indian listing %s on the quote route", (symbol) => {
    const result = quoteQuerySchema.safeParse({ kind: "STOCK", symbol });

    expect(result.success).toBe(true);
    expect(result.data.symbol).toBe(symbol);
  });

  test("accepts a numeric fund scheme code and rejects a fund ticker", () => {
    expect(
      quoteQuerySchema.safeParse({ kind: "FUND", symbol: "118989" }).success,
    ).toBe(true);

    const foreign = quoteQuerySchema.safeParse({
      kind: "FUND",
      symbol: "VFIAX",
    });

    expect(foreign.success).toBe(false);
    expect(issuesOf(foreign)).toContain("symbol");
    expect(foreign.error.issues[0].message).toMatch(/numeric MFAPI scheme code/);
  });

  test("refuses to record a holding in another currency", () => {
    const usHolding = createHoldingSchema.safeParse({
      kind: "STOCK",
      symbol: "AAPL",
      name: "Apple Inc",
      units: 1,
      avgCost: 100,
    });

    expect(usHolding.success).toBe(false);
    expect(issuesOf(usHolding)).toContain("symbol");

    const indianHolding = createHoldingSchema.safeParse({
      kind: "STOCK",
      symbol: "reliance.ns",
      name: "Reliance Industries",
      units: 10,
      avgCost: 1300,
    });

    expect(indianHolding.success).toBe(true);
  });

  test("refuses to change a holding to a foreign symbol", () => {
    expect(updateHoldingSchema.safeParse({ symbol: "AAPL" }).success).toBe(
      false,
    );

    // Symbol-only edits cannot see the stored kind, so either Indian form is
    // accepted, but a foreign ticker is still refused.
    expect(updateHoldingSchema.safeParse({ symbol: "TCS.NS" }).success).toBe(
      true,
    );
    expect(updateHoldingSchema.safeParse({ symbol: "118989" }).success).toBe(
      true,
    );
    expect(updateHoldingSchema.safeParse({ units: 5 }).success).toBe(true);

    expect(
      updateHoldingSchema.safeParse({ kind: "FUND", symbol: "TCS.NS" }).success,
    ).toBe(false);
  });

  test("exposes the listing rule as one predicate", () => {
    expect(isIndianListing("STOCK", "INFY.NS")).toBe(true);
    expect(isIndianListing("STOCK", "INFY")).toBe(false);
    expect(isIndianListing("FUND", "118989")).toBe(true);
    expect(isIndianListing("FUND", "INFY.NS")).toBe(false);
  });
});
