const mongoose = require("mongoose");

const InvestmentModel = require("./models/InvestmentModel");
const InvestmentTransactionModel = require("./models/InvestmentTransactionModel");
const IncomeModel = require("../../models/IncomeModel");
const ExpenseModel = require("../../models/ExpenseModel");
const market = require("./market-data.service");
const { summarizeLedger, ledgerFor } = require("./investment-ledger");
const audit = require("../../infrastructure/audit.service");
const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} = require("../../errors/AppError");

/**
 * Investment tracking.
 *
 * A holding is the user's own record of units and average cost; the current
 * price is read from public market data at request time and never stored. All
 * advice is arithmetic on the user's ledger and the holding, not a forecast:
 * the goal planner uses a stated expected return the user can see.
 */

const round2 = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const OPENING_NOTE = "Opening balance";

/**
 * A holding can be recorded without a full trade history. The first trade on
 * such a holding is preceded by an opening buy made from the units and average
 * cost it was created with, so replaying the ledger never silently drops the
 * position the user already had.
 */
const ensureOpeningTransaction = async (holding, userId) => {
  const existing = await InvestmentTransactionModel.countDocuments({
    userID: userId,
    investmentID: holding._id,
  });

  if (existing > 0) return;

  const units = Number(holding.units);

  if (!(units > 0)) return;

  await InvestmentTransactionModel.create({
    userID: userId,
    investmentID: holding._id,
    type: "BUY",
    units,
    price: Number(holding.avgCost),
    tradedAt: holding.investedAt || new Date(),
    notes: OPENING_NOTE,
  });
};

/**
 * Units, average cost and the holding's start date are derived from its trades.
 * Throws if the derived position is negative, which can only happen when a
 * trade is backdated past a sale.
 */
const applyLedgerToHolding = async (holding, ledger) => {
  holding.units = ledger.units;
  holding.avgCost = ledger.avgCost;

  if (ledger.firstTradeAt) {
    holding.investedAt = ledger.firstTradeAt;
  }

  await holding.save();
  return holding;
};

const getHoldingDocument = async (holdingId, userId) => {
  const holding = await InvestmentModel.findById(holdingId);

  if (!holding) {
    throw new NotFoundError("Investment not found");
  }

  if (String(holding.userID) !== String(userId)) {
    throw new ForbiddenError("You are not authorized to access this investment");
  }

  return holding;
};

const createHolding = async (userId, data, context = {}) => {
  const holding = new InvestmentModel({
    ...data,
    symbol: String(data.symbol).trim().toUpperCase(),
    userID: userId,
    units: data.units ?? 0,
    avgCost: data.avgCost ?? 0,
  });

  try {
    await holding.save();
  } catch (error) {
    if (error?.code === 11000) {
      throw new ConflictError(
        "This instrument is already in your portfolio. Edit the existing holding instead.",
      );
    }

    throw error;
  }

  // The units entered here are the opening buy, so every new holding has a
  // ledger from its first day. If it cannot be written the holding is removed:
  // a position without its history would be silently wrong.
  if (Number(holding.units) > 0) {
    try {
      await InvestmentTransactionModel.create({
        userID: userId,
        investmentID: holding._id,
        type: "BUY",
        units: Number(holding.units),
        price: Number(holding.avgCost),
        tradedAt: holding.investedAt || new Date(),
        notes: OPENING_NOTE,
      });
    } catch (error) {
      await InvestmentModel.deleteOne({ _id: holding._id });
      throw error;
    }
  }

  audit.record({
    userID: userId,
    action: "investment.created",
    description: "Holding recorded",
    requestId: context.requestId,
    metadata: { investmentId: String(holding._id) },
  });

  return holding.toObject();
};

const updateHolding = async (holdingId, data, userId, context = {}) => {
  const holding = await getHoldingDocument(holdingId, userId);

  // Once a holding has trades, its units and average cost belong to the
  // ledger: editing them here would make the position disagree with its own
  // history and with the realized gain already reported.
  if (data.units !== undefined || data.avgCost !== undefined) {
    const hasTrades = await InvestmentTransactionModel.exists({
      userID: userId,
      investmentID: holding._id,
    });

    if (hasTrades) {
      throw new ValidationError(
        "This holding's units and average cost come from its trade history. Record a buy or sell instead.",
      );
    }
  }

  Object.assign(holding, {
    ...data,
    ...(data.symbol ? { symbol: String(data.symbol).trim().toUpperCase() } : {}),
  });

  try {
    await holding.save();
  } catch (error) {
    if (error?.code === 11000) {
      throw new ConflictError("Another holding already uses this instrument");
    }

    throw error;
  }

  audit.record({
    userID: userId,
    action: "investment.updated",
    description: "Holding updated",
    requestId: context.requestId,
    metadata: { investmentId: String(holding._id) },
  });

  return holding.toObject();
};

const deleteHolding = async (holdingId, userId, context = {}) => {
  const holding = await InvestmentModel.findOneAndDelete({
    _id: holdingId,
    userID: userId,
  });

  if (!holding) {
    const exists = await InvestmentModel.exists({ _id: holdingId });

    if (!exists) {
      throw new NotFoundError("Investment not found");
    }

    throw new ForbiddenError("You are not authorized to delete this investment");
  }

  await InvestmentTransactionModel.deleteMany({
    userID: userId,
    investmentID: holding._id,
  });

  audit.record({
    userID: userId,
    action: "investment.deleted",
    description: "Holding removed",
    requestId: context.requestId,
    metadata: { investmentId: String(holding._id) },
  });

  return holding;
};

const listTransactions = async (holdingId, userId) => {
  const holding = await getHoldingDocument(holdingId, userId);
  const transactions = await InvestmentTransactionModel.find({
    userID: userId,
    investmentID: holding._id,
  })
    .sort({ tradedAt: 1, createdAt: 1 })
    .lean();

  return {
    holding: {
      _id: holding._id,
      kind: holding.kind,
      symbol: holding.symbol,
      name: holding.name,
    },
    ledger: ledgerFor(holding, transactions),
    transactions,
  };
};

/**
 * Records a buy or sell and re-derives the holding.
 *
 * The ledger is replayed before anything is written, so an oversell is a 400
 * with the units actually available and leaves no partial trade behind.
 */
const addTransaction = async (holdingId, userId, data, context = {}) => {
  const holding = await getHoldingDocument(holdingId, userId);

  await ensureOpeningTransaction(holding, userId);

  const existing = await InvestmentTransactionModel.find({
    userID: userId,
    investmentID: holding._id,
  }).lean();

  const trade = {
    type: data.type,
    units: Number(data.units),
    price: Number(data.price),
    tradedAt: data.tradedAt ? new Date(data.tradedAt) : new Date(),
    ...(data.notes ? { notes: data.notes } : {}),
  };

  const ledger = summarizeLedger([...existing, trade]);

  const transaction = await InvestmentTransactionModel.create({
    ...trade,
    userID: userId,
    investmentID: holding._id,
  });

  try {
    await applyLedgerToHolding(holding, ledger);
  } catch (error) {
    // A later sale would now precede this buy only if the date is impossible;
    // keep the stored holding and the ledger in step either way.
    await InvestmentTransactionModel.deleteOne({ _id: transaction._id });
    throw error;
  }

  audit.record({
    userID: userId,
    action: "investment.transaction_recorded",
    description: `${trade.type} recorded`,
    requestId: context.requestId,
    metadata: {
      investmentId: String(holding._id),
      transactionId: String(transaction._id),
    },
  });

  return {
    transaction: transaction.toObject(),
    ledger,
    holding: holding.toObject(),
  };
};

/**
 * Removes a trade and re-derives the holding. Removing an early buy that a
 * later sale depended on would make the ledger oversold, so that trade is put
 * back and the request fails instead of corrupting the history.
 */
const removeTransaction = async (
  holdingId,
  transactionId,
  userId,
  context = {},
) => {
  const holding = await getHoldingDocument(holdingId, userId);

  const transaction = await InvestmentTransactionModel.findOneAndDelete({
    _id: transactionId,
    userID: userId,
    investmentID: holding._id,
  });

  if (!transaction) {
    const exists = await InvestmentTransactionModel.exists({
      _id: transactionId,
    });

    if (!exists) {
      throw new NotFoundError("Transaction not found");
    }

    throw new ForbiddenError(
      "You are not authorized to delete this transaction",
    );
  }

  const remaining = await InvestmentTransactionModel.find({
    userID: userId,
    investmentID: holding._id,
  }).lean();

  let ledger;

  try {
    ledger = summarizeLedger(remaining);
  } catch (error) {
    await InvestmentTransactionModel.create(transaction.toObject());
    throw error;
  }

  await applyLedgerToHolding(holding, ledger);

  audit.record({
    userID: userId,
    action: "investment.transaction_removed",
    description: "Transaction removed",
    requestId: context.requestId,
    metadata: {
      investmentId: String(holding._id),
      transactionId: String(transaction._id),
    },
  });

  return { ledger, holding: holding.toObject() };
};

const listHoldings = async (userId) =>
  InvestmentModel.find({ userID: userId }).sort({ createdAt: 1 }).lean();

/**
 * Portfolio valuation. Quotes are requested in parallel and each holding keeps
 * its own failure: one unreachable symbol shows its cost basis with a
 * "price unavailable" marker instead of failing the whole page. Cached quotes
 * mean opening the page repeatedly costs almost nothing upstream.
 */
const getPortfolio = async (userId) => {
  // One query for the user's whole ledger, grouped in memory: the page must not
  // issue a query per holding.
  const [holdings, transactions] = await Promise.all([
    listHoldings(userId),
    InvestmentTransactionModel.find({ userID: userId })
      .sort({ tradedAt: 1, createdAt: 1 })
      .lean(),
  ]);

  const tradesByHolding = new Map();

  for (const transaction of transactions) {
    const key = String(transaction.investmentID);
    if (!tradesByHolding.has(key)) tradesByHolding.set(key, []);
    tradesByHolding.get(key).push(transaction);
  }

  const quotes = await Promise.allSettled(
    holdings.map((holding) => market.quote(holding)),
  );

  let totalInvested = 0;
  let totalValue = 0;
  let dayChange = 0;
  let realizedGain = 0;
  let transactionCount = 0;
  let pricedHoldings = 0;

  const enriched = holdings.map((holding, index) => {
    const result = quotes[index];
    const ledger = ledgerFor(
      holding,
      tradesByHolding.get(String(holding._id)) || [],
    );
    const invested = round2(Number(holding.units) * Number(holding.avgCost));
    const quote = result.status === "fulfilled" ? result.value : null;
    const currentValue = quote
      ? round2(Number(holding.units) * Number(quote.price))
      : null;
    const pnl = currentValue == null ? null : round2(currentValue - invested);
    const pnlPercent =
      pnl == null || invested === 0 ? null : round2((pnl / invested) * 100);

    totalInvested += invested;
    realizedGain += ledger.realizedGain;
    transactionCount += ledger.transactionCount;

    if (currentValue != null) {
      totalValue += currentValue;
      dayChange +=
        quote.change == null ? 0 : Number(holding.units) * quote.change;
      pricedHoldings += 1;
    }

    return {
      _id: holding._id,
      kind: holding.kind,
      symbol: holding.symbol,
      name: holding.name,
      exchange: holding.exchange,
      units: holding.units,
      avgCost: holding.avgCost,
      investedAt: holding.investedAt,
      notes: holding.notes,
      invested,
      quote,
      currentValue,
      pnl,
      pnlPercent,
      priceUnavailable: quote == null,
      // Realized gain is already banked: it is not part of current value or of
      // the unrealized P&L above.
      realizedGain: ledger.realizedGain,
      transactionCount: ledger.transactionCount,
      lastTradeAt: ledger.lastTradeAt,
      ledgerUntracked: ledger.untracked,
    };
  });

  const totalPnl = round2(totalValue - totalInvested);
  const allocation = [...enriched]
    .filter((row) => row.currentValue != null)
    .sort((left, right) => right.currentValue - left.currentValue)
    .slice(0, 8)
    .map((row) => ({
      name: row.name,
      symbol: row.symbol,
      kind: row.kind,
      value: row.currentValue,
      share:
        totalValue > 0 ? round2((row.currentValue / totalValue) * 100) : 0,
    }));

  return {
    holdings: enriched,
    totals: {
      invested: round2(totalInvested),
      currentValue: round2(totalValue),
      pnl: totalPnl,
      pnlPercent:
        totalInvested > 0 ? round2((totalPnl / totalInvested) * 100) : null,
      dayChange: round2(dayChange),
      realizedGain: round2(realizedGain),
      transactionCount,
      holdingCount: holdings.length,
      pricedHoldings,
      unpricedHoldings: holdings.length - pricedHoldings,
    },
    allocation,
  };
};

/** Average monthly income/expense over a window, from recorded rows only. */
const cashFlowSnapshot = async (userId, months = 3) => {
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const userObjectId = new mongoose.Types.ObjectId(String(userId));
  const match = { userID: userObjectId, date: { $gte: since } };

  const [incomeRows, expenseRows] = await Promise.all([
    IncomeModel.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    ExpenseModel.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);

  const incomeTotal = round2(incomeRows[0]?.total || 0);
  const expenseTotal = round2(expenseRows[0]?.total || 0);
  const avgIncome = round2(incomeTotal / months);
  const avgExpenses = round2(expenseTotal / months);

  return {
    windowMonths: months,
    recordedIncome: incomeTotal,
    recordedExpenses: expenseTotal,
    avgMonthlyIncome: avgIncome,
    avgMonthlyExpenses: avgExpenses,
    monthlySurplus: round2(Math.max(avgIncome - avgExpenses, 0)),
    savingsRate:
      avgIncome > 0
        ? round2(((avgIncome - avgExpenses) / avgIncome) * 100)
        : null,
  };
};

/** Future-value-of-annuity SIP for a target, at a stated annual return. */
const requiredMonthlySip = (targetAmount, years, annualReturnPercent) => {
  const months = Math.max(Math.round(Number(years) * 12), 1);
  const monthlyRate = Number(annualReturnPercent) / 100 / 12;

  if (monthlyRate <= 0) return round2(Number(targetAmount) / months);

  return round2(
    (Number(targetAmount) * monthlyRate) /
      (Math.pow(1 + monthlyRate, months) - 1),
  );
};

const allocationForHorizon = (years) => {
  if (years <= 3) {
    return [
      { asset: "Debt / fixed income", share: 60, idea: "Short-duration debt fund, FD or a liquid fund" },
      { asset: "Equity", share: 30, idea: "Large-cap index fund" },
      { asset: "Gold", share: 10, idea: "Gold ETF or sovereign gold bond" },
    ];
  }

  if (years <= 7) {
    return [
      { asset: "Equity", share: 55, idea: "Nifty 50 / broad index fund, plus a flexi-cap fund" },
      { asset: "Debt / fixed income", share: 35, idea: "Short-duration or corporate bond fund" },
      { asset: "Gold", share: 10, idea: "Gold ETF or sovereign gold bond" },
    ];
  }

  return [
    { asset: "Equity", share: 70, idea: "Index fund core with a small mid-cap satellite" },
    { asset: "Debt / fixed income", share: 20, idea: "Debt fund or PPF for stability" },
    { asset: "Gold", share: 10, idea: "Gold ETF or sovereign gold bond" },
  ];
};

/**
 * Goal-based plan built from the user's real ledger. Every number is either
 * recorded data or an input the user supplied; the expected return is explicit
 * and the result is labelled as an estimate, not a promise.
 */
const planInvestment = async (userId, input) => {
  const years = Number(input.years);
  const targetAmount = Number(input.targetAmount);
  const expectedReturn = Number(input.expectedReturn ?? 12);
  const existingMonthly = Math.max(Number(input.existingMonthly || 0), 0);

  const [snapshot, holdings] = await Promise.all([
    cashFlowSnapshot(userId),
    InvestmentModel.find({ userID: userId })
      .select("kind name units avgCost")
      .lean(),
  ]);

  const requiredMonthly = requiredMonthlySip(
    targetAmount,
    years,
    expectedReturn,
  );
  const monthlyGap = round2(Math.max(requiredMonthly - existingMonthly, 0));
  // Never advise committing more than 40% of the surplus: the rest has to
  // cover bills, emergencies and the life the surplus exists for.
  const contributionCap = round2(snapshot.monthlySurplus * 0.4);
  const feasible = monthlyGap <= contributionCap;
  const suggestedMonthly = round2(
    Math.min(monthlyGap, Math.max(contributionCap, 0)),
  );

  const portfolioInvested = round2(
    holdings.reduce(
      (sum, holding) => sum + Number(holding.units) * Number(holding.avgCost),
      0,
    ),
  );
  const largestHolding = holdings
    .map((holding) => ({
      name: holding.name,
      invested: Number(holding.units) * Number(holding.avgCost),
    }))
    .sort((left, right) => right.invested - left.invested)[0];
  const concentration =
    portfolioInvested > 0 && largestHolding
      ? round2((largestHolding.invested / portfolioInvested) * 100)
      : null;

  const recommendations = [];

  if (snapshot.avgMonthlyIncome <= 0) {
    recommendations.push(
      "Add your income records so FinTrack can size a contribution from real cash flow.",
    );
  } else {
    recommendations.push(
      `Over the last ${snapshot.windowMonths} months you averaged ${formatInr(
        snapshot.avgMonthlyIncome,
      )} income and ${formatInr(
        snapshot.avgMonthlyExpenses,
      )} expenses, leaving about ${formatInr(snapshot.monthlySurplus)} a month.`,
    );
  }

  recommendations.push(
    `A ${years}-year goal of ${formatInr(
      targetAmount,
    )} needs roughly ${formatInr(
      requiredMonthly,
    )} a month at ${expectedReturn}% expected annual return (an estimate, not a guarantee).`,
  );

  if (!feasible) {
    recommendations.push(
      `That is above the ${formatInr(
        contributionCap,
      )} a month we would cap at 40% of your surplus. Add ${Math.max(
        years - 1,
        1,
      )} year(s) to the goal, lower the target, or raise the monthly amount only if your surplus grows.`,
    );
  } else if (monthlyGap === 0) {
    recommendations.push(
      "Your existing monthly contribution already covers this goal at the stated return.",
    );
  } else {
    recommendations.push(
      `Setting aside ${formatInr(
        suggestedMonthly,
      )} a month keeps this goal within 40% of your surplus.`,
    );
  }

  recommendations.push(
    `Keep an emergency fund of about ${formatInr(
      snapshot.avgMonthlyExpenses * 6,
    )} (six months of expenses) before increasing market exposure.`,
  );

  if (holdings.length === 0) {
    recommendations.push(
      "Start with one broad index fund rather than a single stock; add holdings here only for what you already own.",
    );
  } else if (concentration != null && concentration >= 60) {
    recommendations.push(
      `${largestHolding.name} is about ${concentration}% of your invested amount. Consider spreading new money across an index fund to reduce single-holding risk.`,
    );
  } else if (holdings.length < 3) {
    recommendations.push(
      "Two or three diversified funds usually carry less single-fund risk than one concentrated position.",
    );
  }

  return {
    snapshot,
    goal: {
      targetAmount: round2(targetAmount),
      years,
      expectedReturn,
      requiredMonthly,
      existingMonthly: round2(existingMonthly),
      monthlyGap,
      contributionCap,
      suggestedMonthly,
      feasible,
    },
    portfolio: {
      holdingCount: holdings.length,
      invested: portfolioInvested,
      concentration,
    },
    allocation: allocationForHorizon(years),
    recommendations,
  };
};

const formatInr = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;

module.exports = {
  createHolding,
  updateHolding,
  deleteHolding,
  listHoldings,
  listTransactions,
  addTransaction,
  removeTransaction,
  getPortfolio,
  planInvestment,
  cashFlowSnapshot,
  requiredMonthlySip,
  allocationForHorizon,
};
