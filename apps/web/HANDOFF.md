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
Key seeded test IDs include:
- `sandboxBadge`: `'sandbox-badge'`
- `runSettle`: `'run-settle'`
- `kpiCash`: `'kpi-cash'`
- `kpiLowest`: `'kpi-lowest'`
- `kpiShortfall`: `'kpi-shortfall'`
- `kpiOverdue`: `'kpi-overdue'`
- `breachBanner`: `'breach-banner'`
- `gapClosedBanner`: `'gap-closed-banner'`
- `balanceChart`: `'balance-chart'`
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

## 6. MSW Mock Service Worker & State Machine (Rule 7)

- `VITE_API_BASE` unset or empty activates MSW in `src/main.tsx` via `src/mocks/browser.ts`.
- `MockStateMachine` in `src/mocks/state.ts` implements stateful transitions:
  - Initial baseline with $2,000 payroll shortfall breach on Friday 2026-11-06.
  - `POST /api/agent/run`: 1500ms delay, generates 7 actions across distinct statuses (1 auto-approved executed small discount, 1 awaiting approval larger discount that closes gap, 1 skipped).
  - `POST /api/actions/:id/approve`: transitions immediately to `APPROVED`, then executes via PayPal after ~1200ms.
  - `POST /api/demo/simulate-payment/:invoiceId`: marks invoice PAID, reconciles cash balance, updates forecast to eliminate breach, and refreshes KPIs.
  - `POST /api/chat`: canned answers for 3 prompt scenarios with tool calls and comparison data; honest fallback for others.
  - `?mockInvoices=200`: deterministic generator produces 200 valid invoices for performance tests without `Math.random()`.
- Real-time updates push via `MockEventBus` (`src/api/bus.ts`) in mock mode or `EventSource` in live mode (`src/api/sse.tsx`).

---

## 7. Verification Results

All acceptance checks run and passed:
1. `pnpm --filter web typecheck` -> 0 errors.
2. `pnpm --filter web test` -> 45 tests passed across 8 test suites.
3. `pnpm --filter web build` -> Vite build succeeds with bundle optimization.
4. `git status` -> 0 changes outside `apps/web`.

