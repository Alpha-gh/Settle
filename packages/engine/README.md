# @settle/engine (System 2: Cash Engine)

Pure TypeScript cash flow and accounts receivable (AR) intelligence engine for small businesses. Part of **Settle** (PayPal AI Hackathon).

---

## 1. Overview & Guarantees

The Cash Engine provides deterministic, zero-dependency financial simulation, forecasting, and intervention option modeling.

### Core Guarantees:
- **Pure Computation**: Zero I/O, no network, no filesystem access, no environment variables (`process.env`), no wall-clock timers (`Date.now()`, `new Date()`), and no randomness.
- **Determinism**: Given identical inputs, every calculation produces byte-identical outputs (`JSON.stringify(run1) === JSON.stringify(run2)`).
- **Integer Cents**: All currency is stored and calculated in integer cents (`USD`), completely eliminating IEEE 754 floating-point rounding anomalies.
- **Strict Dates**: Strict ISO-8601 calendar strings (`'YYYY-MM-DD'`), rejecting invalid dates such as leap-year violations (`2026-02-29`) or non-existent months (`2026-13-01`).
- **Input Immutability**: All engine methods leave input objects completely unmodified (verified via recursive `Object.freeze` in test suites).
- **Zero NaN/Infinity**: Strict integer and basis-point division safeguards ensure `NaN` or `Infinity` can never be emitted.

---

## 2. Architecture & Folder Map

```text
packages/engine/
├── fixtures/                     # Deterministic JSON fixtures for System 1 & 3 integration
│   ├── seed-snapshot.json        # 8-invoice seed business snapshot with reserve breach
│   ├── seed-input.json           # Baseline forecast input generated from snapshot
│   ├── forecast.baseline.json    # 30-day baseline forecast showing day-5 payroll breach
│   ├── simulate.option-1.json    # Option 1: REMIND on inv_001
│   ├── simulate.option-2.json    # Option 2: OFFER_DISCOUNT (3%) on inv_002
│   ├── simulate.option-3.json    # Option 3: OFFER_INSTALMENTS (2x) on inv_003
│   └── README.md                 # Detailed documentation of fixture shapes & invariants
├── scripts/
│   ├── generate-fixtures.ts      # Deterministic script to regenerate fixtures/
│   └── demo.ts                   # Executable CLI demo with ASCII tabular outputs
├── src/
│   ├── dates.ts                  # Pure ISO date utilities (parseISO, addDays, diffDays, compareISO)
│   ├── errors.ts                 # Standardized EngineError (INVALID_INPUT, NOT_FOUND)
│   ├── expectedReceipts.ts       # Expected receipts projection from invoices and payer personas
│   ├── forecast.ts               # Core day-by-day cash flow forecast and breach detector
│   ├── index.ts                  # EnginePort implementation and createEngine() factory
│   ├── kpis.ts                   # High-level business working capital and overdue KPIs
│   ├── money.ts                  # Half-up integer division and discount calculation
│   ├── options.ts                # AR intervention options generation
│   └── simulate.ts               # Counterfactual scenario simulation
├── test/
│   ├── dates.test.ts             # Strict calendar date validation tests
│   ├── edge-cases.test.ts        # Comprehensive boundary, validation, and error tests
│   ├── engine.test.ts            # Integration tests for createEngine()
│   ├── expectedReceipts.test.ts  # Persona mapping and receipt projection tests
│   ├── fixtures.test.ts          # Fixture schema and integrity tests
│   ├── forecast.test.ts          # Forecast cash conservation and breach tests
│   ├── helpers.ts                # deepFreeze and assertNoNaN testing utilities
│   ├── kpis.test.ts              # Working capital and overdue metric tests
│   ├── money.test.ts             # Integer basis-point and half-up division tests
│   ├── options.test.ts           # Option generation tests by persona and policy
│   ├── properties.test.ts        # Property-based fast-check tests (300 runs, fixed seed 42)
│   ├── purity.test.ts            # Static source AST audit verifying zero side-effects
│   ├── seedScenario.test.ts      # Mathematical proof of payroll gap closing logic
│   └── simulate.test.ts          # Counterfactual scenario comparison tests
├── test-support/
│   ├── fixturesData.ts           # Shared seed scenario definitions
│   └── seedScenario.ts           # Seed snapshot builder and proof helpers
├── package.json
├── RULES.md                      # Comprehensive domain rules and mathematical invariants
├── HANDOFF.md                    # Integration guide and known boundaries for Systems 1 & 3
├── tsconfig.json                 # TypeScript strict configuration (noUncheckedIndexedAccess)
└── vitest.config.ts              # Vitest configuration with v8 coverage thresholds (90%+)
```

---

## 3. Quickstart & Usage

```typescript
import { createEngine } from '@settle/engine';

const engine = createEngine();

// 1. Forecast cash balances across a horizon
const forecastResult = engine.forecast({
  business: {
    id: 'biz_01',
    name: 'Apex Studio',
    currency: 'USD',
    asOf: '2026-11-02',
    startingBalance: 1_200_000, // $12,000.00
    reserveThreshold: 500_000,   // $5,000.00
  },
  horizonDays: 30,
  includeUncertain: false,
  obligations: [
    { id: 'obl_1', label: 'Payroll', kind: 'payroll', amount: 1_100_000, dueDate: '2026-11-06' },
  ],
  receipts: [
    { invoiceId: 'inv_1', amount: 320_000, date: '2026-11-10', confidence: 'expected' },
  ],
});

console.log(forecastResult.firstBreachDate); // '2026-11-06'
console.log(forecastResult.shortfall);       // 600000 ($6,000.00)
```

---

## 4. API Reference

All methods are available on the interface returned by `createEngine()`.

### 4.1 `forecast(input: ForecastInput): ForecastResult`
Computes day-by-day closing balances from `business.asOf` through `asOf + horizonDays - 1`.
- Past obligations/receipts (`date < asOf`) are clamped to `asOf` (Day 1).
- Obligations/receipts beyond the horizon are excluded.
- Evaluates `firstBreachDate`, minimum `lowest` balance (earliest date on tie), and total reserve `shortfall`.

### 4.2 `expectedReceipts(invoices: Invoice[], payers: Payer[], asOf: ISODate): ExpectedReceipt[]`
Derives projected cash inflows from open invoices (`SENT`, `PARTIALLY_PAID`) and historical payer behavior:
- Net remaining amount: $\text{applyDiscount}(\text{amount}, \text{discountPct}) - \text{amountPaid}$.
- Settlement date: $\max(\text{asOf}, \text{dueDate} + \text{round}(\text{payer.avgDaysLate}))$.
- Personas:
  - `reliable`: confidence `'expected'`.
  - `slow`: confidence `'expected'` if $\text{avgDaysLate} \le 14$, else `'uncertain'`.
  - `chronic`: confidence `'uncertain'`.
  - `ghost`: confidence `'uncertain'`, projected to $\text{asOf} + 90$ days.

### 4.3 `simulate(input: ForecastInput, change: ScenarioChange): ScenarioComparison`
Performs counterfactual evaluation comparing a baseline forecast against a proposed action:
- Supported actions:
  - `REMIND`: Moves receipt to `newExpectedDate` with confidence `'expected'`, `cashCost = 0`.
  - `OFFER_DISCOUNT`: Reduces receipt amount by `discountPct`, sets `cashCost = original - discounted`.
  - `OFFER_INSTALMENTS`: Splits receipt into `count` equal parts (remainder cents to part 1), `cashCost = 0`.
  - `PURCHASE`: Injects an additional outflow obligation (`kind: 'other'`), `cashCost = 0`.
- Returns `lowestDelta`, `shortfallDelta`, `closesGap`, and plain-language `assumptions`.

### 4.4 `generateOptions(input: ForecastInput, invoice: Invoice, payer: Payer, policy: Policy): ScenarioChange[]`
Synthesizes candidate collection strategies for overdue invoices respecting business policy:
- Yields candidate `REMIND`, `OFFER_DISCOUNT` (tiers $\le \text{policy.maxDiscountPct}$), and `OFFER_INSTALMENTS` (counts $2 \dots \text{policy.maxInstalments}$).
- Suppresses discounts and instalments for ineligible personas (e.g. ghost payers).

### 4.5 `kpis(snapshot: Snapshot): Kpis`
Extracts working capital health metrics from a complete business snapshot:
- `cash`: `business.startingBalance`.
- `overdueTotal`: Sum of remaining balances on open overdue invoices.
- `overdueCount`: Number of open overdue invoices.
- `avgDaysLate`: Mean overdue days across overdue invoices (rounded half-up, `0` if empty).
- `lowest` & `shortfall`: Computed via 30-day baseline forecast (`includeUncertain: false`).
- `nextObligation`: Earliest obligation due on or after `asOf` (ties broken by lowest ID).

---

## 5. Development & Verification Commands

```bash
# Run complete test suite (188 tests across 13 test files)
pnpm --filter engine test

# Run tests in watch mode
pnpm --filter engine test:watch

# Strict TypeScript typechecking (tsc --noEmit)
pnpm --filter engine typecheck

# Code coverage audit (enforces >= 90% across forecast.ts and simulate.ts)
pnpm --filter engine coverage

# Regenerate deterministic test fixtures
pnpm --filter engine fixtures

# Run visual ASCII demo
pnpm --filter engine demo
```

---

## 6. Coverage & Purity Metrics

- **Unit, Property & Edge Tests**: 188 tests passing across 13 test suites.
- **Statement & Line Coverage**: **99.44%** overall, **100%** on `forecast.ts`, `simulate.ts`, `dates.ts`, `errors.ts`, `options.ts`, and `index.ts`.
- **Property-Based Testing**: `fast-check` suite with 300 runs on fixed seed 42 verifying cash conservation, day-by-day identity, instalment exactness, discount invariants, and receipt monotonicity.
- **Purity Test**: 64 assertions scanning every file under `src/` ensuring absolute absence of external I/O, `process.env`, `Date.now()`, `Math.random()`, or non-relative imports.
