const DAY_IN_MS = 24 * 60 * 60 * 1000;

const HISTORY_DAYS = 90;

const SUPPORTED_HORIZONS = [3, 6, 12];

const MAX_RECURRING_OCCURRENCES = 1000;

const SCENARIOS = {
  expected: {
    incomeMultiplier: 1,
    expenseMultiplier: 1,
    description: "Historical baseline income and expenses remain unchanged.",
  },
  best: {
    incomeMultiplier: 1.1,
    expenseMultiplier: 0.9,
    description: "Baseline income increases by 10% and baseline expenses decrease by 10%.",
  },
  worst: {
    incomeMultiplier: 0.85,
    expenseMultiplier: 1.15,
    description: "Baseline income decreases by 15% and baseline expenses increase by 15%.",
  },
};

module.exports = {
  DAY_IN_MS,
  HISTORY_DAYS,
  SUPPORTED_HORIZONS,
  MAX_RECURRING_OCCURRENCES,
  SCENARIOS,
};