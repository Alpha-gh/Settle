# Settle Web — API Specification

This document specifies the REST surface consumed by System 4 (`apps/web`).
URL paths are centralized exclusively in `src/api/endpoints.ts`.

## Endpoint Matrix

| Method | Endpoint | Request Body | Response Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/snapshot` | None | `Snapshot` | Returns full business snapshot (business, payers, invoices, obligations, policy) |
| `GET` | `/api/forecast` | None | `ForecastResult` | Returns 30-day cash forecast (daily balance, lowest point, shortfall, first breach) |
| `GET` | `/api/kpis` | None | `Kpis` | Returns dashboard KPIs (cash, overdue total/count, avg days late, shortfall, next obligation) |
| `GET` | `/api/actions` | None | `ActionRecord[]` | Lists all proposed, awaiting approval, and executed recovery actions |
| `POST` | `/api/agent/run` | None | `AgentRunResult` | Triggers agent evaluation cycle and returns generated actions & skipped invoices |
| `POST` | `/api/actions/:id/approve` | Optional `{ note?: string }` | `ActionRecord` | Approves action awaiting human-in-the-loop review |
| `POST` | `/api/actions/:id/reject` | Optional `{ note?: string }` | `ActionRecord` | Rejects action awaiting approval |
| `POST` | `/api/actions/:id/retry` | None | `ActionRecord` | Retries a previously FAILED action |
| `GET` | `/api/audit` | None | `AuditEvent[]` | Returns append-only audit trail |
| `GET` | `/api/policy` | None | `Policy` | Retrieves active collections policy |
| `PUT` | `/api/policy` | `Policy` | `Policy` | Updates active collections policy |
| `POST` | `/api/chat` | `{ question: string }` | `ChatAnswer` | Natural language cashflow Copilot query with toolCalls and scenario comparison |
| `GET` | `/api/events` | None | `text/event-stream` (`SseEvent`) | Server-Sent Events stream for real-time updates |
| `GET` | `/api/impact` | None | `ImpactSummary` | Recovery impact metrics (cash recovered, shortfall closed, actions executed) |
| `POST` | `/api/demo/reset` | None | `{ status: string }` | Resets all demo scenario data to initial baseline state |
| `POST` | `/api/demo/simulate-payment/:invoiceId` | None | `{ status: string; invoice: Invoice; cashBalance?: number }` | Simulates immediate full payment of the specified invoice |

## Real-Time Events (SSE)

The `GET /api/events` stream emits JSON-encoded payloads adhering to the `SseEvent` schema:

- `invoice.updated` -> `{ type: 'invoice.updated', payload: Invoice }`
- `action.updated` -> `{ type: 'action.updated', payload: ActionRecord }`
- `audit.appended` -> `{ type: 'audit.appended', payload: AuditEvent }`
- `forecast.updated` -> `{ type: 'forecast.updated', payload: ForecastResult }`

## Error Contract

All error responses return standard JSON envelopes:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable description",
    "details": []
  }
}
```

