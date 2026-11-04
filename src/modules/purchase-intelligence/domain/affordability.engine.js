
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 30.4375;
const RESERVE_MONTHS = 3;
const COMMITMENT_HORIZON_DAYS = 30;
const MAX_RECURRING_OCCURRENCES = 1000;

const roundCurrency = (value) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toId = (value) => {
  if (value === undefined || value === null) return null;
  return String(value);
};

const normalizeTransactions = (transactions, cutoff, now) =>
  transactions
    .map((transaction) => ({
      amount: Number(transaction.amount),
      date: new Date(transaction.date),
      recurringId: toId(transaction.recurringId),
    }))
    .filter(
      (transaction) =>
        Number.isFinite(transaction.amount) &&
        transaction.amount >= 0 &&
        !Number.isNaN(transaction.date.getTime()) &&
        transaction.date >= cutoff &&
        transaction.date <= now,
    );

const addFrequency = (date, frequency) => {
  const next = new Date(date);

  switch (frequency) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;

    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      break;

    case "monthly": {
      const originalDay = next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);

      const lastDay = new Date(
        Date.UTC(
          next.getUTCFullYear(),
          next.getUTCMonth() + 1,
          0,
        ),
      ).getUTCDate();

      next.setUTCDate(Math.min(originalDay, lastDay));
      break;
    }

    case "yearly": {
      const originalMonth = next.getUTCMonth();
      const originalDay = next.getUTCDate();

      next.setUTCDate(1);
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      next.setUTCMonth(originalMonth);

      const lastDay = new Date(
        Date.UTC(
          next.getUTCFullYear(),
          originalMonth + 1,
          0,
        ),
      ).getUTCDate();

      next.setUTCDate(Math.min(originalDay, lastDay));
      break;
    }

    default:
      throw new TypeError(`Unsupported recurring frequency: ${frequency}`);
  }

  return next;
};

const getMonthlyEquivalent = (amount, frequency) => {
  switch (frequency) {
    case "daily":
      return amount * MONTH_DAYS;

    case "weekly":
      return (amount * MONTH_DAYS) / 7;

    case "monthly":
      return amount;

    case "yearly":
      return amount / 12;

    default:
      throw new TypeError(`Unsupported recurring frequency: ${frequency}`);
  }
};

const normalizeRecurringSchedules = (schedules) =>
  schedules
    .map((schedule) => ({
      id: toId(schedule._id || schedule.id),
      title: schedule.title || "Recurring transaction",
      amount: Number(schedule.amount),
      type: String(schedule.type || "").toUpperCase(),
      frequency: String(schedule.frequency || "").toLowerCase(),
      nextDate: new Date(schedule.nextDate),
      recurrenceAnchorDay: Number(schedule.recurrenceAnchorDay) || null,
      recurrenceAnchorMonth:
        schedule.recurrenceAnchorMonth === undefined ||
          schedule.recurrenceAnchorMonth === null
          ? null
          : Number(schedule.recurrenceAnchorMonth),
    }))
    .filter(
      (schedule) =>
        schedule.id &&
        Number.isFinite(schedule.amount) &&
        schedule.amount > 0 &&
        ["INCOME", "EXPENSE"].includes(schedule.type) &&
        ["daily", "weekly", "monthly", "yearly"].includes(
          schedule.frequency,
        ) &&
        !Number.isNaN(schedule.nextDate.getTime()),
    );

const calculateRecurringOccurrences = (schedules, now, horizonEnd) => {
  const totals = {
    income: 0,
    expenses: 0,
    incomeOccurrences: 0,
    expenseOccurrences: 0,
  };

  for (const schedule of schedules) {
    let occurrenceDate = new Date(schedule.nextDate);
    let occurrenceCount = 0;

    while (occurrenceDate <= horizonEnd) {
      if (occurrenceCount >= MAX_RECURRING_OCCURRENCES) {
        throw new RangeError(
          "Recurring schedule exceeds the supported occurrence limit",
        );
      }

      // Include overdue occurrences because the recurring cron may not
      // have processed them yet.
      if (schedule.type === "INCOME") {
        totals.income += schedule.amount;
        totals.incomeOccurrences += 1;
      } else {
        totals.expenses += schedule.amount;
        totals.expenseOccurrences += 1;
      }

      occurrenceCount += 1;
      occurrenceDate = addFrequency(
        occurrenceDate,
        schedule.frequency,
        schedule,
      );
    }
  }

  return totals;
};

const normalizePendingBills = (bills, now, horizonEnd) =>
  bills
    .map((bill) => ({
      name: bill.name || "Pending bill",
      amount: Number(bill.amount),
      dueDate: new Date(bill.dueDate),
    }))
    .filter(
      (bill) =>
        Number.isFinite(bill.amount) &&
        bill.amount > 0 &&
        !Number.isNaN(bill.dueDate.getTime()) &&
        bill.dueDate <= horizonEnd,
    );

const calculateAffordability = ({
  availableCash,
  purchasePrice,
  incomeTransactions,
  expenseTransactions,
  pendingBills = [],
  recurringSchedules = [],
  now = new Date(),
}) => {
  if (!Number.isFinite(availableCash) || availableCash < 0) {
    throw new TypeError(
      "Available cash must be a non-negative finite number",
    );
  }

  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
    throw new TypeError(
      "Purchase price must be a positive finite number",
    );
  }

  if (
    !Array.isArray(incomeTransactions) ||
    !Array.isArray(expenseTransactions)
  ) {
    throw new TypeError("Financial transactions must be arrays");
  }

  if (!Array.isArray(pendingBills)) {
    throw new TypeError("Pending bills must be an array");
  }

  if (!Array.isArray(recurringSchedules)) {
    throw new TypeError("Recurring schedules must be an array");
  }

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("Analysis timestamp must be a valid Date");
  }

  const cutoff = new Date(now.getTime() - 90 * DAY_MS);
  const horizonEnd = new Date(
    now.getTime() + COMMITMENT_HORIZON_DAYS * DAY_MS,
  );

  const normalizedIncome = normalizeTransactions(
    incomeTransactions,
    cutoff,
    now,
  );

  const normalizedExpenses = normalizeTransactions(
    expenseTransactions,
    cutoff,
    now,
  );

  const allTransactions = [
    ...normalizedIncome,
    ...normalizedExpenses,
  ];

  const oldestTimestamp = allTransactions.reduce(
    (oldest, transaction) =>
      Math.min(oldest, transaction.date.getTime()),
    Number.POSITIVE_INFINITY,
  );

  const observedDays =
    allTransactions.length === 0
      ? 0
      : Math.max(
        1,
        Math.ceil((now.getTime() - oldestTimestamp) / DAY_MS) + 1,
      );

  const calculationDays =
    observedDays === 0
      ? 90
      : Math.min(90, Math.max(30, observedDays));

  const schedules = normalizeRecurringSchedules(recurringSchedules);

  const activeScheduleIds = new Set(
    schedules.map((schedule) => schedule.id),
  );

  // Historical transactions belonging to active recurring schedules
  // are excluded from the baseline. Their future occurrences are
  // projected separately.
  const baselineIncome = normalizedIncome.filter(
    (transaction) =>
      !transaction.recurringId ||
      !activeScheduleIds.has(transaction.recurringId),
  );

  const baselineExpenses = normalizedExpenses.filter(
    (transaction) =>
      !transaction.recurringId ||
      !activeScheduleIds.has(transaction.recurringId),
  );

  const historicalIncome = baselineIncome.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );

  const historicalExpenses = baselineExpenses.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );

  const historicalMonthlyIncome =
    (historicalIncome / calculationDays) * MONTH_DAYS;

  const historicalMonthlyExpenses =
    (historicalExpenses / calculationDays) * MONTH_DAYS;

  const recurringMonthlyIncome = schedules
    .filter((schedule) => schedule.type === "INCOME")
    .reduce(
      (sum, schedule) =>
        sum +
        getMonthlyEquivalent(schedule.amount, schedule.frequency),
      0,
    );

  const recurringMonthlyExpenses = schedules
    .filter((schedule) => schedule.type === "EXPENSE")
    .reduce(
      (sum, schedule) =>
        sum +
        getMonthlyEquivalent(schedule.amount, schedule.frequency),
      0,
    );

  const monthlyIncome =
    historicalMonthlyIncome + recurringMonthlyIncome;

  const monthlyExpenses =
    historicalMonthlyExpenses + recurringMonthlyExpenses;

  const monthlyNetCashFlow = monthlyIncome - monthlyExpenses;

  const recurringOccurrences = calculateRecurringOccurrences(
    schedules,
    now,
    horizonEnd,
  );

  const normalizedBills = normalizePendingBills(
    pendingBills,
    now,
    horizonEnd,
  );

  const pendingBillsTotal = normalizedBills.reduce(
    (sum, bill) => sum + bill.amount,
    0,
  );

  const postPurchaseCash = availableCash - purchasePrice;

  const netUpcomingCommitments =
    pendingBillsTotal +
    recurringOccurrences.expenses -
    recurringOccurrences.income;

  const cashAfterPurchaseAndCommitments =
    postPurchaseCash - netUpcomingCommitments;

  const emergencyReserveTarget =
    monthlyExpenses * RESERVE_MONTHS;

  const postPurchaseRunwayMonths =
    monthlyExpenses > 0
      ? Math.max(0, cashAfterPurchaseAndCommitments) /
      monthlyExpenses
      : null;

  const savingsRate =
    monthlyIncome > 0
      ? (monthlyNetCashFlow / monthlyIncome) * 100
      : null;

  // The upcoming recurring occurrences and bills are already reflected
  // in the commitment-adjusted cash position. The baseline monthly
  // projection therefore uses historical non-recurring cash flow only.
  const baselineMonthlyNetCashFlow =
    historicalMonthlyIncome - historicalMonthlyExpenses;

  const oneMonthProjection =
    cashAfterPurchaseAndCommitments + baselineMonthlyNetCashFlow;

  const incomeReductionProjection =
    oneMonthProjection -
    (monthlyIncome * 0.15);

  const unexpectedExpenseProjection =
    oneMonthProjection - monthlyExpenses;

  const historyConfidence =
    observedDays >= 60
      ? "HIGH"
      : observedDays >= 30
        ? "MEDIUM"
        : "LOW";

  const hasIncomeEvidence =
    normalizedIncome.length > 0 ||
    schedules.some((schedule) => schedule.type === "INCOME");

  const hasExpenseEvidence =
    normalizedExpenses.length > 0 ||
    schedules.some((schedule) => schedule.type === "EXPENSE");

  let riskLevel = "LOW";
  let recommendation = "PURCHASE_WITHIN_PLAN";
  let summary =
    "The purchase remains above the estimated emergency reserve after accounting for known upcoming commitments.";

  if (!hasIncomeEvidence || !hasExpenseEvidence) {
    riskLevel = "MODERATE";
    recommendation = "INSUFFICIENT_FINANCIAL_HISTORY";
    summary =
      "The available financial records are incomplete, so this assessment cannot establish purchase affordability with sufficient confidence.";
  } else if (
    postPurchaseCash < 0 ||
    cashAfterPurchaseAndCommitments < 0
  ) {
    riskLevel = "CRITICAL";
    recommendation = "DO_NOT_PURCHASE_NOW";
    summary =
      "The purchase and known upcoming commitments exceed the available cash balance.";
  } else if (
    cashAfterPurchaseAndCommitments < emergencyReserveTarget
  ) {
    riskLevel = "HIGH";
    recommendation = "DELAY_OR_REDUCE_COST";
    summary =
      "The purchase and known upcoming commitments would reduce the remaining cash below the estimated three-month expense reserve.";
  } else if (
    monthlyNetCashFlow <= 0 ||
    unexpectedExpenseProjection < 0 ||
    incomeReductionProjection < emergencyReserveTarget
  ) {
    riskLevel = "MODERATE";
    recommendation = "REVIEW_TIMING_AND_COMMITMENTS";
    summary =
      "The purchase is covered by the entered cash balance, but one or more stress scenarios weaken the remaining financial buffer.";
  }

  const warnings = [];

  if (observedDays < 60) {
    warnings.push(
      "Fewer than 60 days of transaction history were found; historical monthly averages have lower confidence.",
    );
  }

  if (!hasIncomeEvidence) {
    warnings.push(
      "No income records or active recurring income schedules were found.",
    );
  }

  if (!hasExpenseEvidence) {
    warnings.push(
      "No expense records or active recurring expense schedules were found; the emergency reserve estimate may be understated.",
    );
  }

  if (normalizedBills.length > 0) {
    warnings.push(
      "Pending bills due within the next 30 days are included. Bills must be explicitly linked to their recorded expense when settled to avoid duplicate obligations.",
    );
  }

  warnings.push(
    "Available cash is user-entered. Loans, credit-card balances, EMIs, and off-platform obligations are excluded unless represented by pending bills, recurring schedules, or recorded transactions.",
  );

  return {
    currency: "INR",
    analysisPeriodDays: calculationDays,
    observedHistoryDays: observedDays,
    historyConfidence,

    inputs: {
      availableCash: roundCurrency(availableCash),
      purchasePrice: roundCurrency(purchasePrice),
    },

    metrics: {
      averageMonthlyIncome: roundCurrency(monthlyIncome),
      averageMonthlyExpenses: roundCurrency(monthlyExpenses),
      averageMonthlyNetCashFlow: roundCurrency(monthlyNetCashFlow),

      savingsRatePercent:
        savingsRate === null ? null : roundCurrency(savingsRate),

      emergencyReserveTarget: roundCurrency(
        emergencyReserveTarget,
      ),

      cashAfterPurchase: roundCurrency(postPurchaseCash),

      pendingBillsTotal: roundCurrency(pendingBillsTotal),

      upcomingRecurringExpenses: roundCurrency(
        recurringOccurrences.expenses,
      ),

      upcomingRecurringIncome: roundCurrency(
        recurringOccurrences.income,
      ),

      netUpcomingCommitments: roundCurrency(
        netUpcomingCommitments,
      ),

      cashAfterPurchaseAndCommitments: roundCurrency(
        cashAfterPurchaseAndCommitments,
      ),

      emergencyReserveCoverageMonths:
        postPurchaseRunwayMonths === null
          ? null
          : roundCurrency(postPurchaseRunwayMonths),

      purchaseAsPercentOfAvailableCash:
        availableCash > 0
          ? roundCurrency((purchasePrice / availableCash) * 100)
          : null,
    },

    commitments: {
      horizonDays: COMMITMENT_HORIZON_DAYS,
      pendingBillsCount: normalizedBills.length,
      recurringIncomeOccurrences:
        recurringOccurrences.incomeOccurrences,
      recurringExpenseOccurrences:
        recurringOccurrences.expenseOccurrences,
    },

    scenarios: {
      oneMonthAfterPurchase: roundCurrency(oneMonthProjection),
      incomeFallsBy15Percent: roundCurrency(
        incomeReductionProjection,
      ),
      unexpectedExpenseOfOneAverageMonth: roundCurrency(
        unexpectedExpenseProjection,
      ),
    },

    risk: {
      level: riskLevel,
      recommendation,
      summary,
    },

    warnings,

    methodology: {
      averageMonthlyIncome:
        "Historical non-recurring income in the trailing 90-day window divided by observed history days (minimum 30), multiplied by 30.4375, plus monthly-equivalent amounts from active recurring income schedules.",

      averageMonthlyExpenses:
        "Historical non-recurring expenses in the trailing 90-day window divided by observed history days (minimum 30), multiplied by 30.4375, plus monthly-equivalent amounts from active recurring expense schedules.",

      recurringTransactions:
        "Historical transactions linked to active recurring schedules are excluded from historical averages. Future schedule occurrences are projected separately to avoid double counting.",

      upcomingCommitments:
        "Pending bills due within 30 days and active recurring schedule occurrences due within 30 days are included. Recurring income offsets recurring expense obligations.",

      emergencyReserve:
        `${RESERVE_MONTHS} multiplied by average monthly expenses, including active recurring expense schedules.`,

      incomeStress:
        "One-month commitment-adjusted projection with total average monthly income reduced by 15%.",

      unexpectedExpenseStress:
        "One-month commitment-adjusted projection less one average month of expenses.",
    },

    analyzedAt: now.toISOString(),
  };
};

module.exports = { calculateAffordability };
