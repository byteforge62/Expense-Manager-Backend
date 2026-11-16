const ExpenseModel = require("../models/ExpenseModel");
const IncomeModel = require("../models/IncomeModel");
const AllInsightModel = require("../models/AllInsightModel");

const { generateAIResponse } = require("./ai-provider.service");
const logger = require("../infrastructure/logger");

const { ValidationError } = require("../errors/AppError");
const getFinancialData = async (userId) => {
    const incomes = await IncomeModel.find({
        userID: userId,
    });

    const expenses = await ExpenseModel.find({
        userID: userId,
    }).populate("categoryID");

    return {
        incomes,
        expenses,
    };
};

const saveInsight = async (userId, type, content) => {
  try {
    await AllInsightModel.create({
      userID: userId,
      type,
      content,
    });
  } catch (error) {
    // Persisting an insight is best-effort: the answer is still returned.
    logger.warn("ai.insight_save_failed", { error, type });
  }
};

const buildExpenseSummary = (expenses) => {
  return expenses.reduce((acc, item) => {
    const category = item.categoryID?.name || "Other";
    acc[category] = (acc[category] || 0) + item.amount;
    return acc;
  }, {});
};

const parseAIJson = (response, fallback) => {
const cleaned = String(response)
  .replace(/```json|```/g, "")
  .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return fallback(cleaned);
  }
};

const askAI = async (userId, message) => {
  if (!message?.trim()) {
    throw new ValidationError("Message cannot be empty");
  }

  if (message.length > 3000) {
    throw new ValidationError(
      "Message too long. Please keep it under 3000 characters."
    );
  }

const aiReply = await generateAIResponse(message);

if (!aiReply) {
    throw new ValidationError("AI did not generate a response.");
}

  if (userId) {
    await saveInsight(userId, "ai-chat", aiReply);
  }

  return aiReply;
};

const getExpenseInsights = async (userId) => {
  const expenses = await ExpenseModel.find({
    userID: userId,
  }).populate("categoryID");

  if (!expenses.length) {
    return [];
  }

  const summary = buildExpenseSummary(expenses);

  const prompt = `
You are a financial advisor.

Analyze the following expense summary and return ONLY JSON.

{
  "topCategory":"",
  "totalExpenses":"",
  "insights":[],
  "recommendations":[]
}

Expense Summary:

${JSON.stringify(summary, null, 2)}
`;

  const aiReply = await generateAIResponse(prompt);

  const parsed = parseAIJson(aiReply, (raw) => ({
    insights: [raw],
    recommendations: [],
  }));

  await saveInsight(
    userId,
    "expense-insights",
    JSON.stringify(parsed)
  );

  return parsed;
};

const generateBudgetPlan = async (userId) => {
  const { incomes, expenses } = await getFinancialData(userId);

  const totalIncome = incomes.reduce(
    (sum, income) => sum + income.amount,
    0,
  );

  const summary = buildExpenseSummary(expenses);

  const totalExpenses = Object.values(summary).reduce(
    (sum, amount) => sum + amount,
    0,
  );

  const prompt = `
You are a financial advisor AI.

Return ONLY valid JSON.

{
  "snapshot":{
      "income":number,
      "expenses":number,
      "surplus":number
  },
  "budgetPlan":[
      {
          "category":"string",
          "recommended":number
      }
  ],
  "recommendations":[]
}

User Monthly Income:
${totalIncome}

Expense Summary:

${JSON.stringify(summary, null, 2)}
`;

  const aiReply = await generateAIResponse(prompt);

  const parsed = parseAIJson(aiReply, () => ({
    snapshot: {
      income: totalIncome,
      expenses: totalExpenses,
      surplus: totalIncome - totalExpenses,
    },
    budgetPlan: [],
    recommendations: [aiReply],
  }));

  await saveInsight(
    userId,
    "budget-plan",
    JSON.stringify(parsed),
  );

  return parsed;
};

const detectSpendingRisk = async (userId) => {
  const { incomes, expenses } = await getFinancialData(userId);

  if (!expenses.length) {
    return {
      riskLevel: "Low",
      message: "No spending data available.",
    };
  }

  const totalIncome = incomes.reduce(
    (sum, income) => sum + income.amount,
    0,
  );

  const summary = buildExpenseSummary(expenses);

  const prompt = `
Analyze this spending data.

Income:
${totalIncome}

Expenses:

${JSON.stringify(summary, null, 2)}

Return ONLY JSON.

{
  "riskLevel":"",
  "category":"",
  "reason":"",
  "suggestion":""
}
`;

  const aiReply = await generateAIResponse(prompt);

  const parsed = parseAIJson(aiReply, () => ({
    riskLevel: "Unknown",
    category: "Unknown",
    reason: aiReply,
    suggestion: "Unable to parse AI response.",
  }));

  await saveInsight(
    userId,
    "spending-risk",
    JSON.stringify(parsed),
  );

  return parsed;
};

const getFinancialForecast = async (userId) => {
  const { incomes, expenses } = await getFinancialData(userId);

  const totalIncome = incomes.reduce(
    (sum, income) => sum + income.amount,
    0,
  );

  const totalExpenses = expenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );

  const summary = buildExpenseSummary(expenses);

  const prompt = `
Create a 6-month financial forecast.

Income:
${totalIncome}

Expenses:
${totalExpenses}

Expense Breakdown:

${JSON.stringify(summary, null, 2)}

Provide practical financial insights and recommendations.
`;

  const aiReply = await generateAIResponse(prompt);

  await saveInsight(
    userId,
    "financial-forecast",
    aiReply,
  );

  return aiReply;
};


const detectSavingOpportunities = async (userId) => {
  const { incomes, expenses } = await getFinancialData(userId);

  const totalIncome = incomes.reduce(
    (sum, income) => sum + income.amount,
    0,
  );

  const summary = buildExpenseSummary(expenses);

  const prompt = `
Find saving opportunities for the following financial data.

Income:
${totalIncome}

Expense Breakdown:

${JSON.stringify(summary, null, 2)}

Provide practical recommendations for saving money.
`;

  const aiReply = await generateAIResponse(prompt);

  await saveInsight(
    userId,
    "saving-opportunities",
    aiReply,
  );

  return aiReply;
};

const getFinancialHealthScore = async (userId) => {
  const { incomes, expenses } = await getFinancialData(userId);

  const totalIncome = incomes.reduce(
    (sum, income) => sum + income.amount,
    0,
  );

  const totalExpenses = expenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );

  const savings = totalIncome - totalExpenses;

  const summary = buildExpenseSummary(expenses);

  const prompt = `
Calculate a Financial Health Score from 0 to 100.

Income:
${totalIncome}

Expenses:
${totalExpenses}

Savings:
${savings}

Expense Breakdown:

${JSON.stringify(summary, null, 2)}

Explain the score and give suggestions for improvement.
`;

  const aiReply = await generateAIResponse(prompt);

  await saveInsight(
    userId,
    "financial-health",
    aiReply,
  );

  return aiReply;
};

const getAllInsights = async (userId) => {
  return await AllInsightModel.find({
    userID: userId,
  }).sort({
    createdAt: -1,
  });
};

module.exports = {
  askAI,
  getExpenseInsights,
  generateBudgetPlan,
  detectSpendingRisk,
  getFinancialForecast,
  detectSavingOpportunities,
  getFinancialHealthScore,
  getAllInsights,
};