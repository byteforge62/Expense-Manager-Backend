const { ValidationError } = require("../../errors/AppError");

/**
 * Ledger arithmetic for a holding.
 *
 * Everything here is pure: a holding's units and average cost are the result
 * of replaying its dated trades, and realized gain is the average-cost method
 * applied at each sale. Keeping this free of the database means the arithmetic
 * can be checked directly, and the service only has to persist the result.
 */

const roundTo = (value, decimals) => {
  if (!Number.isFinite(Number(value))) return 0;

  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

const round2 = (value) => roundTo(value, 2);
const round4 = (value) => roundTo(value, 4);

// Units are fractional (mutual fund units, splits), so "sold everything" is a
// float comparison rather than an exact one.
const UNITS_EPSILON = 1e-6;

const tradeDate = (transaction) => {
  const date = new Date(transaction.tradedAt);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
};

/**
 * Trades are replayed by trade date, not by the order they were entered: a
 * backdated buy changes the average cost of every sale that follows it.
 */
const chronologically = (transactions) =>
  [...transactions].sort((left, right) => {
    const byDate = tradeDate(left) - tradeDate(right);

    if (byDate !== 0) return byDate;

    const byCreated =
      new Date(left.createdAt || 0) - new Date(right.createdAt || 0);

    if (byCreated !== 0) return byCreated;

    return String(left._id ?? "").localeCompare(String(right._id ?? ""));
  });

const assertTrade = (transaction) => {
  const quantity = Number(transaction.units);
  const price = Number(transaction.price);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError("Units must be greater than zero");
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new ValidationError("Price per unit cannot be negative");
  }

  if (transaction.type !== "BUY" && transaction.type !== "SELL") {
    throw new ValidationError("A transaction must be a BUY or a SELL");
  }

  return { quantity, price };
};

/**
 * Replays a holding's trades.
 *
 * A BUY adds units and their cost. A SELL removes units at the average cost at
 * that moment, so the remaining basis stays attached to the units still held
 * and the difference against the sale price is realized gain.
 */
const summarizeLedger = (transactions = []) => {
  let units = 0;
  let costBasis = 0;
  let buyValue = 0;
  let sellProceeds = 0;
  let realizedGain = 0;
  let buyCount = 0;
  let sellCount = 0;
  let firstTradeAt = null;
  let lastTradeAt = null;

  for (const transaction of chronologically(transactions)) {
    const { quantity, price } = assertTrade(transaction);

    if (transaction.type === "BUY") {
      units += quantity;
      costBasis += quantity * price;
      buyValue += quantity * price;
      buyCount += 1;
    } else {
      if (quantity > units + UNITS_EPSILON) {
        throw new ValidationError(
          `You cannot sell ${round4(quantity)} units: the ledger holds ${round4(
            units,
          )} units at that date`,
        );
      }

      // Average cost can only be derived while units are held; a sale on an
      // empty ledger is rejected above.
      const averageCost = units > 0 ? costBasis / units : 0;

      realizedGain += quantity * price - quantity * averageCost;
      costBasis -= quantity * averageCost;
      units -= quantity;
      sellProceeds += quantity * price;
      sellCount += 1;

      if (units <= UNITS_EPSILON) {
        // Close the position exactly: repeated sales would otherwise leave a
        // fraction of a paisa of cost behind.
        units = 0;
        costBasis = 0;
      }
    }

    const date = tradeDate(transaction);
    if (!firstTradeAt) firstTradeAt = date;
    lastTradeAt = date;
  }

  return {
    units: round4(units),
    avgCost: units > 0 ? round4(costBasis / units) : 0,
    costBasis: round2(costBasis),
    realizedGain: round2(realizedGain),
    buyValue: round2(buyValue),
    sellProceeds: round2(sellProceeds),
    buyCount,
    sellCount,
    transactionCount: buyCount + sellCount,
    firstTradeAt,
    lastTradeAt,
    untracked: false,
  };
};

/**
 * A holding recorded before the ledger existed has no trades. Its entered
 * units and average cost are still the user's cost basis, so they are reported
 * as an untracked ledger rather than as an empty position.
 */
const ledgerFor = (holding, transactions = []) => {
  if (transactions.length > 0) {
    return summarizeLedger(transactions);
  }

  const units = Number(holding?.units || 0);
  const avgCost = Number(holding?.avgCost || 0);
  const costBasis = round2(units * avgCost);

  return {
    units: round4(units),
    avgCost: round4(avgCost),
    costBasis,
    realizedGain: 0,
    buyValue: costBasis,
    sellProceeds: 0,
    buyCount: 0,
    sellCount: 0,
    transactionCount: 0,
    firstTradeAt: holding?.investedAt || null,
    lastTradeAt: null,
    untracked: true,
  };
};

module.exports = {
  summarizeLedger,
  ledgerFor,
  round2,
  round4,
};
