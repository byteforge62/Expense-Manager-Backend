const RULE_DEFINITIONS = [
  {
    id: "budget-utilization",
    type: "budget-utilization",
    description: "Evaluate applicable budget utilization.",
    defaultThresholds: { warning: 0.8, critical: 1 },
  },
  {
    id: "unusual-transaction",
    type: "unusual-transaction",
    description: "Reuse eligible unusual transaction findings from anomaly detection.",
    defaultThresholds: {},
  },
  {
    id: "savings-rate",
    type: "savings-rate",
    description: "Compare observed savings rate with a configurable planning target.",
    defaultThresholds: { target: 0.2 },
  },
  {
    id: "expense-growth",
    type: "expense-growth",
    description: "Compare expense growth with the equal-length prior period.",
    defaultThresholds: { growthPercent: 20 },
  },
  {
    id: "cash-flow-risk",
    type: "cash-flow-risk",
    description: "Evaluate the supplied expected forecast closing balances.",
    defaultThresholds: {},
  },
  {
    id: "recurring-commitment",
    type: "recurring-commitment",
    description: "Compare monthly recurring expenses with monthly-equivalent income.",
    defaultThresholds: { maximumRatio: 0.4 },
  },
];

module.exports = {
  RULE_DEFINITIONS,
};
