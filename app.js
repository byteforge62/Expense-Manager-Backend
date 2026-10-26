const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./src/docs/swagger");
const morgan = require("morgan");
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
const errorHandler = require("./src/middleware/error.middleware");
const app = express();

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "https://expense-manager-frontend-topaz.vercel.app",
  ],
  credentials: true,
};
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
});
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: {
    success: false,
    message: "AI request limit exceeded. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(morgan("combined"));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use("/api/ai", aiLimiter);
app.use("/api/ai", aiRoutes);
app.use("/api/user", authLimiter);
app.use("/api/user/login", loginLimiter);
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec)
);
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
app.use(errorHandler);

module.exports = app;

