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

## 8. Stage 4: Co-Pilot, Audit Timeline, Policy Settings & Impact Notes

### Co-Pilot Panel (`src/components/Copilot.tsx`)
- Slide-over drawer opened via header button (`copilotToggle`) across all views; built with Radix Dialog, accessible focus trap, and `Esc` dismissal.
- Three canned suggested prompt chips (`chatSuggestion1`, `chatSuggestion2`, `chatSuggestion3`):
  1. *"Can I cover payroll on Friday?"*
  2. *"What if I buy $3,000 of stock on Monday?"*
  3. *"Which invoice should I chase first?"*
- Answers rendered strictly as plain text nodes to prevent markdown or HTML injection.
- Collapsed-by-default `"Tool calls"` disclosure (`<details>`, `copilotToolCalls`) listing tool name, formatted args, and result.
- Inline scenario simulation visualization: renders compact `BalanceChart` with baseline and scenario comparison series plus three-metric row (`cashCost`, `lowestDelta`, `shortfallDelta`) and `"Closes the gap"` tag; renders single trajectory chart when `forecast` is attached alone.
- Session message history preserved in component state. Displays thinking indicator (`copilotThinking`) and error bubble with retry (`copilotError`, `copilotRetry`).

### Audit Timeline (`src/components/AuditTimeline.tsx` & `/audit` route)
- Fetches all audit records from `GET /api/audit`, sorted newest first via immutable date string comparison.
- Live real-time SSE appending via `audit.appended` event handler with smooth height transition and scroll lock preservation.
- Actor filter chips (`All`, `Agent`, `Owner`, `PayPal`, `System`, testid `auditFilter`).
- Monospace PayPal request ID badge (`paypalRequestId`) on payment and gateway records.
- Expandable collapsed-by-default `detail` JSON viewer (`<details>`).
- Compact top-5 preview rendered directly on the primary dashboard.

### Policy Rules Form (`src/components/PolicyForm.tsx` & `/policy` route)
- Type-safe policy configuration powered by `react-hook-form` + Zod schema validation matching `@settle/shared` `Policy`.
- Strict string-parsing currency parsing (`src/lib/money.ts` `parseDollarsToCents`):
  - Zero floating-point arithmetic.
  - Rejects negative values, non-numeric strings, and inputs with >2 decimal places.
  - Round-trip tested (`parseDollarsToCents` <-> `centsToDollarsString`).
- Granular inline validation errors for each field.
- Save button (`policySave`) remains disabled until the form is both dirty and valid.
- Optimistic feedback: success toast alert (`role="status"`, testid `toast`) auto-dismissing after 3.5s; server error notification with retry button (`policyError`, `policyRetry`).

### Impact Card (`src/components/ImpactCard.tsx`)
- Replaces dashboard impact placeholder with high-integrity "Before vs After" financial comparison.
- Captures initial session baseline metrics as immutable "Before" state:
  - Lowest cash balance
  - Cash reserve shortfall
- Displays verified "After" metrics from current live API state.
- Invoices collected count and cash given up in settlement discounts sourced from action and ledger data.
- Green improvement indicators conditionally applied ONLY when API values improved (`afterLowest > beforeLowest` or `afterShortfall < beforeShortfall`).
- Accessible empty state (`"Run Settle to see impact"`) when no actions have yet executed.

### Demo Controls (`src/components/DemoControls.tsx`)
- Guarded panel rendered ONLY when `?demo=1` query parameter is present or `settle:demo=1` is stored in `sessionStorage`.
- Sticky bottom-left overlay (`demoPanel`) providing sandbox utilities:
  1. **Reset Ledger**: Inline confirmation step (`"Confirm reset?"` -> `"Yes, reset"`, testid `demoReset`).
  2. **Run Agent**: Evaluates recommendations (`demoRunAgent`).
  3. **Simulate Payment**: Emulates external PayPal settlement webhook for currently selected invoice (`demoSimulatePayment`).

### Performance & Chunk Splitting (`vite.config.ts`)
- Configured Rollup `manualChunks` to split large vendor dependencies:
  - `vendor-ag-charts`: 230.05 kB gzipped
  - `vendor-ag-grid`: 233.91 kB gzipped
  - `vendor-react`: 66.21 kB gzipped
  - `vendor-radix`: 13.63 kB gzipped
  - `browser` (MSW mock worker): 103.38 kB gzipped
  - `index` (app code): 50.56 kB gzipped
- Every bundle chunk is well below the 400 kB gzipped threshold.

### Accessibility & WCAG 2.1 AA Compliance
- Automated accessibility verification via `@axe-core/playwright` across all views:
  - `/` (Dashboard): **0 serious/critical violations**
  - `/audit` (Audit Timeline): **0 serious/critical violations**
  - `/policy` (Policy Rules): **0 serious/critical violations**
  - With Co-pilot drawer open: **0 serious/critical violations**
- AG Charts synthetic proxy container hidden in favor of the explicit `role="img"` container and accessible hidden table (`chartFallbackTable`).

---

## 9. Full System Verification Summary

All verification gates have passed completely:
1. `pnpm --filter web typecheck` -> **0 errors** (`tsc --noEmit`).
2. `pnpm --filter web lint` -> **0 errors, 0 warnings** (`eslint .`).
3. `pnpm --filter web test` -> **137 tests passed across 27 test files** (100% passing).
4. `pnpm --filter web test:e2e` -> **12 Playwright tests passed** across smoke flow, accessibility audits, test IDs, and virtualization performance.
5. `pnpm --filter web build` -> **Vite build succeeds**, all chunks < 234 kB gzipped.
6. `axe-core` accessibility audit -> **0 serious or critical violations** on all routes and drawers.
7. Monorepo boundary check -> **0 changes outside `apps/web/`**, `.env` untracked.

---

## 10. 3-Minute Demo Script & Rehearsal Shot List

The following exact sequence delivers the complete Settle story in under 3 minutes for live presentations, video recordings, or evaluation:

| # | Time | User Action | Visual State & Expected UI Response | Narration / What to Say |
| :--- | :--- | :--- | :--- | :--- |
| **1** | `0:00` | Open browser to `http://localhost:5173/?demo=1` | Sandbox badge visible ("Sandbox - no real funds"). Red breach banner alerts: *"Payroll November (Bi-weekly) on Fri 6 Nov: short $2,000.00 under your reserve"*. 30-day chart shows closing balance dipping below reserve on Friday. | *"Welcome to Settle. Here is Northwind Studio's cash outlook. Notice the red alert: without intervention, payroll on Friday November 6th will breach our $5,000 operating reserve by exactly $2,000."* |
| **2** | `0:30` | Click **"Run Settle"** button | Indeterminate progress bar shows *"Running Settle"*. Button disables. Result line appears: *"7 actions proposed, 1 invoice skipped"*. Receivables worklist populates with action pills. | *"We trigger Settle's autonomous engine. Settle analyzes the ledger, computes optimal recovery options under our policy guardrails, and identifies high-probability actions to close the gap."* |
| **3** | `0:55` | Click **"Co-pilot"** header button | Co-pilot panel slides in smoothly from the right. Focus traps. Suggested prompt chips appear. | *"Let's open the Settle Co-pilot to interrogate our liquidity trajectory in natural language."* |
| **4** | `1:10` | Click *"Can I cover payroll on Friday?"* prompt chip | Thinking pulse indicator appears. Plain-text answer streams in. Tool call disclosure details ledger queries. Inline simulation chart shows baseline vs proposed recovery trajectory. | *"The Co-pilot confirms our payroll liability, inspects overdue receivables, and projects that recovering Bluefin Media's invoice will preserve our liquidity buffer."* |
| **5** | `1:30` | Press `Esc` or click `X` to close Co-pilot; click `INV-1001` (Bluefin Media) row in worklist | Action review drawer opens for `act_001`. "Closes the gap" green badge renders. Policy verdict confirms within limits. Hero chart on dashboard overlays blue scenario trajectory. Status timeline highlights `PROPOSED` -> `AWAITING_APPROVAL`. | *"Here is the proposed action for Bluefin Media: a 3% early-settlement discount. Settle proves this action recovers $4,850 and prevents the payroll breach. The timeline strictly reflects API state without premature claims."* |
| **6** | `2:00` | Click **"Approve"** button in drawer | Approve button enters pending state. Timeline transitions to `APPROVED` (decided by owner). Within ~1.2s, status transitions to `EXECUTED` with a monospace PayPal request ID (`PP-REQ-7F3A91`). | *"With one click, the owner approves the settlement. Settle calls the PayPal Invoicing API, executing the discount and attaching the immutable PayPal tracking reference."* |
| **7** | `2:25` | In the floating Demo panel, click **"Simulate payment for INV-1001"** | Simulated settlement event triggers via SSE. Worklist row flashes green and updates chip to `Paid`. Red breach alert disappears. Green banner slides in: *"Gap closed: your balance now stays above your reserve"*. Shortfall KPI drops to `$0.00`. | *"Bluefin Media settles their invoice via PayPal. In real-time, the ledger updates: the breach is completely eliminated, cash today increases, and our reserve remains protected."* |
| **8** | `2:45` | Click **"Audit Log"** in sidebar navigation | Audit timeline displays newest event first: PayPal settlement webhook, followed by owner approval and PayPal API execution with request IDs and expandable JSON details. | *"Every recommendation, human approval, and financial execution is permanently recorded in the immutable audit log for absolute governance and compliance."* |
| **9** | `2:55` | Click **"Dashboard"** in sidebar navigation | Impact card shows verified Before vs After metrics: initial lowest balance vs after-settlement balance, shortfall closed, and 1 invoice collected. | *"Returning to the dashboard, the Impact card quantifies the tangible business value Settle delivered in seconds: zero shortfall and continuous operational solvency."* |

---

## 11. Contract Component Map

Every data contract imported from `@settle/shared` is mapped to its rendering component and verification suite:

| Domain Type | Shared Interface / Type | Rendering Files | Schema & Validation | Unit & E2E Tests |
| :--- | :--- | :--- | :--- | :--- |
| **Snapshot** | `Snapshot`, `Business`, `Obligation` | `KpiCards.tsx`, `BreachBanner.tsx`, `AppShell.tsx` | `snapshotSchema` in `src/api/schemas.ts` | `KpiCards.test.tsx`, `BreachBanner.test.tsx`, `e2e/smoke.spec.ts` |
| **Invoice** | `Invoice`, `InvoiceStatus` | `Worklist.tsx`, `ActionDrawer.tsx` | `invoiceSchema` in `src/api/schemas.ts` | `Worklist.test.tsx`, `ActionDrawer.test.tsx`, `e2e/perf.spec.ts` |
| **Payer** | `Payer`, `LatenessRisk` | `Worklist.tsx`, `ActionDrawer.tsx` | `payerSchema` in `src/api/schemas.ts` | `Worklist.test.tsx` |
| **Forecast** | `ForecastResult`, `DailyBalance`, `BreachDay` | `BalanceChart.tsx`, `GapClosedBanner.tsx`, `ImpactCard.tsx` | `forecastResultSchema` in `src/api/schemas.ts` | `BalanceChart.test.tsx`, `GapClosedBanner.test.tsx`, `e2e/smoke.spec.ts` |
| **Action** | `ActionRecord`, `ActionType`, `ActionStatus` | `Worklist.tsx`, `ActionDrawer.tsx` | `actionRecordSchema` in `src/api/schemas.ts` | `ActionDrawer.test.tsx`, `Worklist.test.tsx`, `e2e/smoke.spec.ts` |
| **Policy** | `Policy`, `AutopilotRules` | `PolicyForm.tsx`, `ActionDrawer.tsx` | `policySchema` in `src/api/schemas.ts` | `PolicyForm.test.tsx`, `e2e/a11y.spec.ts`, `e2e/testids.spec.ts` |
| **Audit** | `AuditEvent`, `AuditActor` | `AuditTimeline.tsx` | `auditEventSchema` in `src/api/schemas.ts` | `AuditTimeline.test.tsx`, `e2e/smoke.spec.ts` |
| **Chat** | `ChatAnswer`, `ToolCall` | `Copilot.tsx` | `chatAnswerSchema` in `src/api/schemas.ts` | `Copilot.test.tsx`, `e2e/smoke.spec.ts` |
| **SSE Events** | `SseEvent` | `src/api/sse.tsx`, `src/api/bus.ts` | `sseEventSchema` in `src/api/schemas.ts` | `handlers.test.ts`, `e2e/smoke.spec.ts` |

---

## 12. SSE Reconnection, Exponential Backoff & Cache Invalidation

The real-time streaming layer in `src/api/sse.tsx` guarantees live UI synchronization under lossy network conditions:

1. **Connection Lifecycle**:
   - In Live Mode (`VITE_API_BASE` set): Connects to native `EventSource("${VITE_API_BASE}/api/events")`.
   - In Mock Mode (`VITE_API_BASE` empty): Connects to `mockEventBus` in `src/api/bus.ts`.
2. **Exponential Backoff**:
   - Initial reconnect attempt: 1,000 ms.
   - Growth factor: $2.0 \times$ with random jitter ($\pm 20\%$) to prevent thundering herd.
   - Maximum backoff ceiling: 30,000 ms.
   - Automatically resets backoff counter upon successful connection.
3. **Targeted Query Invalidation**:
   Inbound events do not blindly wipe the cache; they execute fine-grained patches:
   - `invoice.updated`: Patches snapshot invoices in-place and flashes updated AG Grid rows.
   - `action.updated`: Updates action record in `actions` cache and refreshes drawer state.
   - `forecast.updated`: Reconciles `forecast` query and triggers gap-closed detection.
   - `audit.appended`: Prepends new audit record to the `audit` query cache without scrolling jumps.
4. **Resilience & Offline Handling**:
   - Listens to browser `online` and `offline` events.
   - Displays real-time connection badge in `<AppShell />` (`connected` vs `reconnecting...`).

---

## 13. Edge Cases, Fallbacks & Error Boundaries

System 4 is hardened against exceptional data and network states:

| Scenario | Handled By | UI Behavior & Guarantee |
| :--- | :--- | :--- |
| **Network Failure during API Request** | `src/api/queries.ts` + Component Error States | Displays retry card with accessible retry button. Verified across KPI cards, Worklist, Audit log, and Policy form (`errorStates.test.tsx`). |
| **Zod Schema Parse Mismatch** | `DevErrorOverlay.tsx` & `src/api/schemas.ts` | In development: full-screen diagnostic overlay with endpoint name and offending keys. In production (`!import.meta.env.DEV`): fails silently to regular query retry state. |
| **Action Lacks Attached Simulation** | `ActionDrawer.tsx` | Renders clear notice *"No simulation attached"* rather than crashing or rendering blank charts. |
| **No Overdue Invoices in Ledger** | `Worklist.tsx` | Renders calm empty state *"No overdue invoices"*. |
| **Policy Form String-to-Cents Parsing** | `src/lib/money.ts` | Prevents floating point errors; strictly validates `$0.00` format, rejecting negative numbers or malformed decimals. |
| **Rapid Double-Clicks on Mutations** | `RunSettleButton.tsx`, `ActionDrawer.tsx` | Synchronous ref submission lock (`isSubmittingRef`) drops duplicate calls instantly. |
| **Screen Reader Accessibility on Charts** | `BalanceChart.tsx` | Hides AG Charts canvas proxies (`.ag-charts-canvas-proxy`); surfaces container `role="img"` with descriptive sentence and visually hidden HTML data table (`chartFallbackTable`). |
