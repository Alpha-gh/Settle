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

## 3. Expected Receipts (`expectedReceipts`)

### 3.1 Eligibility & Net Amount
- Only invoices with status `SENT` or `PARTIALLY_PAID` produce expected receipts. Invoices in `DRAFT`, `PAID`, `CANCELLED`, or `REFUNDED` status produce nothing.
- The net remaining balance is calculated with half-up rounding using integer basis-point arithmetic:
  $$\text{remaining} = \text{applyDiscount}(\text{amount}, \text{discountPct}) - \text{amountPaid}$$
- Invoices where $\text{remaining} \le 0$ are skipped.

### 3.2 Projected Settlement Date & Clamping
- For standard payers (`reliable`, `slow`, `chronic`), settlement date projects based on payer historical lateness:
  $$\text{date} = \max(\text{asOf}, \text{dueDate} + \text{round}(\text{payer.avgDaysLate}))$$
- Receipts with projected dates earlier than `asOf` are clamped to `asOf` (due immediately).

### 3.3 Persona Confidence Mapping
- **`reliable`**: Confidence is `expected`.
- **`slow`**:
  - If `avgDaysLate <= 14`: confidence is `expected`.
  - If `avgDaysLate > 14`: confidence is `uncertain`.
- **`chronic`**: Confidence is `uncertain`.
- **`ghost`**: Confidence is `uncertain`, and the projected date is set to $\text{asOf} + 90$ calendar days.

### 3.4 Invariants & Ordering
- Missing payer records for an open invoice throw an `EngineError` with code `NOT_FOUND` explicitly naming the `invoiceId`.
- Receipts are deterministically sorted by `(date ASC, invoiceId ASC)`.

---

## 4. Scenario Simulation (`simulate`)

### 4.1 Principles & Referential Transparency
- `simulate` is a pure counterfactual evaluation that leaves the input completely untouched.
- A baseline forecast is executed on the input; a scenario forecast is executed on a modified copy reflecting the proposed intervention.
- The engine does **not** enforce policy constraints during simulation; policy enforcement belongs to the policy gate.

### 4.2 Counterfactual Changes
- **`REMIND`**:
  - Moves the invoice receipt date to `newExpectedDate`.
  - Upgrades confidence to `'expected'`.
  - $\text{cashCost} = 0$.
- **`OFFER_DISCOUNT`**:
  - Discount percentage must be in $(0, 100]$.
  - **Stacking Assumption**: The discount applies directly against the invoice's existing remaining receipt amount (which may already incorporate prior line-item or invoice-level discounts):
    $$\text{newAmount} = \text{applyDiscount}(\text{remaining}, \text{discountPct})$$
  - Date becomes `newExpectedDate`, confidence upgrades to `'expected'`.
  - **Cash Cost Definition**:
    $$\text{cashCost} = \text{originalRemaining} - \text{newAmount}$$
- **`OFFER_INSTALMENTS`**:
  - Requires integer `count` $\ge 2$ and `spacingDays` $\ge 1$.
  - The remaining balance is split into `count` instalments:
    $$\text{basePart} = \lfloor \text{originalAmount} / \text{count} \rfloor, \quad \text{remainder} = \text{originalAmount} \bmod \text{count}$$
  - **Remainder Allocation**: All remainder cents are allocated to the **first part** ($k = 0$).
  - Part dates follow $\text{firstDate} + k \times \text{spacingDays}$ for $k = 0 \dots \text{count}-1$.
  - All parts have confidence `'expected'`.
  - Parts sum **exactly** to the original amount, with $\text{cashCost} = 0$.
- **`PURCHASE`**:
  - Adds an outflow obligation with `kind: 'other'`, a deterministic ID (`sim-purchase-1`), and positive integer `amount`.
  - $\text{cashCost} = 0$.

### 4.3 Missing Receipts & Aggregation
- If a receipt-altering change (`REMIND`, `OFFER_DISCOUNT`, `OFFER_INSTALMENTS`) targets an `invoiceId` not found in `input.receipts`, `simulate` throws an `EngineError` with code `NOT_FOUND`.
- If an invoice has multiple receipts in `input.receipts`, they are aggregated into a single combined receipt for the simulation, and this is noted in `assumptions`.

### 4.4 Metrics & Explanations
- **Deltas**:
  $$\text{lowestDelta} = \text{scenario.lowest.amount} - \text{baseline.lowest.amount}$$
  $$\text{shortfallDelta} = \text{scenario.shortfall} - \text{baseline.shortfall}$$
  $$\text{closesGap} = (\text{baseline.firstBreachDate} \ne \text{null}) \land (\text{scenario.firstBreachDate} = \text{null})$$
- **Assumptions**: Deterministic plain-language sentences formatted with integer-math currency (e.g. `"$1,939.99"`), always referencing the prior confidence and date.

---

## 5. Intervention Options Generation (`generateOptions`)

### 5.1 Eligibility
- Returns an empty list (`[]`) if the invoice status is not `SENT` or `PARTIALLY_PAID`, or if $\text{remaining} \le 0$.
- Returns `[]` for `ghost` payers because ghost behavior requires out-of-band human escalation.

### 5.2 Option Synthesis
1. **`REMIND`**: Always generated for non-ghost open invoices. Date offset depends on persona:
   - `reliable`: $\text{asOf} + 2$
   - `slow`: $\text{asOf} + 7$
   - `chronic`: $\text{asOf} + 14$
2. **`OFFER_DISCOUNT`**: Evaluated at standard tiers `[2, 3, 5]`:
   - Kept only if $\text{tier} \le \text{policy.maxDiscountPct}$.
   - Sets $\text{newExpectedDate} = \text{asOf} + 3$.
   - Eligible for `reliable`, `slow`, and `chronic` personas.
3. **`OFFER_INSTALMENTS`**:
   - Generated for counts $2 \dots \text{policy.maxInstalments}$ with $\text{firstDate} = \text{asOf} + 3$ and $\text{spacingDays} = 7$.
   - Eligible for `slow` and `chronic` personas only (not offered to `reliable`).

### 5.3 Deterministic Ordering
Options are strictly ordered:
1. `REMIND`
2. `OFFER_DISCOUNT` (in ascending order of discount percentage)
3. `OFFER_INSTALMENTS` (in ascending order of instalment count)

---

## 6. Key Performance Indicators (`kpis`)

### 6.1 Cash & Working Capital
- **`cash`**: Current starting balance as of the snapshot date:
  $$\text{cash} = \text{business.startingBalance}$$

### 6.2 Overdue Portfolio Metrics
- **Overdue Invoices**: An invoice is overdue if and only if it is open (`status === 'SENT' || status === 'PARTIALLY_PAID'`) and its dueDate strictly precedes `asOf` (`dueDate < asOf`).
- **`overdueTotal`**: Sum of remaining receivable amounts across all overdue invoices:
  $$\text{remaining} = \max(0, \text{applyDiscount}(\text{amount}, \text{discountPct}) - \text{amountPaid})$$
  $$\text{overdueTotal} = \sum_{\text{overdue}} \text{remaining}$$
- **`overdueCount`**: Number of overdue open invoices.
- **`avgDaysLate`**: Mean overdue days across all overdue invoices, rounded half-up via integer arithmetic:
  $$\text{daysLate} = \text{asOf} - \text{dueDate in days}$$
  $$\text{avgDaysLate} = \begin{cases} \text{roundHalfUpDiv}\left(\sum \text{daysLate}, \text{overdueCount}\right) & \text{if } \text{overdueCount} > 0 \\ 0 & \text{if } \text{overdueCount} = 0 \end{cases}$$
  Guaranteed to never produce `NaN` or `Infinity`.

### 6.3 Liquidity Outlook
- **`lowest` & `shortfall`**: Evaluated directly by executing `forecast` over a standard 30-day horizon (`horizonDays: 30`, `includeUncertain: false`) using receipts generated by `expectedReceipts(invoices, payers, asOf)`.

### 6.4 Next Upcoming Obligation (`nextObligation`)
- The obligation with the earliest calendar date $\ge \text{asOf}$ (`dueDate >= asOf`).
- If multiple obligations share the earliest date, ties are broken deterministically by selecting the smallest `id` lexicographically.
- If no future obligations exist within or beyond the horizon, `nextObligation` is omitted (`undefined`).
