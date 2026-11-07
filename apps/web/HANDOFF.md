# Settle Web (System 4) — Technical Handoff

## Overview
This document specifies the architecture, contract compliance, derivations, and operational procedures for **System 4** (`apps/web`), the React 18 + Vite + TypeScript strict frontend for Settle.

---

## 1. Allowed Financial Derivations (Rule 2)

Per `AGENT_RULES.md`, System 4 strictly forbids client-side business arithmetic. All financial projections, cash balances, lowest points, and shortfall calculations are sourced verbatim from the backend engine.

The **only** permitted derived calculation lives in `src/lib/derive.ts`:

| Function | Signature | Location | Purpose & Constraints |
| :--- | :--- | :--- | :--- |
| `daysOverdue` | `(dueDate: ISODate, asOf: ISODate): number` | `src/lib/derive.ts` | Calculates whole elapsed days between `invoice.dueDate` and `business.asOf`, clamped at 0. Evaluated strictly in UTC to prevent timezone/DST off-by-one errors. |

Unit tests covering positive overdue, zero overdue, future due dates, month boundaries, leap years, and year rollover live in `src/lib/derive.test.ts`.

---

## 2. Formatting & Numerical Integrity (Rule 3)

- **`formatUsd(cents: number): string`** (`src/lib/format.ts`):
  Uses integer maths only:
  - Sign detection (`cents < 0`)
  - Dollars: `Math.trunc(abs / 100)`
  - Cents remainder: `abs % 100` padded to 2 digits
  - Grouping: `new Intl.NumberFormat('en-US')` on whole dollars only
  - Zero floating-point representation drift.
- **`formatDate(isoDate: string): string`** (`src/lib/format.ts`):
  Parsed in UTC (`Date.UTC(y, m - 1, d)`) and formatted to e.g. `"Fri 6 Nov"`.
- **`formatDateShort(isoDate: string): string`** (`src/lib/format.ts`):
  Formatted to e.g. `"Nov 6"`.
- **`humanizeStatus(status: string): string`** (`src/lib/format.ts`):
  Renders invoice and action statuses verbatim without inference (Rule 4).

---

## 3. Strict Contract Verification & Error Handling (Rule 5)

All API responses are strictly validated through Zod schemas in `src/api/schemas.ts`:
- Bidirectional compile-time type matching (`satisfies z.ZodType<T>` + `AssertEqual` helper) guarantees compile errors if `@settle/shared` contracts drift.
- When validation fails in development (`import.meta.env.DEV`), `ApiSchemaError` dispatches `settle:schema-error` to trigger `<DevErrorOverlay />`, displaying the violating endpoint and path-level Zod issues.
- In production, schema errors log diagnostics and display retry states.

---

## 4. API Endpoints & Single Source of Truth (Rule 9)

All URL paths are declared exclusively in `src/api/endpoints.ts`.
Assumed REST endpoints and proposals for System 1 are recorded in:
- `apps/web/docs/API.md`
- `apps/web/CONTRACT_CHANGE_REQUEST.md`

Client-side impact derivation adapter is isolated in `src/api/impactAdapter.ts`.

---

## 5. Test Identifiers (Rule 6)

Shared test IDs for unit and Playwright end-to-end tests are exported from `src/testids.ts`.
Key test IDs include:
- `sandboxBadge`: `'sandbox-badge'`
- `runSettle`: `'run-settle'`
- `runSettleResult`: `'run-settle-result'`
- `runSettleProgress`: `'run-settle-progress'`
- `runSettleError`: `'run-settle-error'`
- `runSettleRetry`: `'run-settle-retry'`
- `kpiCash`: `'kpi-cash'`
- `kpiLowest`: `'kpi-lowest'`
- `kpiShortfall`: `'kpi-shortfall'`
- `kpiOverdue`: `'kpi-overdue'`
- `kpiSkeleton`: `'kpi-skeleton'`
- `kpiError`: `'kpi-error'`
- `kpiRetry`: `'kpi-retry'`
- `breachBanner`: `'breach-banner'`
- `gapClosedBanner`: `'gap-closed-banner'`
- `balanceChart`: `'balance-chart'`
- `chartFallbackTable`: `'chart-fallback-table'`
- `worklist`: `'worklist'`
- `drawer`: `'drawer'`
- `approveButton`: `'approve-button'`
- `rejectButton`: `'reject-button'`
- `retryButton`: `'retry-button'`
- `copilotToggle`: `'copilot-toggle'`
- `copilotInput`: `'copilot-input'`
- `copilotSend`: `'copilot-send'`
- `auditList`: `'audit-list'`
- `policyForm`: `'policy-form'`
- `policySave`: `'policy-save'`
- `impactCard`: `'impact-card'`
- `demoReset`: `'demo-reset'`
- `demoSimulatePayment`: `'demo-simulate-payment'`
- `devErrorOverlay`: `'dev-error-overlay'`
- `connectionStatus`: `'connection-status'`

---

## 6. Stage 2: Dashboard Implementation Notes

### URL-Driven Selection State (`src/state/selection.ts`)
- Selected action ID is bound to the `?action=` URL search param using `useSelectedAction()`.
- Synchronizes dashboard, worklist, and drawer across navigation and page reloads.

### Breach Memory & Banner (`src/state/breachMemory.tsx`, `src/components/BreachBanner.tsx`, `src/components/GapClosedBanner.tsx`)
- `BreachMemoryProvider` preserves session memory of prior breaches without relying on hardcoded dates.
- When `forecast.firstBreachDate !== null`: displays red alert banner matching snapshot obligation (e.g. `"Payroll November (Bi-weekly) on Fri 6 Nov: short $2,000.00 under your reserve"`) or falls back cleanly if no obligation matches.
- When `hadBreach === true && forecast.firstBreachDate === null`: displays green status banner (`gapClosedBanner`) reporting `"Gap closed: your balance now stays above your reserve"` and displaying the lowest balance from the API.

### Hero Chart (`src/components/BalanceChart.tsx`)
- Built with AG Charts Community (`ag-charts-react`).
- Renders:
  1. Ink closing line (`#0F172A`).
  2. Muted dashed reserve line (`#64748B`, `lineDash: [6, 4]`).
  3. Red breach markers (`#B91C1C`) dynamically conditioned on `belowReserve === true`.
  4. Blue accent line (`#1D4ED8`) for active simulation scenario overlay when selected action has `simulation.scenario`.
- Tooltip displays date, receipts, outflows, and closing balance formatted from API values.
- Accessibility: Container marked `role="img"` with descriptive `aria-label` summarizing lowest balance, date, and breach status; includes a visually hidden `<table>` fallback (`.sr-only`, `chartFallbackTable`) for assistive technologies.

### Run Settle Button (`src/components/RunSettleButton.tsx`)
- Mutation on `POST /api/agent/run` (`useRunAgent()`).
- Indeterminate progress bar and `"Running Settle"` label while pending.
- Guards against concurrent double-clicks via ref guard.
- Displays inline result (`"7 actions proposed, 1 invoice skipped"`) with worklist focus anchor.
- Invalidates `actions`, `kpis`, and `forecast` queries upon success.

---

## 7. Verification Results

All acceptance checks run and passed:
1. `pnpm --filter web typecheck` -> 0 errors.
2. `pnpm --filter web test` -> 68 tests passed across 15 test suites.
3. `pnpm --filter web build` -> Vite build succeeds with bundle optimization.
4. `git status` -> 0 changes outside `apps/web`.
