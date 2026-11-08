# Settle

**Settle** is an autonomous cashflow recovery platform designed for small businesses. It projects day-by-day cashflow balances, detects impending cash reserve breaches, and orchestrates intelligent, policy-governed invoice recovery actions using the PayPal Invoicing API and generative AI.

---

## Architecture Overview

```mermaid
graph TD
  User([User / Browser]) <--> Web[apps/web React SPA]
  Web <--> API[apps/api Fastify Core]
  
  subgraph Monorepo Core
    API --> Shared[@settle/shared Types, Ports & Policies]
    API --> DB[(PostgreSQL + Drizzle ORM)]
    API --> Engine[@settle/engine Forecast Engine]
    API --> Agent[@settle/agent AI Recovery Agent]
  end

  subgraph External Integrations
    API <--> PayPal[PayPal Invoicing API v2]
    PayPal --> Webhook[PayPal Webhooks Listener]
    Webhook --> API
    Agent <--> LLM[Gemini / OpenAI API]
  end
```

### Package Structure

| Path | Name | Description |
|------|------|-------------|
| `packages/shared` | `@settle/shared` | Source of truth: Contract v1 types, ports (`PayPalPort`), baseline policy engine, and demo seed data. |
| `packages/engine` | `@settle/engine` | Day-by-day 30-day cash forecast model, receipt predictions, KPI computations, and scenario simulations. |
| `packages/agent` | `@settle/agent` | Autonomous collections agent with policy guardrails, action ranking, and natural language explanation. |
| `apps/api` | `@settle/api` | Fastify backend server with Drizzle ORM, PayPal client, webhook receiver, rate limiting, and REST API. |
| `apps/web` | `@settle/web` | Modern frontend dashboard for cashflow tracking and action approvals. |

---

## How PayPal and AI Are Used

### 1. PayPal Invoicing API v2
Settle delivers a production-grade implementation of `PayPalPort`:
- **Live Invoicing Round Trip:** Creates, provisions, and sends draft invoices to generate buyer payment links (`payUrl`).
- **Reminders & Early-Payment Discounts:** Programmatically sends payment reminder emails and dynamically updates invoices with discount percentages (e.g. 5% prompt payment incentive).
- **Collision-Safe Demo Resets:** Settle automatically appends short random identifiers to sandbox invoice numbers (e.g. `INV-1001-K7Q2`), allowing the demo environment to be reset and re-provisioned indefinitely without sandbox 422 conflicts.
- **Robust Webhook Reconciliation:** Captures `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.REFUNDED`, and payment events. Reconciles amount paid directly into the business's starting cash balance inside an atomic PostgreSQL transaction with deduplication to prevent double-counting.

### 2. Autonomous AI Agent
- **Policy Guardrails:** Recovery actions (reminders, discounts, instalment plans) are strictly evaluated against user-defined policies (`minDaysOverdue`, `maxDiscountPct`, `allowInstallments`, and `quietHours`).
- **Payer Persona Profiling:** Classifies payers into behavioral archetypes (Reliable, Forgetful, Chronic Late, Stressed) to tailor action timing and tone.
- **Human-in-the-Loop:** High-impact or threshold-exceeding actions require explicit one-click operator approval before execution.

---

## One-Command Local Startup

### Prerequisites
- Node.js >= 20.x
- pnpm >= 9.x
- PostgreSQL (running locally on port 5432 or 5433)

### Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Build monorepo packages
pnpm build

# 3. Seed demo scenario into PostgreSQL
pnpm seed

# 4. Start API server
pnpm --filter @settle/api dev
```

Visit `http://localhost:3000/` for the interactive landing page, `http://localhost:3000/health` for the system health check, and `http://localhost:3000/api/dashboard` for the Contract v1 dashboard state.

---

## Deploying to Render

Settle includes a multi-stage production `Dockerfile` and a declarative `render.yaml` blueprint.

### Automatic Blueprint Deployment
1. Push your repository to GitHub / GitLab.
2. In the [Render Dashboard](https://dashboard.render.com/), click **New +** > **Blueprint**.
3. Connect your repository. Render automatically reads `render.yaml`, provisions a free **PostgreSQL Database** (`settle-db`), and creates a Docker-based **Web Service** (`settle-api`).
4. In Render Dashboard, enter the required secrets under Environment Variables:
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_CLIENT_SECRET`
   - `PAYPAL_WEBHOOK_ID` (optional, see [docs/render-notes.md](docs/render-notes.md))
   - `GEMINI_API_KEY` or `OPENAI_API_KEY` (optional)
5. Deploy! Migrations and empty-database auto-seeding execute automatically during cold start.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | `postgresql://...` | Connection URL for PostgreSQL. Supports `?sslmode=require`. |
| `PORT` | No | `3000` | HTTP port for API server (automatically provided by Render). |
| `HOST` | No | `0.0.0.0` | Bind host address. |
| `NODE_ENV` | No | `development` | Environment mode (`development`, `production`, `test`). |
| `WEB_ORIGIN` | No | `http://localhost:5173` | Allowed CORS frontend origin. |
| `PAYPAL_CLIENT_ID` | Sandbox | - | PayPal OAuth client ID from Developer Dashboard. |
| `PAYPAL_CLIENT_SECRET` | Sandbox | - | PayPal OAuth client secret from Developer Dashboard. |
| `PAYPAL_BASE_URL` | No | `https://api-m.sandbox.paypal.com` | Base URL for PayPal API. Refuses live URL in non-test mode. |
| `PAYPAL_WEBHOOK_ID` | No | - | Webhook ID registered in PayPal Developer Dashboard. |
| `WEBHOOK_VERIFY` | No | `true` | Set `false` in development/testing to skip signature verification. |
| `PAYPAL_NUMBER_SUFFIX` | No | `true` | Appends unique suffix to PayPal invoice numbers to prevent duplicate errors. |
| `DEMO_TODAY` | No | `2026-11-05` | Anchor date for Maya Studio demo scenario. |
| `PAYPAL_BUYER_EMAIL` | No | `sb-9rzca53715246@personal.example.com` | Default PayPal Sandbox personal buyer email. |
| `PAYPAL_BUYER_PASSWORD` | No | `H/<Om0q#` | Default PayPal Sandbox personal buyer password. |
| `ENGINE_IMPL` | No | `stub` | Forecast engine implementation (`stub` \| `real`). |
| `AGENT_IMPL` | No | `stub` | AI agent implementation (`stub` \| `real`). |
| `GEMINI_API_KEY` | No | - | Google Gemini API key for generative recovery agent. |
| `OPENAI_API_KEY` | No | - | OpenAI API key (alternative LLM backend). |

---

## License

MIT © Settle Team
