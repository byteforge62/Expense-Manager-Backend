const mongoose = require("mongoose");
const ExpenseModel = require("../models/ExpenseModel");
const IncomeModel = require("../models/IncomeModel");
const NotFoundError = require("../errors/NotFoundError");

/**
 * PDF report.
 *
 * The previous implementation loaded every expense and income document into
 * memory and summed them in JavaScript. Totals now come from a grouped
 * aggregation (constant memory regardless of history size) and the itemised
 * section is bounded, with an explicit note when it is cut off.
 */
const DETAIL_LIMIT = Number(process.env.REPORT_DETAIL_LIMIT) || 1000;

const getTotals = async (Model, userId) => {
  const [result] = await Model.aggregate([
    { $match: { userID: new mongoose.Types.ObjectId(String(userId)) } },
    { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);

  return { total: result?.total || 0, count: result?.count || 0 };
};

const generateReport = async (doc, userId) => {
  const [incomeTotals, expenseTotals] = await Promise.all([
    getTotals(IncomeModel, userId),
    getTotals(ExpenseModel, userId),
  ]);

  if (incomeTotals.count === 0 && expenseTotals.count === 0) {
    throw new NotFoundError("No financial data found");
  }

  const totalIncome = incomeTotals.total;
  const totalExpense = expenseTotals.total;

  const expenses = await ExpenseModel.find({ userID: userId })
    .select("description amount date")
    .sort({ date: -1, _id: -1 })
    .limit(DETAIL_LIMIT)
    .lean();

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

  if (expenseTotals.count > expenses.length) {
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .text(
        `Showing the ${expenses.length} most recent of ${expenseTotals.count} expenses. Totals above cover all records.`,
      );
  }
};

module.exports = {
  generateReport,
};
