const mongoose = require("mongoose");

const InvestmentModel = require("../../src/modules/investments/models/InvestmentModel");
const market = require("../../src/modules/investments/market-data.service");
const service = require("../../src/modules/investments/investment.service");

jest.setTimeout(30000);

const QUOTES = {
  "RELIANCE.NS": { price: 1387.9, change: 8.7 },
  "118989": { price: 46.2, change: -0.4 },
};

/**
 * Portfolio valuation: totals come from the user's units and average cost, and
 * one unreachable symbol must not take the page down with it.
 */
describe("Investment portfolio valuation", () => {
  const ownerID = new mongoose.Types.ObjectId();
  const otherUserID = new mongoose.Types.ObjectId();
  let quoteSpy;

  beforeEach(async () => {
    await InvestmentModel.deleteMany({
      userID: { $in: [ownerID, otherUserID] },
    });

    quoteSpy = jest
      .spyOn(market, "quote")
      .mockImplementation(async (holding) => {
        if (holding.symbol === "BROKEN.NS") {
          throw new Error("upstream unavailable");
        }

        return QUOTES[holding.symbol];
      });
  });

  afterEach(() => {
    quoteSpy.mockRestore();
  });

  afterAll(async () => {
    await InvestmentModel.deleteMany({
      userID: { $in: [ownerID, otherUserID] },
    });
  });

  const seedMixedPortfolio = () =>
    InvestmentModel.create([
      {
        userID: ownerID,
        kind: "STOCK",
        symbol: "RELIANCE.NS",
        name: "Reliance Industries",
        units: 10,
        avgCost: 1300,
      },
      {
        userID: ownerID,
        kind: "FUND",
        symbol: "118989",
        name: "HDFC Index Fund",
        units: 100,
        avgCost: 50,
      },
      {
        userID: ownerID,
        kind: "STOCK",
        symbol: "BROKEN.NS",
        name: "Delisted Corp",
        units: 5,
        avgCost: 200,
      },
    ]);

  test("returns zero totals for an empty portfolio", async () => {
    const portfolio = await service.getPortfolio(ownerID);

    expect(portfolio.holdings).toEqual([]);
    expect(portfolio.allocation).toEqual([]);
    expect(portfolio.totals).toMatchObject({
      invested: 0,
      currentValue: 0,
      pnl: 0,
      pnlPercent: null,
      dayChange: 0,
      holdingCount: 0,
      pricedHoldings: 0,
      unpricedHoldings: 0,
    });
  });

  test("never values another user's holdings", async () => {
    await InvestmentModel.create({
      userID: otherUserID,
      kind: "STOCK",
      symbol: "RELIANCE.NS",
      name: "Reliance Industries",
      units: 1,
      avgCost: 100,
    });

    const portfolio = await service.getPortfolio(ownerID);

    expect(portfolio.totals.holdingCount).toBe(0);
  });

  test("keeps a holding that fails to price and values the rest", async () => {
    await seedMixedPortfolio();

    const portfolio = await service.getPortfolio(ownerID);
    const bySymbol = Object.fromEntries(
      portfolio.holdings.map((row) => [row.symbol, row]),
    );

    const reliance = bySymbol["RELIANCE.NS"];
    expect(reliance.invested).toBe(13000);
    expect(reliance.currentValue).toBe(13879);
    expect(reliance.pnl).toBe(879);
    expect(reliance.pnlPercent).toBe(6.76);
    expect(reliance.priceUnavailable).toBe(false);

    const broken = bySymbol["BROKEN.NS"];
    expect(broken.invested).toBe(1000);
    expect(broken.quote).toBeNull();
    expect(broken.currentValue).toBeNull();
    expect(broken.pnl).toBeNull();
    expect(broken.pnlPercent).toBeNull();
    expect(broken.priceUnavailable).toBe(true);

    // The unpriced holding keeps its cost in `invested` but contributes
    // nothing to `currentValue`, `dayChange` or `allocation`.
    expect(portfolio.totals).toMatchObject({
      invested: 19000,
      currentValue: 18499,
      pnl: -501,
      pnlPercent: -2.64,
      dayChange: 47,
      holdingCount: 3,
      pricedHoldings: 2,
      unpricedHoldings: 1,
    });
  });

  test("builds allocation shares from priced holdings only", async () => {
    await seedMixedPortfolio();

    const { allocation } = await service.getPortfolio(ownerID);

    expect(allocation.map((row) => row.symbol)).toEqual([
      "RELIANCE.NS",
      "118989",
    ]);
    expect(allocation[0].value).toBe(13879);
    expect(allocation[0].share).toBe(75.03);
    expect(allocation[1].value).toBe(4620);
    expect(allocation[1].share).toBe(24.97);
  });

  test("reports no profit percentage when the cost basis is zero", async () => {
    await InvestmentModel.create({
      userID: ownerID,
      kind: "STOCK",
      symbol: "RELIANCE.NS",
      name: "Reliance Industries",
      units: 10,
      avgCost: 0,
    });

    const portfolio = await service.getPortfolio(ownerID);
    const [holding] = portfolio.holdings;

    expect(holding.invested).toBe(0);
    expect(holding.currentValue).toBe(13879);
    expect(holding.pnl).toBe(13879);
    expect(holding.pnlPercent).toBeNull();
    expect(portfolio.totals.pnlPercent).toBeNull();
  });
});
