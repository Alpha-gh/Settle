# Contract Change Request (CCR) — System 4 (Web)

Proposal from System 4 to System Leads (System 1 API, System 2 Engine, System 3 Agent).

---

## CCR-001: Standard REST Surface for System 4 Web App

### What
Formalize the REST surface used by System 4 frontend:
- `GET /api/snapshot -> Snapshot`
- `GET /api/forecast -> ForecastResult`
- `GET /api/kpis -> Kpis`
- `GET /api/actions -> ActionRecord[]`
- `POST /api/agent/run -> AgentRunResult`
- `POST /api/actions/:id/approve -> ActionRecord`
- `POST /api/actions/:id/reject -> ActionRecord`
- `POST /api/actions/:id/retry -> ActionRecord`
- `GET /api/audit -> AuditEvent[]`
- `GET /api/policy -> Policy ; PUT /api/policy -> Policy`
- `POST /api/chat {question} -> ChatAnswer`
- `GET /api/events -> SseEvent stream`
- `POST /api/demo/reset -> { status: string }`
- `POST /api/demo/simulate-payment/:invoiceId -> { status: string; invoice: Invoice }`

### Why
System 1 previously exposed composite `GET /api/dashboard` and varied endpoints. Decomposing queries into discrete resources allows granular TanStack Query caching, targeted optimistic updates, and SSE reconciliation without reloading entire dashboard snapshots.

### Impact
Low/Additive: System 1 can continue offering `/api/dashboard` while serving dedicated resource routes. In System 4, all routes live behind `src/api/endpoints.ts`.

---

## CCR-002: Addition of `ImpactSummary` and `GET /api/impact`

### What
Add a typed `ImpactSummary` interface to `@settle/shared`:
```typescript
export interface ImpactSummary {
  cashRecovered: Cents;
  projectedShortfallClosed: Cents;
  actionsCount: number;
  actionsExecuted: number;
  gapClosed: boolean;
}
```
Expose `GET /api/impact -> ImpactSummary`.

### Why
System 4 needs to display aggregated recovery impact (e.g. how much cash the agent has saved or unlocked and whether the reserve breach gap has closed). Currently, this is not part of `@settle/shared`.

### Impact & Temporary Adapter
Until lands in `@settle/shared` and System 1 API, System 4 isolates this in `src/api/impactAdapter.ts`. If `/api/impact` returns 404, the client-side adapter computes plain summations of engine-provided cents from `actions` and `forecast` without performing any business arithmetic.

---

## CCR-003: Action Retry (`POST /api/actions/:id/retry`)

### What
Provide a dedicated endpoint to retry actions that entered status `FAILED` (e.g. PayPal sandbox connection timeout or transient network disruption).

### Why
When an action fails, human operators need a one-click mechanism to re-trigger execution rather than re-running the entire agent cycle.

### Impact
System 1 needs to transition status from `FAILED` back to `APPROVED` / `EXECUTED` upon retry. System 4 handles this with optimistic UI.

---

## CCR-004: Standardize SSE Event Names

### What
Standardize SSE event types to match `SseEvent` in `@settle/shared`:
- `invoice.updated` with `{ type: 'invoice.updated', payload: Invoice }`
- `action.updated` with `{ type: 'action.updated', payload: ActionRecord }`
- `audit.appended` with `{ type: 'audit.appended', payload: AuditEvent }`
- `forecast.updated` with `{ type: 'forecast.updated', payload: ForecastResult }`

### Why
Consistent discriminated union types ensure compile-time and runtime safety across browser SSE listeners and server publishers.

### Impact
System 1 event bus publishers align event names with `@settle/shared`. System 4 validates each inbound event against `sseEventSchema`.

