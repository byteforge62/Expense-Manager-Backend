const mongoose = require("mongoose");
const ExpenseModel = require("../models/ExpenseModel");
const IncomeModel = require("../models/IncomeModel");
const { NotFoundError } = require("../errors/AppError");

/**
 * PDF report.
 *
 * The previous implementation loaded every expense and income document into
 * memory and summed them in JavaScript. Totals now come from a grouped
 * aggregation (constant memory regardless of history size) and the itemised
 * section is bounded, with an explicit note when it is cut off.
 *
 * Data resolution (`collectReportData`) is separated from rendering
 * (`writeReport`) so the controller can obtain every record *before* it
 * commits PDF headers: a user without data must get a JSON 404, not a
 * truncated attachment.
 */
const DETAIL_LIMIT = Number(process.env.REPORT_DETAIL_LIMIT) || 1000;

const getTotals = async (Model, userId) => {
  const [result] = await Model.aggregate([
    { $match: { userID: new mongoose.Types.ObjectId(String(userId)) } },
    { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);

  return { total: result?.total || 0, count: result?.count || 0 };
};

/**
 * Loads and validates everything the report needs.
 *
 * Throws NotFoundError when the user has no income and no expenses, which is
 * the only failure mode a caller has to handle — and it happens before any
 * response has been written.
 */
const collectReportData = async (userId) => {
  const [incomeTotals, expenseTotals] = await Promise.all([
    getTotals(IncomeModel, userId),
    getTotals(ExpenseModel, userId),
  ]);

  if (incomeTotals.count === 0 && expenseTotals.count === 0) {
    throw new NotFoundError("No financial data found");
  }

  const expenses = await ExpenseModel.find({ userID: userId })
    .select("description amount date")
    .sort({ date: -1, _id: -1 })
    .limit(DETAIL_LIMIT)
    .lean();

  return {
    totalIncome: incomeTotals.total,
    totalExpense: expenseTotals.total,
    expenseCount: expenseTotals.count,
    expenses,
  };
};

/** Renders already-collected data into the PDF document. */
const writeReport = (doc, data) => {
  const { totalIncome, totalExpense, expenseCount, expenses } = data;

  doc.fontSize(20).text("Financial Report", {
    align: "center",
  });

  doc.moveDown();

  doc.fontSize(14).text(`Total Income: ₹${totalIncome}`);
  doc.text(`Total Expenses: ₹${totalExpense}`);
  doc.text(`Balance: ₹${totalIncome - totalExpense}`);

  doc.moveDown();

  doc.fontSize(16).text("Detailed Expenses:");

  doc.moveDown(0.5);

  for (const expense of expenses) {
    doc
      .fontSize(12)
      .text(`${expense.description || "Expense"} - ₹${expense.amount}`);
  }

  if (expenseCount > expenses.length) {
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .text(
        `Showing the ${expenses.length} most recent of ${expenseCount} expenses. Totals above cover all records.`,
      );
  }

  return doc;
};

/**
 * Collect-then-render in one call.
 *
 * Kept for callers that own the document lifecycle; the controller calls the
 * two halves directly so headers are only written once the data is valid.
 */
const generateReport = async (doc, userId) => {
  const data = await collectReportData(userId);

  writeReport(doc, data);

  return data;
};

module.exports = {
  DETAIL_LIMIT,
  collectReportData,
  writeReport,
  generateReport,
};
