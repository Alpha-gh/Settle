# Contract Change Requests (System 3 / Agent)

This document tracks requests for enhancements and additions to `@settle/shared` contracts (`types.ts` and `ports.ts`) identified during the development of System 3 (`@settle/agent`).

---

## 1. ActionRecord Metadata for AI Attribution

- **What**:
  Add an optional `meta` property to `ActionRecord` in `types.ts`:
  ```ts
  export interface ActionRecord {
    // ... existing fields ...
    meta?: {
      provider: string;
      model: string;
      path: 'llm' | 'fallback';
    };
  }
  ```
- **Why**:
  Full provenance and auditability require knowing which LLM provider, model, and decision path (AI generation vs deterministic fallback) produced the proposed action. Currently, the agent must append a provenance string directly to `reason` (`" [via provider=<p>; model=<m>; path=llm|fallback]"`), which couples audit metadata with the user-facing explanation.
- **Impact**:
  Non-breaking additive change to `ActionRecord`. Dashboards and audit views can query or filter actions by AI provider, model version, and fallback rate directly without regex-parsing the `reason` string.

---

## 2. Reminders History Source in Snapshot

- **What**:
  Include a `remindersLastWeek` lookup source in `Snapshot` (e.g. `remindersPerInvoice?: Record<Id, number>`) or expose an API/query interface on `Snapshot`:
  ```ts
  export interface Snapshot {
    // ... existing fields ...
    reminderCounts?: Record<Id, number>;
  }
  ```
- **Why**:
  `evaluatePolicy` requires `ctx: { now: Date; remindersLastWeek: number }` to enforce weekly reminder limits (`policy.maxRemindersPerInvoicePerWeek`). However, `Snapshot` currently contains only static business, payers, invoices, obligations, and policy objects, without any historical reminder activity or audit log timestamps. The agent currently has to accept an external `remindersLookup` function that defaults to `() => 0`.
- **Impact**:
  Non-breaking additive change to `Snapshot`. Eliminates out-of-band state dependencies and ensures policy evaluation is 100% deterministic and self-contained from the snapshot alone.

---

## 3. EnginePort.applyChange Method

- **What**:
  Add `applyChange` to `EnginePort` in `ports.ts`:
  ```ts
  export interface EnginePort {
    // ... existing 5 methods ...
    applyChange(input: ForecastInput, change: ScenarioChange): ForecastInput;
  }
  ```
- **Why**:
  When the agent processes multiple overdue invoices in a single cycle, selecting an action for invoice $A$ changes the expected cash receipts and closes/narrows the forecast gap. Later invoices must see the updated ("folded") forecast so they don't over-mitigate or offer unnecessary discounts when the cashflow gap is already closed. Because `EnginePort` currently lacks an `applyChange` method, `@settle/agent` must temporarily implement an integer-cents fallback in `src/foldChange.ts` (marked as DEVIATION).
- **Impact**:
  System 2 (`@settle/engine`) can implement pure financial projection for scenario folding according to its internal schedule logic. `@settle/agent` has already implemented an `EngineWithApply` interface check so it will automatically delegate to System 2's implementation once available.

