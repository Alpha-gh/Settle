# System 2 "Cash Engine" Rules & Assumptions

This document defines the deliberate, visible domain rules, invariants, and architectural assumptions governing System 2 ("Cash Engine") of Settle.

---

## 1. Conventions & Principles

### 1.1 Pure Computation & Determinism
- **Zero Side-Effects**: Pure TypeScript only. No I/O, network calls, filesystem access, `process.env`, `Math.random()`, `Date.now()`, or zero-argument `new Date()`.
- **Referential Transparency**: For identical inputs, the engine produces byte-identical outputs.
- **Input Immutability**: All inputs are treated as strictly immutable and are never modified.

### 1.2 Units & Representation
- **Money**: All monetary values are integer `Cents` in USD (e.g., $100.00 = 10,000 cents). Floats are forbidden for currency.
- **Dates**: Calendar dates are strictly validated ISO-8601 strings in `'YYYY-MM-DD'` format. UTC midnight is used internally for calendar computations.
- **Day Numbering**:
  $$\text{day } N = \text{asOf} + (N - 1)$$
  The `asOf` date is **day 1** (array index `0`).

---

## 2. Forecast Rules (`forecast`)

### 2.1 Horizon & Timeline
- The forecast spans exactly `horizonDays` days starting on `business.asOf` (inclusive), so `days.length === horizonDays`.
- `horizonDays` must be an integer $\ge 1$. Invalid values (such as `0`, negative integers, or non-integers like `2.5`) throw an `EngineError` with code `INVALID_INPUT`.

### 2.2 Cash Flow Equation
Daily closing balances are computed sequentially:
- **Day 1 (index 0)**:
  $$\text{closing}[0] = \text{startingBalance} + \text{receipts}[0] - \text{outflows}[0]$$
- **Day $t$ (index $t > 0$)**:
  $$\text{closing}[t] = \text{closing}[t - 1] + \text{receipts}[t] - \text{outflows}[t]$$

### 2.3 Outflows (Obligations)
- Obligations are bucketed by their `dueDate`.
- Multiple obligations on the same date are summed.
- **Clamping**: Obligations due before `asOf` (`dueDate < asOf`) represent past-due commitments and are placed on `asOf` (Day 1).
- **Horizon Truncation**: Obligations due beyond the forecast horizon (`dueDate > asOf + horizonDays - 1`) are ignored.

### 2.4 Receipts (Expected Inflows)
- Receipts are bucketed by their expected `date`.
- Multiple receipts on the same date are summed.
- **Clamping**: Receipts dated before `asOf` (`date < asOf`) are clamped to `asOf` (Day 1).
- **Horizon Truncation**: Receipts dated beyond the forecast horizon (`date > asOf + horizonDays - 1`) are ignored.
- **Confidence Filtering**:
  - `confirmed` and `expected` receipts are always included.
  - `uncertain` receipts are excluded by default (conservative stance), and are only included when `includeUncertain === true`.

### 2.5 Metrics & Breach Detection
- **Reserve Threshold Breach**:
  A day is marked `belowReserve = true` whenever $\text{closing} < \text{reserveThreshold}$.
- **First Breach Date (`firstBreachDate`)**:
  The first calendar date in chronological order where $\text{closing} < \text{reserveThreshold}$. If the balance stays at or above reserve across the entire horizon, `firstBreachDate` is `null`.
- **Lowest Balance (`lowest`)**:
  The minimum closing balance across all days in the horizon:
  $$\text{lowest} = \min_{t} \text{closing}[t]$$
  In case of a tie between multiple days having the identical lowest balance, the **earliest calendar date** is selected.
- **Shortfall (`shortfall`)**:
  The maximum capital required to restore the lowest dip back to the reserve threshold:
  $$\text{shortfall} = \max(0, \text{reserveThreshold} - \text{lowest.amount})$$

### 2.6 Timing vs. Totals
- Aggregate sums of inflows minus outflows over a period hide intermediate liquidity crises.
- An account may finish a 30-day period with a surplus, but experience insolvency on day 3 due to cash flow timing. System 2 prioritizes chronological day-by-day timing over period aggregates.

---

## 3. Placeholder: Expected Receipts (`expectedReceipts`)
*(To be implemented in subsequent stage)*
- Modeling payer persona lateness risk (`avgDaysLate`, `latenessRisk`).
- Projecting expected settlement dates from invoice due dates and payer behavior.

---

## 4. Placeholder: Simulate (`simulate`)
*(To be implemented in subsequent stage)*
- Evaluating counterfactual scenario changes:
  - `REMIND` (nudging expected date forward)
  - `OFFER_DISCOUNT` (early settlement discount with cash cost)
  - `OFFER_INSTALMENTS` (spreading invoice amounts over multiple dates)
  - `PURCHASE` (outflow simulation for new capital expenses)
- Measuring delta on lowest balance, delta on shortfall, and determining whether the change closes the cash gap.

---

## 5. Placeholder: Generate Options (`generateOptions`)
*(To be implemented in subsequent stage)*
- Generating eligible intervention options constrained by business policy (`maxDiscountPct`, `maxInstalments`, etc.).

---

## 6. Placeholder: KPIs (`kpis`)
*(To be implemented in subsequent stage)*
- Calculating aggregate business metrics from snapshot: current cash, total overdue, overdue count, average days late, lowest balance, shortfall, and next obligation.

