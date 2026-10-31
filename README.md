# Settle

Settle helps small businesses manage cash-flow by forecasting balances, chasing overdue invoices, and automating collection actions.

## Quick Start

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm seed
```

## Structure

| Path | Owner | Description |
|------|-------|-------------|
| `packages/shared` | all | Types, ports, policy logic |
| `packages/engine` | engine team | Forecast engine |
| `packages/agent` | agent team | AI agent |
| `apps/api` | api team | Fastify API server |
| `apps/web` | web team | Frontend |

## License

MIT
