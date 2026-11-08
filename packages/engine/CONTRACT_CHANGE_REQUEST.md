# Contract Change Request: System 2 (Cash Engine) Evaluation

## Status: NO BLOCKING CHANGES REQUIRED

Contract v1 (`packages/shared/src/types.ts` and `packages/shared/src/ports.ts`) is **100% sufficient** for all System 2 requirements. System 2 is fully implemented and passes all 188 unit, property, and edge tests without modifying `@settle/shared`.

---

## Non-Breaking Considerations for Future Contract Revisions (v2 Proposal)

While Contract v1 works without modifications, the following non-breaking enhancements are documented for future architecture reviews:

### 1. Compound Scenario Changes in `simulate`
- **Current Contract v1**:
  ```typescript
  export type ScenarioChange =
    | { type: 'REMIND'; invoiceId: Id; newExpectedDate: ISODate }
    | { type: 'OFFER_DISCOUNT'; invoiceId: Id; discountPct: number; newExpectedDate: ISODate }
    | { type: 'OFFER_INSTALMENTS'; invoiceId: Id; count: number; spacingDays: number; firstDate: ISODate }
    | { type: 'PURCHASE'; label: string; amount: Cents; date: ISODate };
  ```
- **Observation**:
  In realistic AR management, the AI Agent may want to propose an action plan consisting of multiple changes simultaneously (e.g. remind Payer A AND offer discount to Payer B). Currently, System 1 must simulate these sequentially or roll them into custom forecast inputs.
- **Proposed v2 Addition**:
  ```typescript
  | { type: 'BATCH'; changes: ScenarioChange[] }
  ```

### 2. Optional `minInstalmentAmount` in `Policy`
- **Current Contract v1**:
  ```typescript
  export interface Policy {
    maxDiscountPct: number;
    maxInstalments: number;
    autoApproveMaxAmount: Cents;
    requireApprovalFor: ('OFFER_DISCOUNT' | 'OFFER_INSTALMENTS' | 'ESCALATE')[];
    quietHours: { startHour: number; endHour: number };
    maxRemindersPerInvoicePerWeek: number;
  }
  ```
- **Observation**:
  `generateOptions` can generate instalment splits down to very small amounts if not bounded by a floor. Adding an optional `minInstalmentAmount?: Cents` to `Policy` would allow businesses to avoid splitting invoices into negligible micro-instalments.

---

## Conclusion
System 2 ("Cash Engine") is completely operational, hardened, and locked to frozen Contract v1. No immediate changes to `packages/shared` are requested.

