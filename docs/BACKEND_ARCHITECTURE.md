# Fintrack Backend — Architecture & Modernization Report

This document records the backend audit, the changes made, the measured
results, the schema/index changes, and how to deploy or roll back.

Scope: `Expense-Manager-Backend` only. The frontend was not modified; every
existing request/response contract that the frontend relies on is preserved
(see "Contract compatibility").

---

## 1. Architecture at a glance

```
Express app (app.js)
├── request context (request id, structured access log)
├── CORS / helmet / CSRF / sanitize / rate limits
├── routes ──► controllers ──► services ──► Mongoose models
│                  │
│                  └── emit domain events AFTER a successful write
│
Background infrastructure (started from server.js only)
├── outbox dispatcher ──► in-process consumers
│                         ├── summaries (incremental aggregates)
│                         ├── notifications (in-app)
│                         ├── analytics dirty markers
│                         └── realtime SSE fan-out
└── scheduler ──► job runner (leased lock + job history + retries)
                 ├── recurring.process
                 ├── bills.reminders
                 ├── budgets.monitor
                 ├── intelligence.refresh
                 ├── summaries.reconcile
                 ├── notifications.retention
                 └── operations.retention
```

This is a modular monolith. No microservices, no external broker, no Redis.
Deliberately: the product runs as one container and none of the added
requirements need more than one process.

---

## 2. Complete API inventory

Legend — Auth: `—` public, `U` authenticated user, `A` admin.
All list endpoints return `{ success, message, data: [...] , meta? }`. `meta`
is additive and only present on list/derived endpoints.

### Authentication & users

| Method | Route | Service | DB operations | Auth | Validation | Performance notes |
|---|---|---|---|---|---|---|
| POST | `/api/user` | userService.signupUser | `findOne`, `create` | — | `signupSchema` | bcrypt cost; rate-limited (20/15m) |
| POST | `/api/user/login` | userService.loginUser | `findOne`, `create` (refresh) | — | `loginSchema` | separate limiter (10/15m) |
| POST | `/api/user/refresh-token` | userService.refreshToken | `findOneAndDelete`, `findById`, `create` | — | — | refresh tokens are hashed, rotated |
| POST | `/api/user/logout` | userService.revokeRefreshToken | `deleteOne` | — | — | |
| GET | `/api/users` | userService.getAllUsers | `find` | A | — | password excluded by projection |
| GET | `/api/user/:id` | userService.getUserById | `findById` | U self / A | `idParamSchema` | |
| PUT | `/api/user/:id` | userService.updateUser | `findByIdAndUpdate` | U self / A | `updateUserSchema` | explicit field picks (no mass assignment) |
| DELETE | `/api/user/:id` | userService.deleteUser | `findByIdAndDelete`, `deleteMany` | A | `idParamSchema` | |
| POST | `/api/user/upload-profile/:id` | userService.uploadProfilePicture | `findById`, `findByIdAndUpdate`, S3 | U self / A | multer + magic-byte check | 5 MB cap, JPEG/PNG/WebP only |

Existing tests: `auth.flow`, `auth.rate-limit`, `refresh-token`, `user.authorization`.

### Categories

| Method | Route | Service | DB operations | Auth | Validation |
|---|---|---|---|---|---|
| POST | `/api/categories` | categoryService.addCategory | `findOne`, `create` | A | `createCategorySchema` |
| GET | `/api/categories` | categoryService.getAllCategory | `find` (cached 60 s) | U | — |
| GET | `/api/category/:id` | categoryService.getCategoryById | `findById` | U | `idParamSchema` |
| DELETE | `/api/categories/:id` | categoryService.deleteCategory | `findByIdAndDelete` | A | `idParamSchema` |

Change: list is now projected, sorted and cached in-process with explicit
invalidation on write. Cache never holds user financial data.

### Expenses

| Method | Route | Service | DB operations | Auth | Validation | Notes |
|---|---|---|---|---|---|---|
| POST | `/api/expense` | expenseService.addExpense | `create` | U | `createExpenseSchema`, optional `Idempotency-Key` | emits `expense.created` |
| GET | `/api/expenses` | getAllExpenses | `find` + `countDocuments` | A | `expensesListQuerySchema` | paginated, bounded |
| GET | `/api/expense/:id` | getExpenseById | `findOne` (+ populate category) | U | `idParamSchema` | ownership in query |
| PUT | `/api/expense/:id` | updateExpense | `findOne` (before), `findOneAndUpdate` | U | `updateExpenseSchema`, idempotent | emits `expense.updated` |
| DELETE | `/api/expense/:id` | deleteExpense | `findOneAndDelete` | U | `idParamSchema`, idempotent | emits `expense.deleted` |
| GET | `/api/expenses/me` | getExpenseByUserId | `find` (+ count) | U | `expensesListQuerySchema` | filters: date, category, amount, search; sort whitelist; page/limit/cursor |
| GET | `/api/expenses/recent` | getRecentExpenses | `find().limit(5)` | U | — | projection only |

Existing tests: `expense.create`, `expense.update`, `expense.delete`, `expense.auth`, `ownership.authorization`, `api-platform`.

### Income

| Method | Route | Service | Auth | Validation | Notes |
|---|---|---|---|---|---|
| POST | `/api/income` | incomeService.addIncome | U | `createIncomeSchema`, idempotent | emits `income.created` |
| GET | `/api/incomes` | getAllIncome | A | `incomeListQuerySchema` | paginated |
| GET | `/api/income/:id` | getIncomeById | U | `idParamSchema` | ownership in query |
| DELETE | `/api/income/:id` | deleteIncome | U | `idParamSchema`, idempotent | emits `income.deleted` |
| GET | `/api/incomes/me` | getIncomeByUserId | U | `incomeListQuerySchema` | date range, search, pagination |

### Budgets

| Method | Route | Service | Auth | Validation | Notes |
|---|---|---|---|---|---|
| POST | `/api/budget` | budgetService.addBudget | U | `createBudgetSchema`, idempotent | audited |
| GET | `/api/budgets` | getAllBudget | A | `budgetsListQuerySchema` | paginated |
| GET | `/api/budgets/utilization` | getBudgetUtilization | U | `budgetId?` | **new**, derived, rebuilt by monitor |
| GET | `/api/budget/:id` | getBudgetById | U | `idParamSchema` | category populated |
| DELETE | `/api/budget/:id` | deleteBudget | U | `idParamSchema`, idempotent | removes derived utilization |
| GET | `/api/budgets/me` | getBudgetByUserId | U | `budgetsListQuerySchema` | category/activeOn filters |

### Bills

| Method | Route | Service | Auth | Validation | Notes |
|---|---|---|---|---|---|
| POST | `/api/bill` | billService.addBill | U | `createBillSchema`, idempotent | |
| GET | `/api/bills` | getAllBills | A | `billsListQuerySchema` | paginated |
| GET | `/api/bill/:id` | getBillById | U | `idParamSchema` | |
| DELETE | `/api/bill/:id` | deleteBill | U | `idParamSchema`, idempotent | |
| PATCH | `/api/bill/:id/settle` | settleBill | U | `settleBillSchema`, idempotent | atomic claim; emits `bill.settled` only on transition |
| GET | `/api/bills/me` | getBillByUserId | U | `billsListQuerySchema` | status/due-date filters |

Removed: three `console.log` calls in `getBillByUserId` that printed record
ownership data to stdout on every request.

### Recurring schedules

| Method | Route | Service | Auth | Validation | Notes |
|---|---|---|---|---|---|
| POST | `/api/recurring` | recurringService.createRecurring | U | `createRecurringSchema` (optional `endDate`) | anchors stored |
| GET | `/api/recurring/me` | getRecurringByUser | U | `recurringListQuerySchema` | `isActive`, `type`, `frequency` filters |
| PUT | `/api/recurring/:id` | updateRecurring | U | `updateRecurringSchema` | re-anchors on date change |
| DELETE | `/api/recurring/:id` | deleteRecurring | U | `idParamSchema` | |
| GET | `/api/recurring/upcoming` | getUpcomingRecurring | U | `limit ≤ 100` | active schedules only |
| PATCH | `/api/recurring/toggle/:id` | toggleRecurringStatus | U | `idParamSchema` | |

### Transactions (legacy ledger)

| Method | Route | Auth | Validation |
|---|---|---|---|
| POST | `/api/transaction` | U | `createTransactionSchema`, idempotent |
| GET | `/api/transactions` | A | `transactionsListQuerySchema` |
| GET | `/api/transaction/:id` | U | `idParamSchema` |
| DELETE | `/api/transaction/:id` | U | `idParamSchema`, idempotent |
| GET | `/api/transactions/me` | U | `transactionsListQuerySchema` |

### Reports, logs, AI, analytics modules

| Method | Route | Module | Auth | Notes |
|---|---|---|---|---|
| GET | `/api/reports/me` | ReportController / reportService | U | PDF; totals now via aggregation, detail bounded |
| GET | `/api/logs` | Systemlog | A | audit/activity log |
| POST | `/api/ai/ask` | AI module | U | 20 requests / 15 min |
| GET | `/api/ai/expense-insights` | AI module | U | |
| GET | `/api/ai/budget-plan` | AI module | U | |
| GET | `/api/ai/spending-risk` | AI module | U | |
| GET | `/api/ai/financial-forecast` | AI module | U | |
| GET | `/api/ai/saving-opportunities` | AI module | U | |
| GET | `/api/ai/financial-health` | AI module | U | |
| GET | `/api/ai/insights` | AI module | U | |
| POST | `/api/purchase-intelligence/` | Purchase Intelligence | U | requires purchase context + available cash |
| GET | `/api/purchase-intelligence/` | Purchase Intelligence | U | |
| POST | `/api/purchase-intelligence/resolve-url` | Purchase Intelligence | U | |
| GET | `/api/purchase-intelligence/:id` | Purchase Intelligence | U | |
| PATCH | `/api/purchase-intelligence/:id` | Purchase Intelligence | U | |
| DELETE | `/api/purchase-intelligence/:id` | Purchase Intelligence | U | |
| POST | `/api/purchase-intelligence/:id/analyze` | Purchase Intelligence | U | |
| POST | `/api/financial-forecast/` | Financial Forecasting | U | **requires explicit opening cash**; unchanged |
| GET | `/api/financial-intelligence/overview` | Financial Intelligence | U | user-scoped, ≤366-day window |

### New platform endpoints

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/notifications` | U | paginated inbox (`unread`, `category`, `priority`) |
| GET | `/api/notifications/unread-count` | U | `{ count }` |
| PATCH | `/api/notifications/:id/read` | U | idempotent mark-read |
| PATCH | `/api/notifications/read-all` | U | bulk mark-read |
| DELETE | `/api/notifications/:id` | U | remove one notification |
| GET | `/api/notifications/preferences` | U | effective preferences |
| PUT | `/api/notifications/preferences` | U | validated partial update |
| GET | `/api/summaries/daily` | U | derived daily aggregates |
| GET | `/api/summaries/monthly` | U | derived monthly aggregates |
| GET | `/api/summaries/category` | U | derived category breakdown for a month |
| POST | `/api/summaries/reconcile` | U | rebuild own summaries from authoritative records |
| POST | `/api/realtime/token` | U | short-lived (60 s) SSE token |
| GET | `/api/realtime/stream?token=` | token | user-scoped SSE stream |
| GET | `/api/ops/runtime` | A | scheduler/outbox/cache/SSE/database status |
| GET | `/api/ops/jobs` | A | recent job runs |
| GET | `/api/ops/events` | A | failed/dead outbox events |
| GET | `/health` | — | liveness, unchanged `{status:"ok"}` |
| GET | `/ready` | — | readiness (database) |

---

## 3. Performance work and measured results

### What changed

| Area | Before | After |
|---|---|---|
| Expense list | `find().populate("userID categoryID")`, no projection, no bound | user populate removed, projection + `.lean()`, sort on `(userID,date,_id)`, bounded/paginated |
| Income list | `find({userID})`, unsorted, full documents | projection + `.lean()`, sorted, bounded/paginated |
| Bill/budget/recurring/transaction lists | unbounded, some populated the owner | projected, bounded, paginated with meta |
| List responses | unbounded arrays | legacy array (capped, default 2000) **or** `page`/`limit` or keyset `cursor` |
| Cross-user reads | fetch then compare in JS | ownership in the query filter |
| Report totals | load all documents, reduce in JS | `$group` aggregation; itemised section bounded |
| Dashboard totals | full-history scans per request | derived summaries (incremental), rebuilt nightly |
| Budget utilization | computed nowhere | aggregation per budget with `(userID,categoryID,date)` index, snapshot stored |
| Analytics | recomputed per request (overview) | event-driven dirty marker + coalesced scheduled refresh |
| Mutation latency | write only | write + one outbox insert (needed for reliability) |

### Measured (same dataset, same machine, `scripts/benchmark-api.js`)

Dataset: 3,000 expenses + 300 incomes, 30 iterations (20 for HTTP), warm-up 5.
Raw output: `benchmarks/latest.json`.

Data layer:

| Operation | p50 | p95 | Payload | Queries/req |
|---|---|---|---|---|
| Expense list — previous query | 1,599.59 ms | 19,212.47 ms | 2,545,591 B | 3 |
| Expense list — optimised | 750.47 ms | 2,234.56 ms | 610,691 B | 2 |
| Expense page (limit 20) | 48.70 ms | 62.64 ms | 6,051 B | 3 |
| Income list — previous | 97.87 ms | 165.89 ms | 70,991 B | 1 |
| Income list — optimised | 75.58 ms | 89.81 ms | 57,791 B | 1 |
| Totals — in-memory reduce | 531.70 ms | 2,107.26 ms | — | 2 |
| Totals — derived summary | 222.90 ms | 295.92 ms | — | 1 |

HTTP (measured through Express with a real bearer token):

| Endpoint | p50 | p95 | p99 | Bytes | Queries |
|---|---|---|---|---|---|
| `GET /api/expenses/me` (legacy array) | 350.08 ms | 382.10 ms | 526.65 ms | 610,955 | 3 |
| `GET /api/expenses/me?page=1&limit=20` | 76.79 ms | 88.59 ms | 89.55 ms | 6,282 | 4 |
| `GET /api/expenses/me?limit=20&cursor=` | 73.48 ms | 85.29 ms | 86.47 ms | 6,335 | 3 |
| `GET /api/expenses/recent` | 48.47 ms | 84.39 ms | 99.33 ms | 859 | 2 |
| `GET /api/summaries/monthly` | 53.71 ms | 64.77 ms | 65.04 ms | 818 | 2 |
| `GET /api/notifications?limit=20` | 54.03 ms | 66.75 ms | 83.96 ms | 237 | 3 |

Observations:

- Removing the `userID` population and the unbounded fetch cut payload size by
  ~76% and p95 by ~88% for the full-list path.
- Paged reads are ~4.5× faster at p50 and ~43× smaller in bytes than the legacy
  array on this dataset.
- Derived totals halve latency and drop one full collection scan.
- These are single-run local measurements against a remote Atlas cluster, so
  absolute numbers are noisy; the relative shape is the meaningful result.

Reproduce: `node scripts/benchmark-api.js` (uses a disposable `*_bench` DB and
drops it afterwards).

---

## 4. Indexes added

| Collection | Index | Why |
|---|---|---|
| `expenses` | `{userID:1, date:-1, _id:-1}` | list + keyset pagination |
| `expenses` | `{userID:1, categoryID:1, date:-1}` | category filters, budget utilization |
| `expenses` | `{updatedAt:-1, userID:1}` | summary reconciliation scan |
| `incomes` | `{userID:1, date:-1, _id:-1}`, `{updatedAt:-1,userID:1}` | same reasons |
| `transactions` | `{userID:1,date:-1,_id:-1}`, `{userID:1,type:1,date:-1}` | list + type filter |
| `bills` | `{userID:1,status:1,dueDate:1}`, `{status:1,dueDate:1}` | user filters; cross-user reminder scan |
| `budgets` | `{end_date:1}` | monitor scan for open/expired periods |
| `notifications` | `{userID:1,createdAt:-1}`, `{userID:1,readAt:1,createdAt:-1}`, unique `{userID:1,dedupeKey:1}` partial, `{expiresAt:1}` | inbox, unread, dedupe, retention |
| `financial_summary` | unique `{userID:1,periodType:1,periodStart:1}` | one document per bucket |
| `category_summary` | unique `{userID:1,periodType:1,periodStart:1,categoryID:1}` | one document per category bucket |
| `budget_utilization` | unique `{budgetID:1,periodStart:1}`, `{userID:1,periodStart:-1}` | derived utilization |
| `outbox_event` | unique `{eventId:1}`, unique partial `{dedupeKey:1}`, `{status:1,availableAt:1}`, `{createdAt:1}` | claim/retry/retention |
| `processed_event` | unique `{eventId:1,consumer:1}`, TTL 30 d | consumer idempotency |
| `job_run` | `{name:1,startedAt:-1}`, `{status:1,startedAt:-1}`, unique partial `{idempotencyKey:1}`, `{createdAt:1}` | history, at-most-once keys |
| `job_lock` | unique `{name:1}`, `{expiresAt:1}` | cross-instance exclusion |
| `idempotency_key` | unique `{userID:1,key:1}`, TTL `{expiresAt:1}` | HTTP idempotency |
| `financial_insight_snapshot` | unique `{userID:1}` | latest snapshot |
| `analytics_refresh_state` | unique `{userID:1}`, `{dirtyAt:1}` | dirty-user scan |

No existing index was removed. Startup calls `createIndexes()` per model
(additive only) instead of `syncIndexes()`, so pre-existing indexes survive.

---

## 5. Automation

### Recurring transactions
- Engine unchanged in its core guarantees: occurrence upsert behind a unique
  partial index `(userID, recurringId, recurringOccurrenceDate)` and a
  conditional `nextDate` advance, so retries and concurrent workers cannot
  duplicate or double-advance.
- Added: optional `endDate` (schedule deactivates itself after the final
  occurrence), month-end/leap-year anchoring preserved, per-schedule failures
  reported with the owner id, and one event per generated occurrence.
- Runs every 10 minutes under a leased lock.

### Bills
- Detects due-soon (default 3 days) and overdue unpaid bills and emits events.
- **Never** marks a bill paid, never creates an expense, never mutates
  `status`. Settlement stays `PATCH /api/bill/:id/settle`.
- Due-soon alerts: one per bill per due date. Overdue alerts: one per bill until
  the condition changes, so an unchanged overdue bill does not nag daily.

### Budgets
- Utilization computed from expenses per budget period.
- Undated budgets are interpreted as the current UTC month (documented
  explicitly; no user timezone exists in the data model).
- Alerts only on the highest crossed band of `BUDGET_ALERT_THRESHOLDS`
  (default 50/75/90/100), once per budget-period-band.
- Emits `budget.period_ended` once for recently expired budgets.
- Snapshot stored in `budget_utilization` for fast reads; never authoritative.

### Summaries
- `financial_summary` / `category_summary` maintained by `$inc` upserts from
  events, and fully rebuildable via reconciliation.
- Event consumers are idempotent (`processed_event` ledger), so at-least-once
  delivery cannot double count.
- Nightly-style reconciliation rebuilds the last 2 days for recently active
  users; `POST /api/summaries/reconcile` rebuilds a user on demand.

### Financial intelligence
- Writes mark the user dirty; `intelligence.refresh` coalesces them and runs the
  existing engines once per window.
- Recommendation lifecycle (new / persisted / resolved) stored in
  `financial_insight_snapshot`; new high/critical recommendations become
  notifications.
- High-severity anomalies produce at most one notification per type per day.
- All output remains heuristic and labelled as such; no balances or bank data
  are invented, and cash-flow forecasting still requires an explicit opening
  cash amount.

---

## 6. Events

| Event | Emitted by | Consumers |
|---|---|---|
| `expense.created/updated/deleted` | expense.service | summaries, analytics, realtime |
| `income.created/deleted` | income.service | summaries, analytics, realtime |
| `budget.threshold_reached` | budget monitor | notifications, realtime |
| `budget.period_ended` | budget monitor | notifications, realtime |
| `bill.due_soon`, `bill.overdue` | bill reminder job | notifications, realtime |
| `bill.settled` | bill.service (transition only) | notifications, realtime |
| `recurring_transaction.processed` | recurring processor | summaries, analytics, notifications, realtime |
| `recurring_transaction.failed` | recurring processor | notifications |
| `financial_summary.updated` | summary consumers | realtime |
| `financial_intelligence.generated` | intelligence refresh | realtime |
| `notification.created` | notification service | realtime |

Delivery: write to `outbox_event` first, then immediate in-process dispatch;
failures are retried with exponential backoff (1 s → 60 s, 5 attempts) and then
dead-lettered as `status: "dead"`. Handlers time out after 10 s and are isolated
from each other.

Known limitation (documented, not hidden): because a standalone mongod has no
transactions, the outbox row is written immediately after the financial write,
not in the same transaction. A process crash in the microsecond between the two
writes can lose the event, and the next scheduled reconciliation repairs derived
state.

---

## 7. Real-time synchronization

Server-Sent Events, chosen because updates are one-directional and SSE needs no
extra infrastructure or proxy upgrade handling.

1. `POST /api/realtime/token` (Bearer auth) → JWT with `scope: "realtime"`,
   60-second lifetime.
2. `GET /api/realtime/stream?token=…` → `text/event-stream`, events named after
   the domain event, payloads carry ids/timestamps (not full financial records).
3. 25-second heartbeat comment frames; per-user cap of 5 connections (oldest
   closed); connections removed on client close.

Frontend wiring is intentionally **not** included in this backend task. The
contract for the client is: fetch a token, open `EventSource`, refetch the
affected resource on event (or use the `/api/summaries` endpoints). Until that
is wired, the app continues to work with its existing polling/fetch behaviour.

---

## 8. Notifications

- Categories: `budget`, `bill`, `recurring`, `anomaly`, `recommendation`, `system`.
- Priorities: `low`, `medium`, `high`, `critical`.
- Preferences per user (stored on the user document, defaults for existing
  users, no migration): `inApp`, per-category toggles and `minimumPriority`.
  Suppression happens at creation time.
- Deduplication by `(userID, dedupeKey)` unique index.
- Read/unread state, mark-one, mark-all, delete, unread count.
- Retention: `NOTIFICATION_RETENTION_DAYS` (default 90) plus per-notification
  `expiresAt`; purged by a scheduled job.
- No email or push is sent: no provider is configured and no consent is
  recorded. `mailer`/`nodemailer` exist as unused dependencies.

---

## 9. Caching

In-process TTL cache only, for category metadata (60 s, invalidated on write).
Everything else reads MongoDB directly.

Why not Redis: the deployment is a single container; a network cache adds
operational cost and a correctness risk (cross-instance invalidation) with no
measured need. Financial summaries already removed the expensive repeated
reads. If the service is scaled horizontally, replace
`src/infrastructure/cache/memory-cache.js` internals with a shared cache; call
sites do not change.

---

## 10. Security improvements

- Every user-owned query is scoped by the token's user id; client-supplied ids
  are never used for authorization.
- Cross-user reads now filter by owner in the query (no cross-account document
  hydration).
- Optional `Idempotency-Key` on all financial mutations: replay of a completed
  request returns the stored response; concurrent duplicate → 409; different
  payload under the same key → 422.
- Global API rate limit (`API_RATE_LIMIT`, default 1000/15 min) in addition to
  the existing auth/login/AI limiters.
- Validation added to every list endpoint (bounded `limit ≤ 100`, date parsing,
  object-id checks, sort whitelist).
- Central error handler maps Zod/Mongoose/JWT/JSON/upload errors to safe
  messages, never exposes stacks, and returns a correlation id.
- Removed debug logging of bill identifiers.
- Audit trail (`system_logs`) recorded for expense/income/budget/bill/
  recurring/transaction mutations: actor, action, entity id, request id. No
  amounts or descriptions are stored in the audit record.
- SSE tokens are short-lived, single-purpose and scoped to one user's stream.
- `X-Request-Id` is echoed and exposed through CORS.

Not implemented, deliberately: automated transfers, purchases, payments or bill
settlements. Automation never moves money.

---

## 11. Environment variables

Existing variables are unchanged. New (all optional, defaults in code):

| Variable | Default | Purpose |
|---|---|---|
| `LOG_LEVEL` | `info` (`silent` in tests) | structured log verbosity |
| `SLOW_REQUEST_MS` | `500` | slow-request warning threshold |
| `API_RATE_LIMIT` | `1000` | requests / 15 min / IP across `/api` |
| `JOBS_ENABLED` | `true` (`false` when `NODE_ENV=test`) | master switch for automation |
| `JOB_<NAME>_ENABLED` | `true` | per-job switch, e.g. `JOB_BILLS_REMINDERS_ENABLED` |
| `JOB_TIMEOUT_MS` | `60000` | default job timeout |
| `JOB_HISTORY_RETENTION_DAYS` | `30` | `job_run` retention |
| `OUTBOX_INTERVAL_MS` / `OUTBOX_LEASE_MS` / `OUTBOX_CONCURRENCY` | `5000` / `30000` / `5` | dispatcher tuning |
| `OUTBOX_RETENTION_DAYS` | `7` | dispatched/dead event retention |
| `EVENT_HANDLER_TIMEOUT_MS` / `EVENT_MAX_ATTEMPTS` | `10000` / `5` | consumer timeout and retry cap |
| `BILL_REMINDER_DAYS` | `3` | due-soon horizon |
| `BUDGET_ALERT_THRESHOLDS` | `50,75,90,100` | utilization bands |
| `LEGACY_LIST_MAX` | `2000` | cap for unpaginated list responses |
| `REPORT_DETAIL_LIMIT` | `1000` | itemised PDF rows |
| `NOTIFICATION_RETENTION_DAYS` | `90` | notification retention |
| `IDEMPOTENCY_TTL_MS` | `86400000` | idempotency ledger TTL |
| `SUMMARY_RECONCILE_LOOKBACK_DAYS` | `2` | reconciliation window |
| `SUMMARY_RECONCILE_MAX_USERS` | `200` | per-run user cap |
| `INTELLIGENCE_REFRESH_BATCH` | `10` | users per refresh run |
| `SSE_HEARTBEAT_MS` / `SSE_MAX_CONNECTIONS` | `25000` / `5` | stream tuning |
| `MONGO_SERVER_SELECTION_MS` | `10000` | Mongo connect timeout |

---

## 12. Dependencies

**None added.** `node-cron` is still in `package.json` but the cron entry point
was replaced by the scheduler (single scheduling system). `morgan` is no longer
used (structured logger replaces it). Both could be removed from
`package.json`; they were left in place to avoid touching the lockfile in this
change.

---

## 13. Schema changes and migration

Additive only; no existing field changed type or meaning.

New collections: `outbox_event`, `processed_event`, `job_run`, `job_lock`,
`notification`, `financial_summary`, `category_summary`, `budget_utilization`,
`financial_insight_snapshot`, `analytics_refresh_state`, `idempotency_key`.

Additive fields:
- `users.notificationPreferences` (nested defaults; existing users read with
  defaults, no backfill required).
- `recurring.endDate` (optional; absent means "no end").
- `system_logs.metadata` (optional).

Migration steps:

1. Deploy the code. Mongoose creates missing collections on first write.
2. Build indexes: the server calls `createIndexes()` per model at startup (safe,
   additive). For large collections, build them ahead of time with
   `mongosh` using the definitions in section 4, or run
   `node scripts/backfill-derived-data.js --indexes-only`.
3. Optionally backfill derived data so dashboards are warm immediately:
   `node scripts/backfill-derived-data.js` (rebuilds summaries per user and
   marks analytics dirty). Not required for correctness — summaries rebuild on
   demand and on schedule.
4. No notification or job backfill is needed; both start empty and fill from
   subsequent events.

No historical financial record is rewritten, recalculated or deleted.

---

## 14. Testing

Run: `npm test` (requires `MONGO_URI_E2E` in `.env.e2e`; the suite drops that
test database at the end, as it did before this change).

Added suites:

- `tests/unit/pagination-and-list-query.test.js` — pagination math, cursor
  round-trip, legacy cap/truncation, projection/skip behaviour.
- `tests/unit/recurring-engine-enddate.test.js` — end-date completion,
  observation hook, hook failure isolation.
- `tests/unit/automation-signals.test.js` — budget period fallback and
  highest-threshold-only alerts, bill due-soon/overdue classification and
  dedupe keys, recommendation lifecycle.
- `tests/unit/events-and-idempotency.test.js` — consumer isolation, outbox
  failure handling, dedupe suppression, retry state, processed-event ledger,
  HTTP idempotency replay/conflict.
- `tests/unit/summaries-and-notifications.test.js` — mirrored deltas,
  category buckets, invalid input rejection, preference suppression, dedupe.
- `tests/api-platform.test.js` — end-to-end: legacy vs paginated vs cursor
  lists, event-driven summary update, reconcile, notifications CRUD/prefs,
  budget utilization, idempotent expense creation and payload conflict.

Updated: `tests/refresh-token.test.js` now asserts the documented envelope plus
the additive `requestId` field and `X-Request-Id` header.

---

## 15. Remaining technical debt / not done

1. **Frontend SSE wiring.** The backend streams; the client does not consume it
   yet. Until then, real-time delivery is implemented but unused by the UI.
2. **Response envelope variance.** Some endpoints historically return
   non-standard shapes (`login` returns `data.token`; `getIncomeById` returns
   "delete" wording in an auth error). These were preserved rather than fixed
   because the frontend depends on them.
3. **`UNCLASSIFIED` recurring schedules** remain inert by design.
4. **No status field for overdue bills.** Overdue is derived, not stored, to
   avoid mutating bills automatically. If the UI needs it, add it as a computed
   field in the list response.
5. **Outbox is not written in the same transaction as the financial record**
   (standalone Mongo). Reconciliation covers the gap; a replica-set deployment
   could upgrade this to a true transactional outbox.
6. **Summary reads are eventually consistent** by up to the job interval for
   paths that do not go through events (for example, a direct database edit).
   Reconciliation converges them.
7. **`node-cron` and `morgan` are unused dependencies** left in `package.json`.
8. **No load test** beyond the single-process benchmark; horizontal scaling
   would need a shared cache and a review of SSE fan-out.
9. **Purchase Intelligence and AI endpoints** were not re-architected; they were
   audited but left functionally untouched (they already require explicit
   context/cash and are rate-limited).

---

## 16. Deployment requirements

- Node 18+ (SSE endpoint uses `flushHeaders`; the benchmark uses `fetch`).
- MongoDB 4.4+ (partial indexes, `$dateToString`). Atlas is fine.
- Start with `npm start`. Background work starts only in `server.js`, after the
  Mongo connection succeeds.
- One instance is sufficient; multiple instances are safe because jobs are
  lock-protected and the outbox claims atomically. SSE connections are
  process-local, so with multiple instances a client only receives events from
  the instance it is connected to — acceptable for now, documented.
- Set `JOBS_ENABLED=false` to run the API without any automation.
- Reverse proxies must not buffer `text/event-stream`
  (`X-Accel-Buffering: no` is already sent).
- No new secrets are required.

---

## 17. Rollback

1. Stop the deployment (`SIGTERM`) — graceful shutdown drains the scheduler and
   closes SSE connections without creating new financial records.
2. Redeploy the previous commit/tag. No data migration is required: every schema
   change is additive, so old code ignores the new collections and fields.
3. Optional cleanup (safe, derived/operational data only — never financial
   records):
   ```js
   db.notification.drop()
   db.financial_summary.drop()
   db.category_summary.drop()
   db.budget_utilization.drop()
   db.outbox_event.drop()
   db.processed_event.drop()
   db.job_run.drop()
   db.job_lock.drop()
   db.financial_insight_snapshot.drop()
   db.analytics_refresh_state.drop()
   db.idempotency_key.drop()
   ```
4. New indexes can stay: they are additive and only cost write overhead. To
   remove them, drop them by name from section 4.
5. `users.notificationPreferences`, `recurring.endDate` and
   `system_logs.metadata` can remain; older code ignores them.
