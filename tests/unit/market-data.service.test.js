const market = require("../../src/modules/investments/market-data.service");

const originalFetch = global.fetch;

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

const yahooChart = ({ meta = {}, closes = [] } = {}) => ({
  chart: {
    result: [{ meta, indicators: { quote: [{ close: closes }] } }],
  },
});

/**
 * Market-data parsing. The provider payloads below are cut down from real
 * Yahoo chart and MFAPI responses; the cache is cleared between tests so each
 * one exercises the parser rather than a previous result.
 */
describe("Market data parsing", () => {
  beforeEach(() => {
    market.__cache.clear();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("Stock quotes", () => {
    test("measures the day change against yesterday's close, not the month-ago close", async () => {
      global.fetch.mockResolvedValue(
        jsonResponse(
          yahooChart({
            meta: {
              symbol: "RELIANCE.NS",
              shortName: "Reliance Industries",
              fullExchangeName: "NSE",
              currency: "INR",
              regularMarketPrice: 1387.9,
              // The close before the whole 1-month range, i.e. a month ago.
              chartPreviousClose: 1250,
              regularMarketTime: 1795000000,
            },
            // Nulls are common in the provider series and must be skipped.
            closes: [1280.5, null, 1396.2, 1387.9],
          }),
        ),
      );

      const quote = await market.stockQuote("RELIANCE.NS");

      expect(quote.price).toBe(1387.9);
      expect(quote.previousClose).toBe(1396.2);
      expect(quote.change).toBe(-8.3);
      expect(quote.changePercent).toBe(-0.59);
      expect(quote.sparkline).toEqual([1280.5, 1396.2, 1387.9]);
      expect(quote.asOf).toBe(new Date(1795000000 * 1000).toISOString());
    });

    test("prefers a provider-supplied previous close over the series", async () => {
      global.fetch.mockResolvedValue(
        jsonResponse(
          yahooChart({
            meta: {
              symbol: "TCS.NS",
              regularMarketPrice: 1290,
              previousClose: 1275,
              chartPreviousClose: 1200,
            },
            closes: [1300, 1295],
          }),
        ),
      );

      const quote = await market.stockQuote("TCS.NS");

      expect(quote.previousClose).toBe(1275);
      expect(quote.change).toBe(15);
      expect(quote.changePercent).toBe(1.18);
    });

    test("falls back to the range close when the daily series is missing", async () => {
      global.fetch.mockResolvedValue(
        jsonResponse(
          yahooChart({
            meta: {
              symbol: "INFY.NS",
              regularMarketPrice: 1212,
              chartPreviousClose: 1200,
            },
            closes: [null, null],
          }),
        ),
      );

      const quote = await market.stockQuote("INFY.NS");

      expect(quote.previousClose).toBe(1200);
      expect(quote.change).toBe(12);
      expect(quote.changePercent).toBe(1);
      expect(quote.sparkline).toEqual([]);
    });

    test("has no percentage change when the previous close is zero", async () => {
      global.fetch.mockResolvedValue(
        jsonResponse(
          yahooChart({
            meta: {
              symbol: "NEW.NS",
              regularMarketPrice: 10,
              chartPreviousClose: 0,
            },
          }),
        ),
      );

      const quote = await market.stockQuote("NEW.NS");

      expect(quote.previousClose).toBe(0);
      expect(quote.change).toBe(10);
      expect(quote.changePercent).toBeNull();
    });

    test("rejects a symbol with no usable price", async () => {
      global.fetch.mockResolvedValue(
        jsonResponse(
          yahooChart({
            meta: { symbol: "NOPE.NS", chartPreviousClose: 100 },
          }),
        ),
      );

      await expect(market.stockQuote("NOPE.NS")).rejects.toThrow(
        "No market price for this symbol",
      );
    });

    test("rejects a response with no chart result", async () => {
      global.fetch.mockResolvedValue(jsonResponse({ chart: { result: [] } }));

      await expect(market.stockQuote("MISSING.NS")).rejects.toThrow(
        "No market data for this symbol",
      );
    });

    test("surfaces an upstream error status", async () => {
      global.fetch.mockResolvedValue(
        jsonResponse({}, { ok: false, status: 429 }),
      );

      await expect(market.stockQuote("RELIANCE.NS")).rejects.toThrow(
        "Market data request failed (429)",
      );
    });
  });

  describe("Fund NAVs", () => {
    test("compares the latest NAV with the previous one", async () => {
      global.fetch.mockResolvedValue(
        jsonResponse({
          meta: {
            scheme_code: 118989,
            scheme_name: "HDFC Index Fund - Nifty 50",
            fund_house: "HDFC Mutual Fund",
          },
          data: [
            { date: "26-11-2026", nav: "45.6789" },
            { date: "25-11-2026", nav: "45.2000" },
          ],
        }),
      );

      const quote = await market.fundQuote(118989);

      expect(quote.kind).toBe("FUND");
      expect(quote.price).toBe(45.68);
      expect(quote.previousClose).toBe(45.2);
      expect(quote.change).toBe(0.48);
      expect(quote.changePercent).toBe(1.06);
      // Oldest first, like the stock sparkline.
      expect(quote.sparkline).toEqual([45.2, 45.68]);
      expect(quote.asOf).toBe("2026-11-26T00:00:00.000Z");
    });

    test("shows no change for a fund with a single NAV row", async () => {
      global.fetch.mockResolvedValue(
        jsonResponse({
          meta: { scheme_code: 100001, scheme_name: "New Fund" },
          data: [{ date: "26-11-2026", nav: "10.5" }],
        }),
      );

      const quote = await market.fundQuote(100001);

      expect(quote.price).toBe(10.5);
      expect(quote.previousClose).toBe(10.5);
      expect(quote.change).toBe(0);
      expect(quote.changePercent).toBe(0);
      expect(quote.sparkline).toEqual([10.5]);
    });

    test("rejects a fund with no NAV rows", async () => {
      global.fetch.mockResolvedValue(
        jsonResponse({
          meta: { scheme_code: 999999, scheme_name: "Empty Fund" },
          data: [],
        }),
      );

      await expect(market.fundQuote(999999)).rejects.toThrow(
        "No NAV data for this fund",
      );
    });
  });
});
