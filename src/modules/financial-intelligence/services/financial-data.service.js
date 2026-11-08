const normalizeId = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  return String(typeof value === "object" && value._id ? value._id : value);
};

const normalizeAmount = (value, fieldName, { optional = false } = {}) => {
  if (optional && (value === undefined || value === null)) {
    return null;
  }

  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }
  return amount;
};

const normalizeDate = (value, fieldName, { optional = false } = {}) => {
  if (optional && (value === undefined || value === null)) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${fieldName} must be a valid date`);
  }
  return date;
};

const normalizeTransactions = (records, fieldName, kind) =>
  records.map((record, index) => ({
    _id: normalizeId(record._id),
    amount: normalizeAmount(record.amount, `${fieldName}[${index}].amount`),
    date: normalizeDate(record.date, `${fieldName}[${index}].date`),
    ...(kind === "expense"
      ? { categoryID: normalizeId(record.categoryID) }
      : { source: record.source || null }),
  }));

const normalizeFinancialRecords = (records) => {
  const categories = (records.categories || []).map((category) => ({
    _id: normalizeId(category._id),
    name: category.name || "Uncategorized",
    type: category.type,
  }));
  const categoryLookup = new Map(
    categories.map((category) => [category._id, category]),
  );

  return {
    ...records,
    expenses: normalizeTransactions(records.expenses || [], "expenses", "expense"),
    incomes: normalizeTransactions(records.incomes || [], "incomes", "income"),
    historicalExpenses: normalizeTransactions(
      records.historicalExpenses || [],
      "historicalExpenses",
      "expense",
    ),
    historicalIncomes: normalizeTransactions(
      records.historicalIncomes || [],
      "historicalIncomes",
      "income",
    ),
    budgets: (records.budgets || []).map((budget, index) => ({
      categoryID: normalizeId(budget.categoryID),
      amount: normalizeAmount(budget.amount, `budgets[${index}].amount`, {
        optional: true,
      }),
      start_date: normalizeDate(
        budget.start_date,
        `budgets[${index}].start_date`,
        { optional: true },
      ),
      end_date: normalizeDate(
        budget.end_date,
        `budgets[${index}].end_date`,
        { optional: true },
      ),
    })),
    bills: (records.bills || []).map((bill, index) => ({
      _id: normalizeId(bill._id),
      name: bill.name || null,
      amount: normalizeAmount(bill.amount, `bills[${index}].amount`),
      dueDate: normalizeDate(bill.dueDate, `bills[${index}].dueDate`),
      status: String(bill.status || "").toLowerCase(),
      settledExpenseId: normalizeId(bill.settledExpenseId),
    })),
    recurringSchedules: (records.recurringSchedules || []).map(
      (schedule, index) => ({
        _id: normalizeId(schedule._id),
        title: schedule.title || null,
        amount: normalizeAmount(
          schedule.amount,
          `recurringSchedules[${index}].amount`,
        ),
        type: String(schedule.type || "UNCLASSIFIED").toUpperCase(),
        frequency: String(schedule.frequency || "").toLowerCase(),
        nextDate: normalizeDate(
          schedule.nextDate,
          `recurringSchedules[${index}].nextDate`,
        ),
        isActive: schedule.isActive === true,
      }),
    ),
    categories,
    categoryLookup,
  };
};

module.exports = {
  normalizeFinancialRecords,
};
