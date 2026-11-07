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
- `drawerReason`: `'drawer-reason'`
- `drawerTimeline`: `'drawer-timeline'`
- `drawerPolicy`: `'drawer-policy'`
- `drawerAssumptions`: `'drawer-assumptions'`
- `drawerClose`: `'drawer-close'`
- `worklistRow`: `'worklist-row-{id}'`
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

## 7. Stage 3: Receivables Worklist & Action Drawer Notes

### Pure Join Selector (`src/api/selectors.ts`)
- `selectWorklistRows(snapshot, actions)` joins `snapshot.invoices`, `snapshot.payers`, and `actions` by `invoiceId`.
- Computes `daysOverdue` strictly via `derive.daysOverdue(invoice.dueDate, snapshot.business.asOf)` in UTC.
- Zero business arithmetic.

### Virtualized Receivables Worklist (`src/components/Worklist.tsx`)
- Powered by AG Grid Community (`ag-grid-react` v32) with Quartz theme styled to calm finance design tokens.
- Columns:
  1. **Invoice #** (`pinned: 'left'`) with `data-testid="worklist-row-{invoiceId}"`.
  2. **Payer**: Name with text filter.
  3. **Amount**: Right-aligned tabular currency via `formatUsd`.
  4. **Due Date**: Short formatted date via `formatDateShort`.
  5. **Days Overdue**: Tabular integer, red emphasis for active overdue invoices.
  6. **Invoice Status**: Verbatim humanized chip (green for `PAID`, amber for `PARTIALLY_PAID`, neutral for `SENT`/`DRAFT`).
  7. **Payer Risk**: Horizontal bar reflecting `payer.latenessRisk` with persona text label and accessible meter semantics.
  8. **Proposed Action**: Verbatim type and status chip (amber for `AWAITING_APPROVAL`, green for `EXECUTED`, red for `BLOCKED`/`FAILED`, neutral for `PROPOSED`/`APPROVED`/`REJECTED`, or `"No action"`).
- Keyboard Navigation: `Enter` opens drawer for focused row; `Esc` closes drawer and restores focus to the row.
- Performance: Memoized cell renderers (`React.memo`), `animateRows={false}`, `rowBuffer={10}`. Verified smooth scrolling and filtering with 200 virtualized rows (`?mockInvoices=200`).

### Action Review Drawer (`src/components/ActionDrawer.tsx`)
- Slide-over drawer built on Radix Dialog (`@radix-ui/react-dialog`) with `modal={false}` so hero scenario simulations on the dashboard remain visible side-by-side.
- Top-to-bottom layout:
  1. Header: invoice number, payer name, invoice amount, status chip, close button (`drawerClose`).
  2. Agent Reason (`drawerReason`): `"Why Settle proposes this"` verbatim reason text.
  3. Option Details: discount percentage or instalment breakdown.
  4. Impact Simulation: compact `BalanceChart` with scenario overlay, plus cash given up (`cashCost`), lowest balance change (`lowestDelta`), shortfall change (`shortfallDelta`), and `"Closes the gap"` indicator. Shows explicit `"No simulation attached"` fallback when absent.
  5. Assumptions List (`drawerAssumptions`): Unordered list from `simulation.assumptions`.
  6. Policy Safety Review (`drawerPolicy`): Shows allowed status, approval requirement, and prominent red violations list when `BLOCKED` with note `"Blocked by policy. Settle cannot override this."`.
  7. Status Timeline (`drawerTimeline`): Highlights strictly based on recorded timestamps and statuses. Displays `paypalRequestId` exclusively for `EXECUTED` status. Never claims "sent" or "paid" for pre-execution states.
  8. Action Controls:
     - `AWAITING_APPROVAL`: Primary accent "Approve" (`approveButton`) and secondary "Reject" (`rejectButton`). Double-click protected via submission ref lock.
     - `FAILED`: Error message and "Retry Execution" (`retryButton`).
     - Terminal/blocked states: Read-only notice.

### Live Real-Time Cell Flashing & SSE Updates
- Subscribes to event bus for `action.updated` and `invoice.updated`.
- Applies non-destructive updates and calls `gridApi.flashCells({ rowNodes: [node] })` without unmounting or resetting scroll and selection.
- Respects `prefers-reduced-motion`.

---

## 8. Verification Results

All acceptance checks run and passed:
1. `pnpm --filter web typecheck` -> 0 errors (`tsc --noEmit`).
2. `pnpm --filter web test` -> 88 tests passed across 18 test suites.
3. `pnpm --filter web build` -> Vite build succeeds with production asset optimization.
4. `git status` -> 0 changes outside `apps/web`.
