# @settle/engine (System 2: Cash Engine)

System 2 "Cash Engine" of Settle (PayPal AI Hackathon): pure TypeScript AR and cash flow modeling engine for small businesses.

## Guarantees
- **Pure TypeScript**: No network, no file I/O, no wall-clock time (`Date.now()`, `new Date()`), no `process.env`, no randomness.
- **Determinism**: Same input strictly produces byte-identical output.
- **Integer Cents**: All monetary values are integer cents in USD. No floating-point money.
- **Dates**: Strictly validated ISO-8601 calendar strings (`YYYY-MM-DD`).

## Contract Source
This package directly links to `@settle/shared` (`workspace:*`) as frozen Contract v1.

## Scripts
```bash
# Run test suite
pnpm --filter engine test

# Run tests in watch mode
pnpm --filter engine test:watch

# Typecheck with TypeScript strict mode
pnpm --filter engine typecheck

# Run test coverage (v8, 90%+ threshold)
pnpm --filter engine coverage
```

