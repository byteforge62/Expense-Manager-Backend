# Financial Intelligence

## API

`GET /api/financial-intelligence/overview` is authenticated with the existing
Bearer-token or access-cookie mechanism. Optional `startDate` and `endDate`
query parameters accept ISO 8601 timestamps with a timezone offset. They select
inclusive UTC calendar days. When omitted, the current and comparison windows
are the latest 90 UTC calendar days and the immediately preceding 90 days.
`startDate` must not be later than `endDate`.
The maximum accepted period is 366 inclusive UTC calendar days to keep daily
series generation bounded.

The endpoint returns the existing `{ success, message, data }` envelope.
`data` contains:

- `generatedAt` and `dataConfidence` (sample counts and data limitations).
- `metrics` (totals, daily series, category distribution, income/cash-flow
  indicators, obligations, and same-length comparison results).
- `behavior` (measured changes, weekday patterns, and consistency measures).
- `anomalies` and `anomalySummary`.
- `financialHealth` (score or `null`, components, weights, risks, and missing
  data).
- `recommendations` containing evidence-linked observations.

An overall health score is withheld unless the period covers at least 30 days
and contains positive recorded income on at least two receipt days. Missing
component data is excluded from the weighted average; remaining weights are
renormalized. A `null` score means insufficient core data, not a zero
assessment.

## Data flow and ownership

The authenticated user ID is the only source of ownership scope. Expenses,
incomes, budgets, and bills are queried by `userID`; recurring schedules use
their schema field `userId`. Categories are global lookup records, restricted
to `type: "expense"`. Calculations operate on the queried plain records and
shared metrics; analytical engines do not query MongoDB.

The financial-data service converts model values into validated numeric
amounts, `Date` instances, string IDs, normalized bill statuses/recurrence
types, and explicit `null` values for optional categories and budget dates.
Invalid amounts or dates fail the request rather than being silently replaced.

Actual expenses and incomes are the only transaction flows. Recurring
schedules contribute a normalized monthly commitment indicator and are not
added to historical transactions. Pending bills are included only when due by
the end of the selected window and not linked to a settlement expense. Paid
bills are excluded. Because bill status is not versioned, a historical date
range cannot reconstruct a bill's status as it was at that past date.

## Calculation definitions

- **Cash flow:** recorded income minus recorded expenses. Savings rate is net
  cash flow divided by recorded income; it is `null` when income is zero.
- **Daily spending:** daily totals include zero-transaction days in the
  selected UTC range. Average is total spending divided by calendar days;
  median is the median of those daily totals.
- **Monthly cash-flow stability:** the metric includes only complete UTC
  calendar months fully within the selected period; partial boundary months
  remain visible in the monthly series but are not treated as full-month
  observations for the health component.
- **Budget utilization:** matched selected-period spending is divided by the
  total applicable budget amount. A budget without a category acts as an
  overall budget and takes precedence over category budgets to avoid counting
  the same spending twice. Budget amounts are not prorated for partial
  overlaps with the selected period.
- **Income stability:** one minus the coefficient of variation across
  income-receipt-day totals, bounded to `[0, 1]`; requires at least two receipt
  days. It measures amount consistency on receipt days, not receipt timing.
- **Behavior comparisons:** current and previous windows contain equal
  calendar-day counts. A percentage change is not produced when the baseline
  is zero; the observation instead reports the current amount and zero
  baseline. Weekday values use UTC weekdays and average spending per calendar
  occurrence so weekdays with different occurrence counts remain comparable.
  `metrics.comparison.savingsRateChange` is a ratio difference (for example,
  `0.05` means five percentage points); the other change fields are percentages.
- **Transaction anomalies:** per-category historical transaction median plus
  three scaled MADs (`1.4826 * MAD`), requiring at least five previous-period
  category transactions. When MAD is zero, the threshold adds the larger of
  half the median or two standard deviations.
- **Daily/category anomalies:** comparable prior-period daily series, with at
  least 14 historical days and (for category analysis) five historical
  transactions. A category's daily amount is compared to the same-length
  baseline. These are statistical deviations, not fraud findings.
- **Frequency anomalies:** daily transaction-count median/MAD with a
  mean-plus-three-square-roots floor and a four-transaction minimum, requiring
  at least 14 baseline days and five historical transactions.
- **Health components and fixed weights:** savings rate 30%, income stability
  20%, expense-to-income ratio 20%, positive-month cash-flow share 15%, budget
  utilization 10%, and recurring commitments 5%. Each available component is
  mapped to a 0-100 component score using thresholds returned in its
  explanation. The overall score is the weighted mean renormalized over
  available components. It is an explanatory indicator, not a credit score or
  professional rating.
- **Score anchors:** savings rate is mapped from 25 at 0% to 90 at 20% or
  higher; income stability from 25 at 30% to 90 at 80% or higher;
  expense-to-income from 90 at 30% or lower to 25 at 100% or higher; budget
  utilization from 90 at 75% or lower to 25 at 125% or higher; recurring
  commitments from 90 at 20% or lower to 25 at 60% or higher. Linear
  interpolation is used between anchors. Positive-month cash-flow share maps
  directly to 0-100. Overall labels are Strong (80-100), Stable (60-79.99),
  Watchlist (40-59.99), and At risk (below 40); insufficient core data uses
  `Insufficient data`.
- **Recurring amounts:** daily schedules use `365.2425 / 12`, weekly schedules
  `52.1775 / 12`, monthly schedules `1`, and yearly schedules `1 / 12` to
  estimate monthly commitments. Unclassified schedules are surfaced but not
  assigned to income or expense.
- **Buffer:** no financial buffer is inferred because the current models do
  not provide a verified cash balance.
- **Confidence labels:** `high` requires at least 20 current expenses, three
  current incomes, 10 comparison expenses, and two comparison incomes;
  `medium` requires at least five current expenses, two current incomes, and
  five comparison expenses; otherwise confidence is `low`.
- **Recommendation monthly equivalent:** an observed category increase is
  normalized as `increase / selected period days * 30`, assuming a return to
  the equally long prior-period spending level. It is an estimate, not a
  guaranteed or independently validated saving.
- **Recommendation thresholds:** category growth is flagged at 20% or more
  with at least three transactions in both windows; persistent concentration
  requires at least 30% of total spending in both windows and three
  transactions per window. Budget underfunding requires at least 80% of the
  configured amount in both windows; possible overfunding requires below 50%
  in both. Budget-period cadence is not defined by the schema, so these budget
  recommendations explicitly ask the user to confirm period alignment and
  never report a savings impact. Savings planning uses the documented 20%
  target only with at least two income receipt days. Recurring pressure is
  flagged above 40% of monthly-equivalent income; above 60% receives higher
  priority. These are review thresholds, not guarantees or proof of
  discretionary/essential spending.

## Rules

The evaluator emits six stable built-in rules in each response:

| Rule ID | Default condition |
|---|---|
| `budget-utilization` | Warning at 80% and critical at 100% of an applicable budget. |
| `unusual-transaction` | Reuses eligible `large-transaction` results from anomaly detection; minimum personal history remains five category transactions. |
| `savings-rate` | Trigger below 20%; positive income is required. |
| `expense-growth` | Trigger above 20% growth against the equal-length prior period; a zero baseline is not evaluated. |
| `cash-flow-risk` | Trigger if a supplied Financial Forecasting expected scenario has a negative monthly closing balance. Not evaluated when no forecast is supplied. |
| `recurring-commitment` | Trigger above 40% of monthly-equivalent recorded income. |

`ruleConfiguration` may override budget warning/critical utilization, savings
target, expense-growth percentage, and recurring maximum ratio for internal
service callers. Zod validation rejects invalid ranges and a critical budget
threshold no greater than its warning threshold. The HTTP route uses built-in
defaults; there is no user-configurable persistence or CRUD API. Each result
includes `ruleId`, type, condition, threshold, severity, priority, status
(`triggered`, `clear`, or `not-evaluated`), explanation, and evidence.
Triggered rules sort before clear/unevaluated rules by severity.

Financial Forecasting requires explicit opening cash, which this overview
cannot obtain from the existing schemas or request. The overview does not call
forecasting itself because that would require fabricating a balance or
duplicating its database reads. Recommendation and rule engines accept a
forecast result when an internal caller already has one; the current HTTP
request therefore returns the cash-flow rule as `not-evaluated`.
- **Units and dates:** monetary values use the amount units stored in the
  records because the current schemas do not expose currency codes. Calendar
  boundaries and weekdays are UTC, not user-local time.

For example, with income of 1,000 and expenses of 800 in a 30-day period, net
cash flow is 200, savings rate is 20%, and expense-to-income ratio is 80%.
Those measured ratios are returned with the record counts and period
boundaries; no missing income or account balance is synthesized.

## Compatibility and scope

The module is read-only and does not change schemas, add dependencies, persist
generated output, or replace Financial Forecasting or Purchase Intelligence.
