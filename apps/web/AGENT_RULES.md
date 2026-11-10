# Settle Web (System 4) — Agent Rules

Every subsequent development stage must start by reading this file.

1. **Sandbox only.**
   Show a permanent badge "Sandbox - no real funds". No live credentials anywhere.

2. **All numbers shown come from the API.**
   No business arithmetic. The only allowed derivations live in `src/lib/derive.ts` (currently: `daysOverdue` = whole days between `invoice.dueDate` and `business.asOf`, clamped at 0). Each is unit tested and listed in `HANDOFF.md`.

3. **Money is integer cents; dates are ISO YYYY-MM-DD.**
   Never use floating point for money. `formatUsd(cents)` must use integer maths only (`sign`, `Math.trunc(abs/100)`, `abs%100`) plus `Intl` for grouping. Dates are parsed and formatted in UTC so there is no off-by-one.

4. **Never show "sent", "paid", "executed" or similar unless the API status says so.**
   Chips and pills render `invoice.status` / `action.status` verbatim (humanised), never inferred.

5. **TypeScript strict, no `any`, no `as` casts on API data.**
   Every API response is parsed by a zod schema. In development a parse failure throws and renders a visible full-width error overlay naming the endpoint and zod issues. In production it logs and shows the normal error state with retry.

6. **Every interactive element has a data-testid.**
   Kebab-case, taken from `src/testids.ts` (the single source of truth shared with Playwright).

7. **One env var switches mock/real: `VITE_API_BASE`.**
   - Unset or empty: start MSW and the in-memory mock event bus.
   - Set: call that base URL and use EventSource at `${VITE_API_BASE}/api/events`.
   - Optional: `VITE_MOCK_LATENCY_MS` (default 250).
   - No code changes needed to switch.

8. **Design: calm, credible finance product.**
   - Light theme, generous whitespace, restrained palette.
   - ONE accent colour (`#1D4ED8`), used only for the primary action and the scenario series.
   - Status colours only for meaning: green = paid / closes gap, amber = awaiting approval, red = breach / blocked / failed.
   - No emojis, no gradients, no decorative shadows.
   - Tabular numbers for all money (`.tabular`).
   - Visible focus rings.
   - Contrast >= 4.5:1.
   - Skeleton loaders, empty states and error-with-retry for every query.

9. **Anything the contract lacks goes behind an adapter in `src/api/`**
   Recorded in `CONTRACT_CHANGE_REQUEST.md` (what, why, impact). Keep working behind the adapter.

10. **After each stage run:**
    `pnpm --filter web typecheck`, `pnpm --filter web test`, `pnpm --filter web build`, and report results.

