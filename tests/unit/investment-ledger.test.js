const {
  summarizeLedger,
  ledgerFor,
} = require("../../src/modules/investments/investment-ledger");

/**
 * Ledger arithmetic. These are the numbers the portfolio reports, so they are
 * checked directly against hand-computed averages instead of through the API.
 */

const buy = (units, price, tradedAt = "2024-01-01") => ({
  type: "BUY",
  units,
  price,
  tradedAt,
});

const sell = (units, price, tradedAt = "2024-06-01") => ({
  type: "SELL",
  units,
  price,
  tradedAt,
});

describe("Investment ledger arithmetic", () => {
  test("reports an empty ledger as zero without pretending it is untracked", () => {
    const ledger = summarizeLedger([]);

    expect(ledger).toMatchObject({
      units: 0,
      avgCost: 0,
      costBasis: 0,
      realizedGain: 0,
      buyValue: 0,
      sellProceeds: 0,
      transactionCount: 0,
      lastTradeAt: null,
      untracked: false,
    });
  });

  test("weights average cost by the amount invested", () => {
    const ledger = summarizeLedger([
      buy(10, 100, "2024-01-01"),
      buy(10, 200, "2024-02-01"),
    ]);

    expect(ledger.units).toBe(20);
    expect(ledger.avgCost).toBe(150);
    expect(ledger.costBasis).toBe(3000);
    expect(ledger.realizedGain).toBe(0);
    expect(ledger.transactionCount).toBe(2);
  });

  test("realizes gain on a partial sale at the average cost", () => {
    const ledger = summarizeLedger([
      buy(10, 100),
      sell(4, 150, "2024-06-01"),
    ]);

    expect(ledger.units).toBe(6);
    expect(ledger.avgCost).toBe(100);
    expect(ledger.costBasis).toBe(600);
    expect(ledger.realizedGain).toBe(200);
    expect(ledger.sellProceeds).toBe(600);
    expect(ledger.sellCount).toBe(1);
  });

  test("uses the blended average after a second buy", () => {
    // 1,000 + 3,000 = 4,000 for 20 units, so the average is 200.
    const ledger = summarizeLedger([
      buy(10, 100, "2024-01-01"),
      buy(10, 300, "2024-03-01"),
      sell(5, 250, "2024-06-01"),
    ]);

    expect(ledger.realizedGain).toBe(250);
    expect(ledger.units).toBe(15);
    expect(ledger.avgCost).toBe(200);
    expect(ledger.costBasis).toBe(3000);
  });

  test("clears the basis when a position is sold out, then starts fresh", () => {
    const ledger = summarizeLedger([
      buy(10, 100, "2024-01-01"),
      sell(10, 120, "2024-02-01"),
      buy(5, 200, "2024-03-01"),
    ]);

    expect(ledger.realizedGain).toBe(200);
    expect(ledger.units).toBe(5);
    expect(ledger.avgCost).toBe(200);
    expect(ledger.costBasis).toBe(1000);
  });

  test("realizes a loss when selling below average cost", () => {
    const ledger = summarizeLedger([buy(8, 250), sell(3, 200)]);

    expect(ledger.realizedGain).toBe(-150);
    expect(ledger.units).toBe(5);
    expect(ledger.costBasis).toBe(1250);
  });

  test("replays by trade date, not by entry order", () => {
    // The sale is entered first but dated before the buy: at that date the
    // ledger held nothing, so it must be rejected.
    expect(() =>
      summarizeLedger([
        sell(5, 120, "2024-01-01"),
        buy(10, 100, "2024-05-01"),
      ]),
    ).toThrow(/ledger holds 0/);

    const backdated = summarizeLedger([
      buy(10, 200, "2024-05-01"),
      buy(10, 100, "2024-01-01"),
    ]);

    expect(backdated.avgCost).toBe(150);
  });

  test("rejects selling more units than were held", () => {
    expect(() => summarizeLedger([buy(10, 100), sell(11, 120)])).toThrow(
      /cannot sell 11 units: the ledger holds 10/,
    );
  });

  test("rejects a trade without positive units or a valid direction", () => {
    expect(() => summarizeLedger([buy(0, 100)])).toThrow(
      "Units must be greater than zero",
    );
    expect(() => summarizeLedger([buy(1, -5)])).toThrow(
      "Price per unit cannot be negative",
    );
    expect(() =>
      summarizeLedger([{ type: "TRANSFER", units: 1, price: 10 }]),
    ).toThrow("A transaction must be a BUY or a SELL");
  });

  test("treats zero-cost bonus units as pure gain when sold", () => {
    const ledger = summarizeLedger([buy(5, 0), sell(2, 50)]);

    expect(ledger.avgCost).toBe(0);
    expect(ledger.realizedGain).toBe(100);
    expect(ledger.units).toBe(3);
  });

  test("keeps fractional units and basis to paise", () => {
    const ledger = summarizeLedger([buy(2.5, 99.99), buy(1.25, 100.01)]);

    expect(ledger.units).toBe(3.75);
    expect(ledger.costBasis).toBe(374.99);
    expect(ledger.avgCost).toBe(99.9967);
  });

  test("reports a holding recorded before the ledger as untracked", () => {
    const ledger = ledgerFor(
      { units: 10, avgCost: 1300, investedAt: new Date("2023-04-01") },
      [],
    );

    expect(ledger).toMatchObject({
      units: 10,
      avgCost: 1300,
      costBasis: 13000,
      realizedGain: 0,
      transactionCount: 0,
      untracked: true,
    });
  });

  test("prefers recorded trades over the stored units", () => {
    const ledger = ledgerFor({ units: 999, avgCost: 1 }, [buy(4, 50)]);

    expect(ledger.units).toBe(4);
    expect(ledger.avgCost).toBe(50);
    expect(ledger.untracked).toBe(false);
  });
});
