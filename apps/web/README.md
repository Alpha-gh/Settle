# Settle Web (System 4)

Production web application frontend for Settle (React 18 + Vite + TypeScript strict).
System 4 delivers the human-in-the-loop dashboard, real-time liquidity forecasting, AG Grid receivables worklist, PayPal action approval drawer, conversational Co-pilot, immutable audit trail, and policy rules editor.

---

## 1. Prerequisites & Setup

- **Node.js**: `v20.x` or `v22.x`
- **Package Manager**: `pnpm` (v9 or v10)
- **Browser for E2E Tests**: Microsoft Edge (pre-installed on Windows) or Chromium CDP engine

### Install Dependencies
From the repository root:
```bash
pnpm install
```

---

## 2. Environment Variables

| Variable | Default | Purpose & Description |
| :--- | :--- | :--- |
| `VITE_API_BASE` | `""` (unset/empty) | Base URL for REST API and SSE stream (`${VITE_API_BASE}/api/events`). When unset or empty, the application runs fully standalone in **Mock Mode** using Mock Service Worker (MSW) and browser-internal reactive event bus. When set (e.g. `http://localhost:3000`), all requests and EventSource streams hit the live backend API. |
| `VITE_MOCK_LATENCY_MS`| `250` | Simulated network latency in milliseconds for MSW request handlers (overridden to `100` during Playwright E2E tests for speed). |

---

## 3. Running & Development

### Start Development Server
```bash
pnpm --filter web dev
```
Runs Vite on [http://localhost:5173/](http://localhost:5173/).

To experience the guided interactive demo story, navigate to:
```
http://localhost:5173/?demo=1
```

### Static Type Checking
```bash
pnpm --filter web typecheck
```
Executes strict TypeScript check (`tsc --noEmit`).

### Linting
```bash
pnpm --filter web lint
```
Runs ESLint with zero allowed warnings/errors across all source files and test suites.

### Unit & Integration Tests
```bash
pnpm --filter web test
```
Executes Vitest suite (137 tests across 27 test files covering components, formatting, derivations, schema validation, WCAG AA contrast, error recovery with retry, and grep guard enforcement).

### Playwright End-to-End Tests
```bash
pnpm --filter web test:e2e
```
Runs full Playwright suite (12 tests across smoke flow, accessibility audits, test IDs, and 200-row virtualization performance) with a strict zero-console-error and zero-warning fixture.

### Production Build
```bash
pnpm --filter web build
```
Typechecks and compiles production bundle to `dist/`. Chunks are optimized via `manualChunks` to keep all assets < 235 kB gzipped.

---

## 4. Architecture & Directory Structure

```
apps/web/
├── e2e/                           # Playwright E2E specifications
│   ├── fixtures.ts                # Strict error-capturing fixture (console/page errors)
│   ├── smoke.spec.ts              # Continuous 3-minute demo flow (steps a-g)
│   ├── a11y.spec.ts               # Axe WCAG 2.1 AA audits on all routes + drawers
│   ├── testids.spec.ts            # Coverage verification of data-testids
│   └── perf.spec.ts               # 200-row AG Grid virtualized performance
├── src/
│   ├── api/                       # Data fetching, queries, schemas, and event bus
│   │   ├── bus.ts                 # Reactive SSE event bus adapter
│   │   ├── endpoints.ts           # Single source of truth for API URL endpoints
│   │   ├── impactAdapter.ts       # Fallback derivation adapter for /api/impact
│   │   ├── queries.ts             # TanStack Query hooks & mutations
│   │   ├── schemas.ts             # Strict Zod schemas with AssertEqual contract checks
│   │   ├── selectors.ts           # Pure snapshot + actions worklist row joins
│   │   └── sse.tsx                # SseProvider with exponential backoff & cache reconciliation
│   ├── components/                # Modular UI components
│   │   ├── ActionDrawer.tsx       # Side drawer with PayPal execution timeline
│   │   ├── AppShell.tsx           # Layout, header, navigation, and sandbox badge
│   │   ├── AuditTimeline.tsx      # Immutable audit trail with actor filtering
│   │   ├── BalanceChart.tsx       # AG Charts 30-day liquidity forecast & breach markers
│   │   ├── BreachBanner.tsx       # Alert banner for predicted reserve breaches
│   │   ├── Copilot.tsx            # Conversational Co-pilot slide-over with charts
│   │   ├── DemoControls.tsx       # Floating interactive demo panel (?demo=1)
│   │   ├── DevErrorOverlay.tsx    # Dev-only full-screen Zod schema failure overlay
│   │   ├── GapClosedBanner.tsx    # Success banner when reserve shortfall is resolved
│   │   ├── ImpactCard.tsx         # Before vs After liquidity recovery metrics
│   │   ├── KpiCards.tsx           # Cash today, lowest balance, shortfall, overdue
│   │   ├── PolicyForm.tsx         # React Hook Form + Zod policy rules editor
│   │   └── Worklist.tsx           # High-performance AG Grid virtualized receivables
│   ├── lib/                       # Core utilities & derivations
│   │   ├── derive.ts              # Permitted financial derivations (daysOverdue in UTC)
│   │   └── format.ts              # Integer-math USD formatter, UTC dates, humanizer
│   ├── mocks/                     # Standalone MSW fixtures, handlers, and state machine
│   ├── pages/                     # Routed pages (/, /receivables, /audit, /policy)
│   ├── state/                     # URL search param synchronization & breach memory
│   ├── test/                      # Test setup, matchers, and JSDOM mocks
│   ├── index.css                  # Tailwind styles and AG Charts/Grid overrides
│   ├── main.tsx                   # App bootstrap with MSW conditional initialization
│   ├── routes.tsx                 # React Router route declarations
│   └── testids.ts                 # Centralized test ID constants (TID)
├── AGENT_RULES.md                 # 10 Non-Negotiable Operational & Financial Rules
├── CONTRACT_CHANGE_REQUEST.md     # Formal CCR for System 1 / 2 / 3 leads
├── HANDOFF.md                     # Comprehensive technical handoff & rehearsal shot list
├── package.json                   # Dependencies, scripts, and package metadata
├── playwright.config.ts           # Playwright configuration
├── tsconfig.json                  # Strict TypeScript configuration
└── vite.config.ts                 # Vite bundler configuration & code splitting
```

---

## 5. Contract Notes & TODOs

- Domain types are imported from `@settle/shared` via workspace reference and TypeScript path alias.
- **TODO**: Remove the path/Vite alias pointing to `packages/shared/src/index.ts` once `@settle/shared` package distribution lands cleanly in monorepo CI without local source resolution.
- Refer to `docs/API.md` and `CONTRACT_CHANGE_REQUEST.md` for proposed backend endpoints (`/api/impact`, idempotency keys, and action retry routes).
