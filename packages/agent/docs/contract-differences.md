# Contract Differences: `contract-v1.md` vs `packages/shared/src`

This document records the differences between the informal reference copy in `packages/agent/docs/contract-v1.md` and the authoritative implementation in `packages/shared/src`.

## Summary
The actual implementations in `packages/shared/src` (`types.ts`, `ports.ts`, `policy.ts`, and `seed-fixture.ts`) align closely with the intended contract, with a few syntax/formatting corruptions in `contract-v1.md` due to lost line breaks, plus an extra utility export in `packages/shared`.

---

### 1. Typo in `ports.ts` (`LlmPort.runWithTools`)
- **`contract-v1.md`**:
  ```ts
  tools: { name: string; description: strin; jsonSchema: object; run(args: any): Promise<unknown> }[]
  ```
  Notice the typo `strin`.
- **`packages/shared/src/ports.ts`**:
  ```ts
  tools: { name: string; description: string; jsonSchema: object; run(args: any): Promise<unknown> }[]
  ```
  `description` is properly typed as `string`.

---

### 2. Corrupted Comments / Lost Line Breaks in `ScenarioComparison`
- **`contract-v1.md`**:
  Because line breaks were stripped in the markdown document, inline comments merged into the type definition body:
  ```ts
  lowestDelta: Cents; shortfallDelta: Cents; cashCost: Cents; payment closesGap: boolean; baseline.firstBreachDate !== null assumptions: string[]; dates }
  ```
- **`packages/shared/src/types.ts`**:
  Correct syntax with proper comments:
  ```ts
  export interface ScenarioComparison {
    change: ScenarioChange;
    baseline: ForecastResult;
    scenario: ForecastResult;
    lowestDelta: Cents;
    shortfallDelta: Cents;
    cashCost: Cents;                // money given up (discount) vs full payment
    closesGap: boolean;             // scenario.firstBreachDate === null && baseline.firstBreachDate !== null
    assumptions: string[];          // plain-language assumptions behind the dates
  }
  ```

---

### 3. Additional Exports in `packages/shared`
- **`contract-v1.md`**:
  Mentions `types.ts`, `ports.ts`, `policy.ts`, and fixtures.
- **`packages/shared/src`**:
  - Exports `loadSeedSnapshot` from `packages/shared/src/seed-fixture.ts` via `packages/shared/src/index.ts`.
  - Exposes subpath export `./fixture` (`dist/seed-fixture.js`) in `package.json`.

---

### 4. Package Name & Import Path
- **Package Name**: `@settle/shared` (confirmed in `packages/shared/package.json`).
- All types, interfaces (`EnginePort`, `LlmPort`, `AgentPort`, `PayPalPort`), and `evaluatePolicy` are exported directly from `@settle/shared`.

