
const request = require("supertest");
const app = require("../../app");

const UserModel = require("../../src/models/UserModel");
const CategoryModel = require("../../src/models/CategoryModel");
const IncomeModel = require("../../src/models/IncomeModel");
const ExpenseModel = require("../../src/models/ExpenseModel");
const RecurringModel = require("../../src/models/RecurringModel");
const BillModel = require("../../src/models/BillModel");

jest.setTimeout(40000);

const FORECAST_ENDPOINT = "/api/financial-forecast";

const createTestEmail = (label) =>
  `forecast_${label}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}@example.com`;

const normalizeForecast = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeForecast);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            ![
              "generatedAt",
              "calculatedAt",
              "requestedAt",
              "createdAt",
              "updatedAt",
            ].includes(key),
        )
        .map(([key, nestedValue]) => [
          key,
          normalizeForecast(nestedValue),
        ]),
    );
  }

  // Ignore millisecond-level differences between consecutive requests.
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
  ) {
    return value.slice(0, 10);
  }

  return value;
};

const getFutureMonthBoundaryPair = (now = new Date()) => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  let targetYear = year;
  let targetMonth = month;

  let monthEnd = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0, 12, 0, 0),
  );

  if (monthEnd <= now) {
    targetMonth += 1;

    if (targetMonth > 11) {
      targetMonth = 0;
      targetYear += 1;
    }

    monthEnd = new Date(
      Date.UTC(targetYear, targetMonth + 1, 0, 12, 0, 0),
    );
  }

  const firstOfFollowingMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 1, 12, 0, 0),
  );

  return {
    monthEnd,
    firstOfFollowingMonth,
  };
};

describe("Financial Forecast Data Integrity", () => {
  let userA;
  let userB;
  let userAToken;
  let categoryId;
  let createdUserIds = [];

  const forecastPayload = {
    openingCash: 75000,
    horizonMonths: 3,
  };

  const registerAndLogin = async (label) => {
    const credentials = {
      name: `Forecast ${label}`,
      email: createTestEmail(label),
      password: "Password123",
    };

    const signupResponse = await request(app)
      .post("/api/user")
      .send(credentials);

    expect(signupResponse.statusCode).toBe(201);
    expect(signupResponse.body.data?._id).toBeDefined();

    const userId = signupResponse.body.data._id;
    createdUserIds.push(userId);

    const loginResponse = await request(app)
      .post("/api/user/login")
      .send({
        email: credentials.email,
        password: credentials.password,
      });

    expect(loginResponse.statusCode).toBe(200);

    const token =
      loginResponse.body.data?.token ||
      loginResponse.body.data?.accessToken;

    expect(token).toBeDefined();

    return {
      id: userId,
      token,
    };
  };

  const clearFinancialRecords = async () => {
    if (!userA?.id || !userB?.id) {
      return;
    }

    const userIds = [userA.id, userB.id];

    await Promise.all([
      IncomeModel.deleteMany({
        userID: { $in: userIds },
      }),
      ExpenseModel.deleteMany({
        userID: { $in: userIds },
      }),
      RecurringModel.deleteMany({
        userId: { $in: userIds },
      }),
      BillModel.deleteMany({
        userID: { $in: userIds },
      }),
    ]);
  };

  const getForecast = async (token) => {
    const response = await request(app)
      .post(FORECAST_ENDPOINT)
      .set("Authorization", `Bearer ${token}`)
      .send(forecastPayload);

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();

    return normalizeForecast(response.body.data);
  };

  const createRecurringSchedule = async ({
    userId,
    amount,
    type = "EXPENSE",
    nextDate,
    frequency = "monthly",
  }) => {
    const schedule = await RecurringModel.create({
      userId,
      title: `Forecast Test ${type}`,
      amount,
      category: "Forecast Integration",
      type,
      frequency,
      nextDate,
      recurrenceAnchorDay: nextDate.getUTCDate(),
      recurrenceAnchorMonth: nextDate.getUTCMonth(),
      isActive: true,
    });

    return schedule;
  };

  beforeAll(async () => {
    userA = await registerAndLogin("user_a");
    userB = await registerAndLogin("user_b");

    userAToken = userA.token;

    const category = await CategoryModel.create({
      name: `Forecast Test ${Date.now()}`,
      type: "expense",
    });

    categoryId = category._id;
  });

  beforeEach(async () => {
    await clearFinancialRecords();
  });

  afterAll(async () => {
    await clearFinancialRecords();

    if (categoryId) {
      await CategoryModel.deleteOne({
        _id: categoryId,
      });
    }

    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({
        _id: { $in: createdUserIds },
      });
    }
  });

  describe("User data isolation", () => {
    test("another user's financial records do not change the owner's forecast", async () => {
      const baseline = await getForecast(userAToken);

      await IncomeModel.create({
        userID: userB.id,
        amount: 95000,
        source: "Other User Income",
        date: new Date(),
      });

      await ExpenseModel.create({
        userID: userB.id,
        categoryID: categoryId,
        amount: 45000,
        description: "Other User Expense",
        date: new Date(),
      });

      await createRecurringSchedule({
        userId: userB.id,
        amount: 25000,
        type: "EXPENSE",
        nextDate: new Date(Date.now() + 7 * 86400000),
      });

      await BillModel.create({
        userID: userB.id,
        name: "Other User Bill",
        amount: 30000,
        dueDate: new Date(Date.now() + 7 * 86400000),
        status: "pending",
      });

      const afterOtherUserRecords = await getForecast(userAToken);

      expect(afterOtherUserRecords).toEqual(baseline);
    });
  });

  describe("Recurring schedule projection", () => {
    test("moving a monthly occurrence across a month boundary changes its forecast allocation", async () => {
      const baseline = await getForecast(userAToken);

      const {
        monthEnd,
        firstOfFollowingMonth,
      } = getFutureMonthBoundaryPair();

      const schedule = await createRecurringSchedule({
        userId: userA.id,
        amount: 1200,
        type: "EXPENSE",
        nextDate: firstOfFollowingMonth,
      });

      const firstForecast = await getForecast(userAToken);

      await RecurringModel.updateOne(
        { _id: schedule._id },
        {
          $set: {
            nextDate: monthEnd,
            recurrenceAnchorDay: monthEnd.getUTCDate(),
            recurrenceAnchorMonth: monthEnd.getUTCMonth(),
          },
        },
      );

      const secondForecast = await getForecast(userAToken);

      expect(firstForecast).not.toEqual(baseline);
      expect(secondForecast).not.toEqual(firstForecast);
    });
  });

  describe("Pending bill projection", () => {
    test("a pending bill within the forecast horizon changes the forecast", async () => {
      const baseline = await getForecast(userAToken);

      await BillModel.create({
        userID: userA.id,
        name: "Forecast Pending Bill",
        amount: 1234,
        dueDate: new Date(Date.now() + 7 * 86400000),
        status: "pending",
      });

      const forecastWithPendingBill = await getForecast(userAToken);

      expect(forecastWithPendingBill).not.toEqual(baseline);
    });
  });

  describe("Paid and settled bill exclusion", () => {
    test("paid bills and explicitly settled pending bills are not deducted again", async () => {
      const settlementExpense = await ExpenseModel.create({
        userID: userA.id,
        categoryID: categoryId,
        amount: 500,
        description: "Expense linked to settled bill",
        date: new Date(),
      });

      const baseline = await getForecast(userAToken);

      const dueDate = new Date(Date.now() + 7 * 86400000);

      await BillModel.create([
        {
          userID: userA.id,
          name: "Already Paid Bill",
          amount: 1800,
          dueDate,
          status: "paid",
        },
        {
          userID: userA.id,
          name: "Already Settled Bill",
          amount: 2200,
          dueDate,
          status: "pending",
          settledExpenseId: settlementExpense._id,
          settledAt: new Date(),
        },
      ]);

      const forecastAfterSettledBills = await getForecast(userAToken);

      expect(forecastAfterSettledBills).toEqual(baseline);
    });
  });

  describe("Recurring history double-count prevention", () => {
    test("a generated historical recurring expense does not change the forecast baseline", async () => {
      const schedule = await createRecurringSchedule({
        userId: userA.id,
        amount: 1500,
        type: "EXPENSE",
        nextDate: new Date(Date.now() + 15 * 86400000),
      });

      const baseline = await getForecast(userAToken);

      const occurrenceDate = new Date(
        Date.now() - 30 * 86400000,
      );

      await ExpenseModel.create({
        userID: userA.id,
        categoryID: categoryId,
        amount: 1500,
        description: "Generated recurring expense history",
        date: occurrenceDate,
        recurringId: schedule._id,
        recurringOccurrenceDate: occurrenceDate,
      });

      const forecastWithGeneratedHistory = await getForecast(userAToken);

      expect(forecastWithGeneratedHistory).toEqual(baseline);
    });
  });
});
