# Settle Web (System 4)

Web application frontend for Settle (React 18 + Vite + TypeScript strict).

## Contract Notes
- Domain types are imported from `@settle/shared` via workspace reference and TypeScript path alias.
- TODO: Remove the path/Vite alias pointing to `packages/shared/src/index.ts` once `@settle/shared` package distribution lands cleanly in CI without local source resolution.

## Environment Variables
- `VITE_API_BASE`: Empty or unset runs MSW with in-memory state. Set to a base URL (e.g. `http://localhost:3000`) to call a live API and SSE at `${VITE_API_BASE}/api/events`.
- `VITE_MOCK_LATENCY_MS`: Simulated latency in milliseconds for MSW handlers (default: 250).

## Scripts
- `pnpm --filter web dev`: Start Vite development server
- `pnpm --filter web typecheck`: Typecheck via `tsc --noEmit`
- `pnpm --filter web test`: Run Vitest tests
- `pnpm --filter web build`: Build production assets into `dist/`

