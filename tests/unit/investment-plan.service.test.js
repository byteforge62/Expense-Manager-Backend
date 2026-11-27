const mongoose = require("mongoose");

const IncomeModel = require("../../src/models/IncomeModel");
const ExpenseModel = require("../../src/models/ExpenseModel");
const InvestmentModel = require("../../src/modules/investments/models/InvestmentModel");
const service = require("../../src/modules/investments/investment.service");

jest.setTimeout(30000);

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const sharesOf = (allocation) => allocation.map((row) => row.share);

/**
 * Investment planner arithmetic: the SIP formula, the horizon allocation, the
 * cash-flow baseline read from the user's own ledger, and the cap that keeps a
 * suggestion inside 40% of the monthly surplus.
 */
describe("Investment planner", () => {
  const userIds = [];

  const newUser = () => {
    const id = new mongoose.Types.ObjectId();
    userIds.push(id);
    return id;
  };

  /** One income row and one expense row inside the three-month window. */
  const seedLedger = async (userID, incomeTotal, expenseTotal) => {
    if (incomeTotal) {
      await IncomeModel.create({
        userID,
        amount: incomeTotal,
        source: "Salary",
        date: daysAgo(20),
      });
    }

    if (expenseTotal) {
      await ExpenseModel.create({
        userID,
        amount: expenseTotal,
        description: "Living costs",
        date: daysAgo(20),
      });
    }
  };

  afterAll(async () => {
    await Promise.all([
      IncomeModel.deleteMany({ userID: { $in: userIds } }),
      ExpenseModel.deleteMany({ userID: { $in: userIds } }),
      InvestmentModel.deleteMany({ userID: { $in: userIds } }),
    ]);
  });

  describe("SIP math", () => {
    test("finds the monthly SIP that reaches a target at the stated return", () => {
      const monthly = service.requiredMonthlySip(1000000, 10, 12);

      expect(monthly).toBeCloseTo(4347, 0);

      // The rounded contribution must still fund the target: check the
      // future value of the annuity independently of the formula above.
      const monthlyRate = 12 / 100 / 12;
      const months = 10 * 12;
      const futureValue =
        monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);

      expect(Math.abs(futureValue - 1000000)).toBeLessThan(5);
    });

    test("divides the target by the months when the expected return is zero", () => {
      expect(service.requiredMonthlySip(120000, 10, 0)).toBe(1000);
    });

    test("asks for less as the return or the horizon grows", () => {
      const base = service.requiredMonthlySip(1000000, 10, 12);

      expect(service.requiredMonthlySip(1000000, 10, 15)).toBeLessThan(base);
      expect(service.requiredMonthlySip(1000000, 15, 12)).toBeLessThan(base);
    });

    test("never spreads the target over fewer than one month", () => {
      expect(service.requiredMonthlySip(1200, 0, 0)).toBe(1200);
    });
  });

  describe("Horizon allocation", () => {
    test("shifts from debt to equity as the horizon lengthens", () => {
      expect(sharesOf(service.allocationForHorizon(1))).toEqual([60, 30, 10]);
      expect(sharesOf(service.allocationForHorizon(3))).toEqual([60, 30, 10]);
      expect(sharesOf(service.allocationForHorizon(4))).toEqual([55, 35, 10]);
      expect(sharesOf(service.allocationForHorizon(7))).toEqual([55, 35, 10]);
      expect(sharesOf(service.allocationForHorizon(8))).toEqual([70, 20, 10]);
      expect(sharesOf(service.allocationForHorizon(30))).toEqual([70, 20, 10]);
    });

    test("always totals 100% with a concrete instrument for every asset", () => {
      for (const years of [1, 5, 12]) {
        const allocation = service.allocationForHorizon(years);

        expect(allocation.reduce((sum, row) => sum + row.share, 0)).toBe(100);

        for (const row of allocation) {
          expect(row.asset).toEqual(expect.any(String));
          expect(row.idea.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("Cash-flow snapshot", () => {
    test("averages recorded income and expenses over the window", async () => {
      const userID = newUser();
      await seedLedger(userID, 300000, 90000);

      const snapshot = await service.cashFlowSnapshot(userID, 3);

      expect(snapshot).toMatchObject({
        windowMonths: 3,
        recordedIncome: 300000,
        recordedExpenses: 90000,
        avgMonthlyIncome: 100000,
        avgMonthlyExpenses: 30000,
        monthlySurplus: 70000,
        savingsRate: 70,
      });
    });

    test("ignores rows older than the window", async () => {
      const userID = newUser();
      await seedLedger(userID, 300000, 90000);

      await IncomeModel.create({
        userID,
        amount: 999999,
        source: "Old bonus",
        date: daysAgo(150),
      });

      const snapshot = await service.cashFlowSnapshot(userID, 3);

      expect(snapshot.recordedIncome).toBe(300000);
    });

    test("never reports a negative surplus", async () => {
      const userID = newUser();
      await seedLedger(userID, 30000, 150000);

      const snapshot = await service.cashFlowSnapshot(userID, 3);

      expect(snapshot.avgMonthlyIncome).toBe(10000);
      expect(snapshot.avgMonthlyExpenses).toBe(50000);
      expect(snapshot.monthlySurplus).toBe(0);
      expect(snapshot.savingsRate).toBe(-400);
    });

    test("returns zeros and no savings rate when nothing is recorded", async () => {
      const snapshot = await service.cashFlowSnapshot(newUser(), 3);

      expect(snapshot.avgMonthlyIncome).toBe(0);
      expect(snapshot.avgMonthlyExpenses).toBe(0);
      expect(snapshot.monthlySurplus).toBe(0);
      expect(snapshot.savingsRate).toBeNull();
    });
  });

  describe("Goal plan", () => {
    test("caps the suggestion at 40% of the monthly surplus", async () => {
      const userID = newUser();
      await seedLedger(userID, 300000, 90000);

      const plan = await service.planInvestment(userID, {
        targetAmount: 10000000,
        years: 10,
        expectedReturn: 12,
      });

      expect(plan.snapshot.monthlySurplus).toBe(70000);
      expect(plan.goal.contributionCap).toBe(28000);
      expect(plan.goal.requiredMonthly).toBeGreaterThan(28000);
      expect(plan.goal.feasible).toBe(false);
      expect(plan.goal.suggestedMonthly).toBe(28000);

      const advice = plan.recommendations.join(" ");
      expect(advice).toMatch(/₹28,000/);
      expect(advice).toMatch(/40% of your surplus/);
    });

    test("suggests the required contribution when it fits inside the cap", async () => {
      const userID = newUser();
      await seedLedger(userID, 300000, 90000);

      const plan = await service.planInvestment(userID, {
        targetAmount: 1000000,
        years: 10,
        expectedReturn: 12,
      });

      expect(plan.goal.requiredMonthly).toBeCloseTo(4347, 0);
      expect(plan.goal.monthlyGap).toBe(plan.goal.requiredMonthly);
      expect(plan.goal.feasible).toBe(true);
      expect(plan.goal.suggestedMonthly).toBe(plan.goal.requiredMonthly);
      expect(plan.recommendations.join(" ")).toMatch(
        /Setting aside ₹4,347 a month/,
      );
    });

    test("subtracts an existing monthly contribution from the gap", async () => {
      const userID = newUser();
      await seedLedger(userID, 300000, 90000);

      const plan = await service.planInvestment(userID, {
        targetAmount: 1000000,
        years: 10,
        expectedReturn: 12,
        existingMonthly: 2000,
      });

      expect(plan.goal.existingMonthly).toBe(2000);
      expect(plan.goal.monthlyGap).toBeCloseTo(2347, 0);
      expect(plan.goal.suggestedMonthly).toBeCloseTo(2347, 0);
      expect(plan.goal.feasible).toBe(true);
    });

    test("reports an existing contribution that already covers the goal", async () => {
      const userID = newUser();
      await seedLedger(userID, 300000, 90000);

      const plan = await service.planInvestment(userID, {
        targetAmount: 1000000,
        years: 10,
        expectedReturn: 12,
        existingMonthly: 5000,
      });

      expect(plan.goal.monthlyGap).toBe(0);
      expect(plan.goal.suggestedMonthly).toBe(0);
      expect(plan.goal.feasible).toBe(true);
      expect(plan.recommendations.join(" ")).toMatch(
        /already covers this goal/,
      );
    });

    test("has nothing to suggest from surplus when no income is recorded", async () => {
      const plan = await service.planInvestment(newUser(), {
        targetAmount: 500000,
        years: 5,
      });

      expect(plan.snapshot.savingsRate).toBeNull();
      expect(plan.goal.contributionCap).toBe(0);
      expect(plan.goal.feasible).toBe(false);
      expect(plan.goal.suggestedMonthly).toBe(0);
      expect(plan.recommendations[0]).toMatch(/Add your income records/);
    });

    test("warns about a holding that dominates the portfolio", async () => {
      const userID = newUser();
      await seedLedger(userID, 300000, 90000);

      await InvestmentModel.create([
        {
          userID,
          kind: "STOCK",
          symbol: "DOMINANT.NS",
          name: "Dominant Industries",
          units: 10,
          avgCost: 1200,
        },
        {
          userID,
          kind: "FUND",
          symbol: "118989",
          name: "Index Fund",
          units: 10,
          avgCost: 300,
        },
      ]);

      const plan = await service.planInvestment(userID, {
        targetAmount: 1000000,
        years: 10,
      });

      expect(plan.portfolio.invested).toBe(15000);
      expect(plan.portfolio.concentration).toBe(80);
      expect(plan.recommendations.join(" ")).toMatch(
        /Dominant Industries is about 80%/,
      );
    });

    test("suggests a first index fund for an empty portfolio", async () => {
      const userID = newUser();
      await seedLedger(userID, 300000, 90000);

      const plan = await service.planInvestment(userID, {
        targetAmount: 1000000,
        years: 10,
      });

      expect(plan.portfolio.holdingCount).toBe(0);
      expect(plan.recommendations.join(" ")).toMatch(
        /Start with one broad index fund/,
      );
    });

    test("ties the allocation to the horizon and sizes the emergency fund", async () => {
      const userID = newUser();
      await seedLedger(userID, 300000, 90000);

      const plan = await service.planInvestment(userID, {
        targetAmount: 1000000,
        years: 10,
      });

      expect(plan.allocation).toEqual(service.allocationForHorizon(10));
      expect(sharesOf(plan.allocation)).toEqual([70, 20, 10]);
      // Six months of the average ₹30,000 expense.
      expect(plan.recommendations.join(" ")).toMatch(/₹1,80,000/);
    });
  });
});
