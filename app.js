const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./src/docs/swagger");
const mongoose = require("mongoose");
const createCsrfProtection = require("./src/middleware/csrf.middleware");
const requestContext = require("./src/middleware/request-context.middleware");
require("dotenv").config({ quiet: true });

const userRoutes = require("./src/routes/UserRoutes");
const categoryRoutes = require("./src/routes/CategoryRoutes");
const expenseRoutes = require("./src/routes/ExpenseRoutes");
const recurringRoutes = require("./src/routes/RecurringRoutes");
const incomeRoutes = require("./src/routes/IncomeRoutes");
const transactionRoutes = require("./src/routes/TransactionRoutes");
const budgetRoutes = require("./src/routes/BudgetRoutes");
const systemlogRoutes = require("./src/routes/SystemlogRoutes");
const billRoutes = require("./src/routes/BillRoutes");
const aiRoutes = require("./src/routes/aiRoutes");
const reportRoutes = require("./src/routes/ReportRoutes");
const opsRoutes = require("./src/routes/OpsRoutes");
const purchaseIntelligenceRoutes = require("./src/modules/purchase-intelligence/purchase-intelligence.routes");
const financialForecastRoutes = require("./src/modules/financial-forecasting/financial-forecast.routes");
const financialIntelligenceRoutes = require("./src/modules/financial-intelligence/financial-intelligence.routes");
const notificationRoutes = require("./src/modules/notifications/notification.routes");
const realtimeRoutes = require("./src/modules/realtime/realtime.routes");
const summariesRoutes = require("./src/modules/summaries/summaries.routes");
const errorHandler = require("./src/middleware/error.middleware");
const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://expense-manager-frontend-topaz.vercel.app",
];

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  // Correlation and replay headers must be readable by the browser.
  exposedHeaders: ["X-Request-Id", "Idempotency-Replayed"],
};

const standardLimitMessage = (message) => ({
  success: false,
  message,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: standardLimitMessage("Too many requests. Please try again later."),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: standardLimitMessage("Too many login attempts. Please try again later."),
});

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: standardLimitMessage(
    "AI request limit exceeded. Please try again after 15 minutes.",
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Baseline protection for the whole API surface. Generous enough for normal
 * dashboard usage (which fans out several requests) but caps a runaway client.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: standardLimitMessage("Too many requests. Please try again later."),
});

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(requestContext);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/api", createCsrfProtection(allowedOrigins));
app.use(mongoSanitize());

app.use("/api/ai", aiLimiter, aiRoutes);
app.use("/api/user", authLimiter);
app.use("/api/user/login", loginLimiter);
app.use("/api", apiLimiter);

/**
 * Liveness: process is up. Kept intentionally trivial and unchanged for
 * existing probes.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

/**
 * Readiness: dependencies required to serve traffic are reachable.
 */
app.get("/ready", (req, res) => {
  const databaseUp = mongoose.connection.readyState === 1;

  res.status(databaseUp ? 200 : 503).json({
    status: databaseUp ? "ready" : "not_ready",
    checks: { database: databaseUp ? "up" : "down" },
    requestId: req.id,
  });
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api/realtime", realtimeRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/summaries", summariesRoutes);
app.use("/api", opsRoutes);
app.use("/api", categoryRoutes);
app.use("/api", userRoutes);
app.use("/api", expenseRoutes);
app.use("/api", recurringRoutes);
app.use("/api", incomeRoutes);
app.use("/api", transactionRoutes);
app.use("/api", budgetRoutes);
app.use("/api", systemlogRoutes);
app.use("/api", billRoutes);
app.use("/api", reportRoutes);
app.use("/api/purchase-intelligence", purchaseIntelligenceRoutes);
app.use("/api/financial-forecast", financialForecastRoutes);
app.use("/api/financial-intelligence", financialIntelligenceRoutes);
app.use(errorHandler);

module.exports = app;
