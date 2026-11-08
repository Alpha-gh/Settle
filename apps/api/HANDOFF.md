# Settle API — System 1 (Core) Technical Handoff

This document provides the definitive technical specification and operational handoff for **`@settle/api`** (System 1: Core), covering environment configurations, PayPal sandbox findings, adapter implementations, API endpoints, and contracts for downstream teams (`@settle/engine`, `@settle/agent`, and `apps/web`).

---

## 1. Environment Variables & Defaults

All environment variables are validated at startup via `validateEnv()` in `src/config/env.ts`. Any missing required fields or formatting errors output a formatted diagnostic block and prevent server startup.

| Variable | Required | Default | Description & Constraints |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | **Yes** | `postgresql://postgres:postgres@localhost:5433/settle` | Connection URL for PostgreSQL. Automatically detects `sslmode=require`, Render, Neon, and Supabase. |
| `TEST_DATABASE_URL`| No | Derived (`.../settle_test`) | Dedicated database URL for Vitest test runs to guarantee tests never wipe development data. |
| `PORT` | No | `3000` | HTTP port. Automatically provided by Render or container runners. |
| `HOST` | No | `0.0.0.0` | Bind host address. |
| `NODE_ENV` | No | `development` | `production`, `development`, or `test`. In `production`, internal 500 error stack traces are masked. |
| `WEB_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origin for web frontend. In `development`, all `localhost:*` origins are allowed. |
| `PAYPAL_CLIENT_ID` | Sandbox | - | PayPal REST API OAuth client ID. |
| `PAYPAL_CLIENT_SECRET` | Sandbox | - | PayPal REST API OAuth client secret. |
| `PAYPAL_BASE_URL` | No | `https://api-m.sandbox.paypal.com` | PayPal endpoint. **Security Guardrail:** Server refuses to start if pointed to live PayPal (`api-m.paypal.com`) unless `NODE_ENV=test`. |
| `PAYPAL_WEBHOOK_ID`| No | - | Webhook ID registered in PayPal Developer Portal for signature verification. |
| `WEBHOOK_VERIFY` | No | `true` | When `true`, validates cryptographic certificates and transmission signatures on incoming webhooks. |
| `PAYPAL_NUMBER_SUFFIX` | No | `true` | Appends a unique 4-character suffix (`INV-1001-XXXX`) to PayPal invoices to prevent 422 duplicate conflicts. |
| `DEMO_TODAY` | No | `2026-11-05` | Simulation anchor date for Maya Studio demo dataset. |
| `PAYPAL_BUYER_EMAIL` | No | `sb-9rzca53715246@personal.example.com` | Personal buyer sandbox account email for demo checkout. |
| `PAYPAL_BUYER_PASSWORD` | No | `H/<Om0q#` | Personal buyer sandbox account password. |
| `ENGINE_IMPL` | No | `real` | Forecast engine backend: `real` (default) or `stub`. |
| `AGENT_IMPL` | No | `stub` | AI agent backend: `stub` or `real`. |
| `GEMINI_API_KEY` | No | - | Google Gemini API key for generative recovery reasoning. |
| `OPENAI_API_KEY` | No | - | OpenAI API key (alternative LLM backend). |

---

## 2. Command Reference

All commands must be executed from the monorepo root or with `--filter @settle/api`:

```bash
# Install dependencies across all packages
pnpm install

# Build all monorepo packages (shared, engine, agent, api)
pnpm build

# Run TypeScript typechecks across the entire repository
pnpm typecheck
pnpm -r typecheck

# Run linter
pnpm lint

# Run all test suites in apps/api (64 tests: paypal, routes, stage4, hardening)
pnpm --filter @settle/api test

# Run database migrations and seed baseline scenario from seed/demo.json
pnpm seed

# Start API server in watch mode with hot reload
pnpm --filter @settle/api dev

# Start production API server
pnpm start

# Run end-to-end smoke test suite against local or deployed instance
bash docs/smoke.sh http://localhost:3000
bash docs/smoke.sh https://settle-api.onrender.com
```

---

## 3. Endpoints & Contract v1 Specification

All error responses strictly follow the shape:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": []
  }
}
```

### Static & System Endpoints
- **`GET /`**: Serves the single-page application from `apps/web/dist` if built; otherwise renders a styled status landing page with navigation links to `/health` and `/api/dashboard`. Never returns a bare 404.
- **`GET /health`**: Connectivity check. Executes `SELECT 1` against PostgreSQL. Returns `200 { "status": "ok", "database": "connected" }` or `503 { "status": "error", "database": "disconnected" }`.

### Core Business Endpoints
- **`GET /api/dashboard`**: Full dashboard state strictly conforming to Contract v1.
  - *Response*: `{ "business": Business, "kpis": KPIs, "forecast": CashForecast, "invoices": Invoice[], "payers": Payer[], "obligations": Obligation[] }`
- **`GET /api/invoices`**: Returns all 14 invoices in Maya Studio scenario.
  - *Response*: `Invoice[]`
- **`GET /api/actions`**: Lists proposed and executed recovery actions.
  - *Response*: `ActionRecord[]`
- **`POST /api/actions/:id/approve`**: Human-in-the-loop approval. Executes action against PayPal API.
  - *Body*: `{ "note"?: string }`
  - *Response*: `ActionRecord` (status: `"executed"`)
- **`POST /api/actions/:id/reject`**: Rejects proposed action.
  - *Body*: `{ "note"?: string }`
  - *Response*: `ActionRecord` (status: `"rejected"`)
- **`POST /api/simulate`**: What-if scenario modeling.
  - *Body*: `{ "change": ScenarioChange }` (`REMIND`, `PAY_EARLY`, `SPLIT`, `EXTEND_OBLIGATION`)
  - *Response*: `{ "change": ScenarioChange, "baseline": CashForecast, "projected": CashForecast, "deltaShortfall": number }`
- **`POST /api/chat`**: Natural language Q&A regarding cashflow, risk, and recovery recommendations.
  - *Body*: `{ "question": string }`
  - *Response*: `{ "text": string, "toolCalls"?: any[], "forecast"?: CashForecast }`
- **`GET /api/audit`**: Append-only audit log (read-only; no update/delete paths exist).
  - *Response*: `AuditEvent[]`
- **`GET /api/policy`**: Retrieve active collections policy.
  - *Response*: `Policy`
- **`PUT /api/policy`**: Update policy parameters (max discount, instalments, quiet hours).
  - *Body*: `Policy`
  - *Response*: `Policy`

### Demo & PayPal Endpoints
- **`POST /api/demo/reset`**: Idempotent reset. Archives PayPal mappings, truncates transactional tables, and restores Maya Studio baseline seed data.
- **`POST /api/demo/provision-paypal`**: Provisions demo candidate invoices in PayPal Sandbox and returns live payment URLs (`payUrl`).
- **`POST /api/demo/simulate-payment`**: Simulates payment receipt (for instant demo evaluation without waiting for webhooks).
  - *Body*: `{ "invoiceId": string, "amountCents"?: number }`
  - *Response*: `{ "status": "ok", "invoice": Invoice, "cashBalance": number }`
- **`POST /api/webhooks/paypal`**: Webhook listener for PayPal events (`INVOICING.INVOICE.PAID`, `REFUNDED`). Reconciles cash balance atomically.

---

## 4. Empirical PayPal Sandbox Spike Findings

During System 1 implementation and live PayPal Sandbox testing, the following empirical behaviors and constraints were verified:

1. **Invoicing Round Trip Works**:
   - OAuth 2.0 client-credentials authentication with in-memory caching and 60-second early refresh functions cleanly.
   - Creating draft invoices and sending them via `/v2/invoicing/invoices/{id}/send` generates buyer-facing checkout URLs (`payUrl`).
   - Updating `SENT` invoices with early payment discounts (`discount.percent`) and extended due dates succeeds.
   - Reminder emails via `/v2/invoicing/invoices/{id}/remind` succeed on `SENT` invoices.
2. **Unique Invoice Number Suffix Requirement**:
   - The PayPal sandbox account retains invoice numbers permanently. Resetting local database tables and attempting to re-create `INV-1001` resulted in HTTP `422 UNPROCESSABLE_ENTITY` (`DUPLICATE_INVOICE_NUMBER`).
   - *Resolution*: Settle generates a 4-character random suffix for sandbox numbers (`INV-1001-K7Q2`) while preserving Settle's internal number (`INV-1001`). Mappings are tracked in `invoice_paypal_ids`.
3. **No Partial Payments in Account**:
   - In the configured PayPal Sandbox merchant account, partial payments (`allow_partial: true`) are rejected by business validation rules.
   - *Design Decision*: Instalment plans must be modeled as discrete split child invoices rather than partial payments on a single invoice.
4. **India Account Sandbox Restrictions**:
   - PayPal merchant accounts registered in India are subject to RBI export/import regulations and do not support domestic INR-to-INR invoicing without complex merchant validation. All Maya Studio demo invoices are billed in **USD** (`"currency": "USD"`).
5. **Webhook Asynchronous Latency**:
   - When a buyer pays an invoice in the PayPal Sandbox web UI, the webhook dispatch latency varies between **15 and 90 seconds**.
   - *Demo Reliability*: `POST /api/demo/simulate-payment` was implemented to execute the exact same reconciliation code path synchronously for live presentations.

---

## 5. Adapter Architecture: Stub vs. Real

The API decouples the engine and agent through modular adapters in `apps/api/src/adapters/`:

### Engine Adapter (`src/adapters/engine.ts`)
- Controlled by `ENGINE_IMPL` (`real` | `stub`).
- `real` (default): Dynamically executes `await import('@settle/engine')` and instantiates the real pure Cash Engine via `createEngine()`.
- `stub`: Uses `StubEngine` from `src/adapters/stubs.ts` as a fallback or for isolated test runs.
- If `@settle/engine` fails to load under `ENGINE_IMPL=real`, throws a clear runtime error:
  `"Failed to load real @settle/engine (ENGINE_IMPL=real): ... Ensure packages/engine is built and installed."`

### Agent Adapter (`src/adapters/agent.ts`)
- Controlled by `AGENT_IMPL` (`stub` | `real`).
- `stub` (default): Uses `StubAgent` from `src/adapters/stubs.ts`. Generates high-confidence recovery actions for overdue invoices respecting policy limits, and provides contextual chat answers.
- `real`: Dynamically executes `await import('@settle/agent')`. If missing, throws a clear runtime error:
  `"Failed to load @settle/agent. Ensure packages/agent is built or set AGENT_IMPL=stub."`

---

## 6. Financial Contract & Downstream Expectations

### Financial State Invariant
- **`Business.startingBalance` is current liquid cash on hand.**
- Whenever an invoice payment is reconciled (via webhook or simulation), the API computes `delta = currentAmountPaid - previousAmountPaid`.
- In the **same database transaction** as the invoice status update:
  ```sql
  UPDATE businesses SET starting_balance = starting_balance + :delta;
  ```
- Replays of webhooks produce `delta = 0` and are strictly idempotent.

### Expectations for Other Teams

#### For the Engine Team (`@settle/engine`)
1. Treat `business.startingBalance` as the cash balance at day 0 (`business.asOf`).
2. Do not re-add already-received cash (`invoices.amountPaid`) into future receipt projections.
3. Compute expected receipts strictly from outstanding unpaid balances (`amount - amountPaid`) weighted by payer payment probabilities.

#### For the Agent Team (`@settle/agent`)
1. Propose actions matching the `ActionRecord` type in `@settle/shared`.
2. Always check policies via `evaluatePolicy(policy, proposedAction)` before recommending automated execution.
3. Respect quiet hours and maximum discount percentages configured in `Policy`.

#### For the Web Team (`apps/web`)
1. Consume `GET /api/dashboard` as the single source of truth for dashboard state.
2. Build output into `apps/web/dist`. The API will automatically host it with SPA routing fallback.
3. All dates are ISO 8601 strings (`YYYY-MM-DD`). All currency values are integer cents (`100 cents = $1.00`).

---

## 7. Known Gaps & Recommendations

1. **Real LLM Agent Integration**: When `@settle/agent` is implemented, connect `GEMINI_API_KEY` or `OPENAI_API_KEY` to provide dynamic, tone-adapted reminder letter generation for chronic late payers.
2. **Server-Sent Events (SSE)**: The API includes an in-memory event bus (`src/events/bus.ts`). Downstream teams can expose a `GET /api/events` SSE stream to trigger automatic browser dashboard refreshes when PayPal webhooks arrive.
3. **Multi-Tenant Scoping**: The current schema is pre-scoped with foreign keys for `businessId` and `payerId`, but Maya Studio (`biz_001`) is currently the single tenant. Adding session authentication (e.g. Auth0) will allow multi-business operation.

