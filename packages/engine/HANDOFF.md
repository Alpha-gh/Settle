# System 2 ("Cash Engine") - Integration Handoff

This document details integration interfaces, operational invariants, known boundaries, and testing procedures for **System 1** (API & AI Agent) and **System 3** (Frontend & Policy Gate).

---

## 1. Exports & Public Surface

System 2 is packaged as `@settle/engine` (ESM module). Its public API is exported from `src/index.ts`:

```typescript
import { createEngine } from '@settle/engine';
import type { EnginePort } from '@settle/shared';

const engine: EnginePort = createEngine();
```

### Exported Types & Classes:
- `createEngine(): EnginePort` — Factory creating an instance implementing all 5 port methods.
- `EngineError` — Error class thrown on validation or lookup failures.
- `EngineErrorCode` — `'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_IMPLEMENTED'`.
- All domain types from `@settle/shared` (`ForecastInput`, `ForecastResult`, `ScenarioChange`, `ScenarioComparison`, `Snapshot`, `Kpis`, `Invoice`, `Payer`, `Obligation`, `Policy`, etc.).

---

## 2. Invariants & Conventions

1. **Pure Computation & Determinism**:
   - The engine performs **zero I/O**, zero network calls, zero file access, and reads no environment variables (`process.env`).
   - Clock time is banned: no `Date.now()`, no `new Date()`. The anchor date is always supplied as `business.asOf`.
   - Running the same method on identical inputs produces byte-identical JSON strings.
2. **Integer Currency (`Cents`)**:
   - All monetary figures (`startingBalance`, `reserveThreshold`, `amount`, `amountPaid`, `cashCost`, `shortfall`) are safe integer cents in USD.
   - Fractional cents are strictly rounded using **half-up integer arithmetic** (`roundHalfUpDiv` and basis points `applyDiscount`).
3. **Calendar Dates**:
   - Dates must be `'YYYY-MM-DD'` ISO strings.
   - Non-calendar dates (e.g. `2026-02-30`, `2026-13-01`, `2026-04-31`) and non-leap February 29ths throw `EngineError('INVALID_INPUT')`.
4. **Input Immutability**:
   - Engine methods make internal defensive copies. Input structures are never mutated.

---

## 3. Seed Scenario & Mathematical Proof

Located in `test-support/seedScenario.ts` and exported to `fixtures/seed-snapshot.json`.

- **Business**: *Apex Digital Agency*, `asOf: '2026-11-02'` (Monday).
- **Starting Balance**: $12,000.00 (`1_200_000` cents).
- **Reserve Threshold**: $5,000.00 (`500_000` cents).
- **Obligations**:
  - $2,000.00 Supplier payment on Wednesday `2026-11-04`.
  - $11,000.00 Payroll on Friday `2026-11-06`.
  - $1,500.00 Rent lease on Friday `2026-11-20`.
- **Invoices**: 8 total invoices, including 3 overdue `SENT` invoices:
  1. `inv_001`: $4,800.00 (Payer `pyr_001`, Persona `slow`, avgDaysLate 10).
  2. `inv_002`: $3,200.00 (Payer `pyr_002`, Persona `chronic`, avgDaysLate 20).
  3. `inv_003`: $3,000.00 (Payer `pyr_003`, Persona `reliable`, avgDaysLate 2).
  4. Also includes small sent invoices and 1 ghost payer (`pyr_004`, projected to `asOf + 90` as `uncertain`).

### Verified Proof Properties:
1. **Baseline Reserve Breach at Payroll**:
   Balance on Friday `2026-11-06` drops to **-$1,000.00**, producing a **$6,000.00 shortfall** below the $5,000.00 reserve threshold (`firstBreachDate === '2026-11-06'`).
2. **No Single Overdue Invoice Closes the Gap**:
   Collecting any single one of the 3 largest overdue invoices on Wednesday (`2026-11-04`) before payroll leaves the balance below the $5,000.00 reserve:
   - Collecting `inv_001` ($4,800) $\to$ Closing: $3,800.00 (Breach).
   - Collecting `inv_002` ($3,200) $\to$ Closing: $2,200.00 (Breach).
   - Collecting `inv_003` ($3,000) $\to$ Closing: $2,000.00 (Breach).
3. **Any Two Overdue Invoices Close the Gap**:
   Collecting any pair of the 3 overdue invoices before payroll restores Friday closing above the $5,000.00 reserve:
   - `inv_001` + `inv_002` ($8,000) $\to$ Closing: $7,000.00 (No breach, gap closed).
   - `inv_001` + `inv_003` ($7,800) $\to$ Closing: $6,800.00 (No breach, gap closed).
   - `inv_002` + `inv_003` ($6,200) $\to$ Closing: $5,200.00 (No breach, gap closed).

---

## 4. Known Boundaries & Integration Gaps

When integrating with System 1 and System 3, be aware of the following deliberate design boundaries:

1. **Single-Action Simulation (`simulate`)**:
   - `simulate(input, change)` evaluates **one proposed change at a time**.
   - If System 1 (AI Agent) plans a compound bundle (e.g. Remind Inv 1 AND Discount Inv 2), it should chain simulations sequentially or apply the modified receipts to the input for a second run.
2. **Engine Does Not Enforce Policy (`simulate` vs `Policy`)**:
   - System 2 `simulate` computes the mathematical cash impact of *any* requested change (even if it violates max discount or quiet hours).
   - Policy filtering, approval requirements, and restrictions belong to **System 3's Policy Gate**.
   - Use `generateOptions` to receive only policy-compliant proposals.
3. **Fixed 30-Day Horizon in `kpis`**:
   - `kpis(snapshot)` standardizes on a 30-day forecast horizon (`horizonDays: 30`) with conservative confidence (`includeUncertain: false`).
4. **Historical Payment Schedule Granularity**:
   - Partial payments are tracked via cumulative `amountPaid`. The engine does not store or process past partial payment schedules; remaining balance is calculated directly as $\text{netDiscountedAmount} - \text{amountPaid}$.
5. **Ghost Payer Handling**:
   - Ghost payers are projected to settle on $\text{asOf} + 90$ with confidence `'uncertain'`.
   - Therefore, ghost payer invoices are excluded from standard 30-day forecasts (`includeUncertain: false`), reflecting realistic collection risk.

---

## 5. Fixture Reference

The `packages/engine/fixtures/` directory provides pre-computed, deterministic fixtures for mocking and contract verification:

| Fixture File | Contents |
| :--- | :--- |
| `seed-snapshot.json` | Full `Snapshot` object matching the seed agency scenario. |
| `seed-input.json` | `ForecastInput` derived from the seed snapshot using `expectedReceipts`. |
| `forecast.baseline.json` | 30-day `ForecastResult` showing the day-5 payroll breach at -$1,000.00. |
| `simulate.option-1.json` | `ScenarioComparison` for `REMIND` on `inv_001` moving to `2026-11-16`. |
| `simulate.option-2.json` | `ScenarioComparison` for 3% `OFFER_DISCOUNT` on `inv_002` due on `2026-11-05`. |
| `simulate.option-3.json` | `ScenarioComparison` for `OFFER_INSTALMENTS` (2x) on `inv_003` starting `2026-11-05`. |

---

## 6. Verification Commands

```bash
# Run 188 unit, property, and edge tests
pnpm --filter engine test

# Strict typechecking (tsc --noEmit)
pnpm --filter engine typecheck

# Code coverage report (100% on core engine modules)
pnpm --filter engine coverage

# Regenerate fixtures and check for changes
pnpm --filter engine fixtures
git diff --stat packages/engine/fixtures # should produce 0 diff

# Run formatted demo
pnpm --filter engine demo
```

