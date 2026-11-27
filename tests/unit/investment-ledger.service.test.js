const mongoose = require("mongoose");

const InvestmentModel = require("../../src/modules/investments/models/InvestmentModel");
const InvestmentTransactionModel = require("../../src/modules/investments/models/InvestmentTransactionModel");
const market = require("../../src/modules/investments/market-data.service");
const service = require("../../src/modules/investments/investment.service");

jest.setTimeout(30000);

/**
 * The transaction ledger against the database: a holding's units and average
 * cost come from its trades, and a sale reports realized gain. Quotes are
 * stubbed so no test reaches a market provider.
 */
describe("Investment transaction ledger", () => {
  const ownerID = new mongoose.Types.ObjectId();
  const otherUserID = new mongoose.Types.ObjectId();
  let quoteSpy;

  const cleanup = async () => {
    await InvestmentTransactionModel.deleteMany({
      userID: { $in: [ownerID, otherUserID] },
    });
    await InvestmentModel.deleteMany({
      userID: { $in: [ownerID, otherUserID] },
    });
  };

  beforeEach(async () => {
    await cleanup();
    quoteSpy = jest
      .spyOn(market, "quote")
      .mockResolvedValue({ price: 150, change: 2 });
  });

  afterEach(() => {
    quoteSpy.mockRestore();
  });

  afterAll(cleanup);

  const createHolding = (overrides = {}) =>
    service.createHolding(ownerID, {
      kind: "STOCK",
      symbol: "RELIANCE.NS",
      name: "Reliance Industries",
      units: 10,
      avgCost: 100,
      investedAt: new Date("2024-01-01"),
      ...overrides,
    });

  test("records the opening buy with the holding", async () => {
    const holding = await createHolding();

    const { ledger, transactions } = await service.listTransactions(
      holding._id,
      ownerID,
    );

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      type: "BUY",
      units: 10,
      price: 100,
      notes: "Opening balance",
    });
    expect(ledger).toMatchObject({
      units: 10,
      avgCost: 100,
      realizedGain: 0,
      transactionCount: 1,
      untracked: false,
    });
  });

  test("derives units, average cost and realized gain from the trades", async () => {
    const holding = await createHolding();

    const afterBuy = await service.addTransaction(holding._id, ownerID, {
      type: "BUY",
      units: 10,
      price: 200,
      tradedAt: new Date("2024-02-01"),
    });

    expect(afterBuy.ledger).toMatchObject({
      units: 20,
      avgCost: 150,
      costBasis: 3000,
      realizedGain: 0,
      transactionCount: 2,
    });
    expect(afterBuy.holding.units).toBe(20);
    expect(afterBuy.holding.avgCost).toBe(150);

    const afterSell = await service.addTransaction(holding._id, ownerID, {
      type: "SELL",
      units: 5,
      price: 250,
      tradedAt: new Date("2024-06-01"),
    });

    expect(afterSell.ledger).toMatchObject({
      units: 15,
      avgCost: 150,
      costBasis: 2250,
      realizedGain: 500,
      sellProceeds: 1250,
    });
    expect(afterSell.holding.units).toBe(15);
    expect(afterSell.holding.avgCost).toBe(150);
    // The holding starts at its earliest trade, not at the last one.
    expect(afterSell.holding.investedAt.toISOString()).toBe(
      "2024-01-01T00:00:00.000Z",
    );
  });

  test("rejects an oversell and writes nothing", async () => {
    const holding = await createHolding();

    await expect(
      service.addTransaction(holding._id, ownerID, {
        type: "SELL",
        units: 11,
        price: 150,
      }),
    ).rejects.toThrow(/cannot sell 11 units: the ledger holds 10/);

    const stored = await InvestmentModel.findById(holding._id).lean();
    expect(stored.units).toBe(10);
    expect(
      await InvestmentTransactionModel.countDocuments({
        investmentID: holding._id,
      }),
    ).toBe(1);
  });

  test("keeps the trade banked when removing it would oversell later sales", async () => {
    const holding = await createHolding();

    await service.addTransaction(holding._id, ownerID, {
      type: "SELL",
      units: 8,
      price: 120,
      tradedAt: new Date("2024-03-01"),
    });

    const { transactions } = await service.listTransactions(
      holding._id,
      ownerID,
    );
    const opening = transactions.find((row) => row.notes === "Opening balance");

    await expect(
      service.removeTransaction(holding._id, opening._id, ownerID),
    ).rejects.toThrow(/cannot sell 8 units/);

    const stored = await InvestmentModel.findById(holding._id).lean();
    expect(stored.units).toBe(2);
    expect(
      await InvestmentTransactionModel.countDocuments({
        investmentID: holding._id,
      }),
    ).toBe(2);
  });

  test("removing a sale restores the units and clears its realized gain", async () => {
    const holding = await createHolding();

    const sale = await service.addTransaction(holding._id, ownerID, {
      type: "SELL",
      units: 4,
      price: 150,
      tradedAt: new Date("2024-04-01"),
    });

    expect(sale.ledger.realizedGain).toBe(200);

    const result = await service.removeTransaction(
      holding._id,
      sale.transaction._id,
      ownerID,
    );

    expect(result.ledger).toMatchObject({
      units: 10,
      avgCost: 100,
      realizedGain: 0,
      transactionCount: 1,
    });
    expect(result.holding.units).toBe(10);
  });

  test("removing the last trade leaves an empty position", async () => {
    const holding = await createHolding();
    const { transactions } = await service.listTransactions(
      holding._id,
      ownerID,
    );

    const result = await service.removeTransaction(
      holding._id,
      transactions[0]._id,
      ownerID,
    );

    expect(result.ledger.units).toBe(0);
    expect(result.holding.units).toBe(0);
    expect(result.holding.avgCost).toBe(0);
  });

  test("seeds an opening buy for a holding recorded without history", async () => {
    const legacy = await InvestmentModel.create({
      userID: ownerID,
      kind: "STOCK",
      symbol: "TCS.NS",
      name: "Tata Consultancy Services",
      units: 10,
      avgCost: 50,
      investedAt: new Date("2023-01-01"),
    });

    const untracked = await service.listTransactions(legacy._id, ownerID);
    expect(untracked.ledger).toMatchObject({
      units: 10,
      avgCost: 50,
      costBasis: 500,
      transactionCount: 0,
      untracked: true,
    });

    const result = await service.addTransaction(legacy._id, ownerID, {
      type: "BUY",
      units: 5,
      price: 80,
      tradedAt: new Date("2024-02-01"),
    });

    expect(result.ledger).toMatchObject({
      units: 15,
      avgCost: 60,
      costBasis: 900,
      transactionCount: 2,
      untracked: false,
    });
  });

  test("reports realized gain separately from unrealized profit", async () => {
    const holding = await createHolding();

    await service.addTransaction(holding._id, ownerID, {
      type: "SELL",
      units: 4,
      price: 150,
      tradedAt: new Date("2024-02-01"),
    });

    const portfolio = await service.getPortfolio(ownerID);
    const [row] = portfolio.holdings;

    // 6 units at 100 cost, quoted at 150.
    expect(row.units).toBe(6);
    expect(row.invested).toBe(600);
    expect(row.currentValue).toBe(900);
    expect(row.pnl).toBe(300);
    expect(row.realizedGain).toBe(200);
    expect(row.transactionCount).toBe(2);
    expect(row.ledgerUntracked).toBe(false);

    expect(portfolio.totals).toMatchObject({
      invested: 600,
      currentValue: 900,
      pnl: 300,
      realizedGain: 200,
      transactionCount: 2,
    });

    expect(holding._id).toBeDefined();
  });

  test("refuses to overwrite units that come from the ledger", async () => {
    const holding = await createHolding();

    await expect(
      service.updateHolding(holding._id, { units: 99 }, ownerID),
    ).rejects.toThrow(/come from its trade history/);

    const stored = await InvestmentModel.findById(holding._id).lean();
    expect(stored.units).toBe(10);

    // Descriptive fields are still editable on a tracked holding.
    const renamed = await service.updateHolding(
      holding._id,
      { notes: "Long-term" },
      ownerID,
    );

    expect(renamed.notes).toBe("Long-term");
    expect(renamed.units).toBe(10);
  });

  test("never exposes or mutates another user's ledger", async () => {
    const holding = await createHolding();
    const { transactions } = await service.listTransactions(
      holding._id,
      ownerID,
    );

    await expect(
      service.listTransactions(holding._id, otherUserID),
    ).rejects.toThrow(/not authorized/i);

    await expect(
      service.addTransaction(holding._id, otherUserID, {
        type: "BUY",
        units: 1,
        price: 100,
      }),
    ).rejects.toThrow(/not authorized/i);

    await expect(
      service.removeTransaction(holding._id, transactions[0]._id, otherUserID),
    ).rejects.toThrow(/not authorized/i);

    expect(
      await InvestmentTransactionModel.countDocuments({
        investmentID: holding._id,
      }),
    ).toBe(1);
  });

  test("refuses a transaction that belongs to another holding", async () => {
    const first = await createHolding();
    const second = await createHolding({
      symbol: "INFY.NS",
      name: "Infosys",
      units: 3,
      avgCost: 1400,
    });

    const secondLedger = await service.listTransactions(second._id, ownerID);

    await expect(
      service.removeTransaction(
        first._id,
        secondLedger.transactions[0]._id,
        ownerID,
      ),
    ).rejects.toThrow(/not authorized/i);

    expect(
      await InvestmentTransactionModel.countDocuments({
        investmentID: second._id,
      }),
    ).toBe(1);
  });

  test("deleting a holding removes its history", async () => {
    const holding = await createHolding();

    await service.deleteHolding(holding._id, ownerID);

    expect(
      await InvestmentTransactionModel.countDocuments({
        investmentID: holding._id,
      }),
    ).toBe(0);
  });
});
