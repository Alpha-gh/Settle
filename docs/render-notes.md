# Render Deployment & Operating Notes

This document provides operational guidance for hosting Settle on Render, including handling free-tier limitations, database persistence, and PayPal webhook configuration.

---

## 1. Free Tier Cold Starts & Spin-Down

### Behavior
- On Render's free tier, the web service automatically spins down (sleeps) after **15 minutes of inactivity**.
- The next incoming request initiates a container boot, taking approximately **45 to 90 seconds** before responding.

### Settle Built-in Mitigations
- **Automatic Migration & Auto-Seed:** At cold start, Settle checks database readiness, executes pending Drizzle migrations, and seeds the Maya Studio scenario if the database is brand new.
- **Advisory Lock Concurrency Protection:** To prevent race conditions if multiple requests arrive simultaneously while the container is waking up, database initialization is guarded by a PostgreSQL transaction advisory lock (`SELECT pg_advisory_xact_lock(...)`). Only one worker initializes the schema, while concurrent workers wait safely.
- **Keep-Alive (Optional):** For evaluation demos, you can configure a free uptime monitor (e.g. UptimeRobot, cron-job.org) to ping `https://<service-url>/health` every 10 minutes to prevent sleep.

---

## 2. 30-Day Postgres Expiry & Migration Paths

### Render Free Database Lifecycle
- Render's free PostgreSQL databases expire and are permanently deleted **30 days** after creation.
- Render sends warning emails 7 days and 2 days before expiration.

### Migration Options

#### Option A: Upgrade to Render Starter Tier ($7/mo)
- In the Render Dashboard, open `settle-db` and click **Upgrade Plan**.
- Transitions your database to persistent storage with point-in-time recovery and zero downtime.

#### Option B: External Serverless PostgreSQL (Permanent Free Tiers)
Settle natively supports external Postgres providers with zero code modifications:
- **Neon** (serverless Postgres with branching): `neon.tech`
- **Supabase** (free tier Postgres): `supabase.com`
- **Railway**: `railway.app`

Settle's database client automatically detects `neon.tech`, `supabase.co`, and query parameters like `?sslmode=require` or `?ssl=require`, configuring SSL certificates (`rejectUnauthorized: false`) automatically.

#### Option C: Backup and Re-provision
To export data before 30-day expiration:
```bash
pg_dump "$DATABASE_URL" -Fc -f settle_backup.dump
```
Create a new database instance, update `DATABASE_URL` in your Render Web Service settings, and restore:
```bash
pg_restore -d "$NEW_DATABASE_URL" --clean --if-exists settle_backup.dump
```

---

## 3. PayPal Sandbox Webhook Registration

To receive live asynchronous payment notifications (`INVOICING.INVOICE.PAID`) when buyers pay in the PayPal Sandbox:

### Registration Steps
1. Log in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Under **Apps & Credentials**, select the REST API App corresponding to your `PAYPAL_CLIENT_ID`.
3. Scroll down to the **Webhooks** section and click **Add Webhook**.
4. In the **Webhook URL** field, enter your public Render endpoint:
   ```
   https://<your-render-service>.onrender.com/api/webhooks/paypal
   ```
5. In **Event types**, select the following events:
   - `INVOICING.INVOICE.PAID`
   - `INVOICING.INVOICE.CANCELLED`
   - `INVOICING.INVOICE.REFUNDED`
   - `INVOICING.INVOICE.UPDATED`
   - `PAYMENT.SALE.COMPLETED`
6. Click **Save**.
7. Copy the generated **Webhook ID** (e.g. `9AB12345CD67890EF`).
8. In the Render Dashboard under **settle-api** > **Environment**, set:
   ```
   PAYPAL_WEBHOOK_ID=9AB12345CD67890EF
   ```
9. Trigger a redeploy. Incoming webhooks will now be cryptographically verified against PayPal's public keys.

> **Note on Sandbox Latency:** In PayPal Sandbox, webhooks are typically delivered between 15 and 90 seconds after payment completion. Settle's `POST /api/demo/simulate-payment` endpoint provides an instantaneous alternative for live demonstrations.

---

## 4. Cash Engine & AI Agent Integration in Docker

### Build & Packaging
- The cash engine (`@settle/engine`) and AI agent (`@settle/agent`) are built alongside `@settle/shared` and `@settle/api` during the Docker builder stage:
  ```bash
  pnpm --filter @settle/shared build && pnpm --filter @settle/engine build && pnpm --filter @settle/agent build && pnpm --filter @settle/api build
  ```
- Both `@settle/engine` and `@settle/agent` emit clean CommonJS/ESM outputs to their respective `dist/` directories via `tsconfig.build.json`.
- The production runner container copies `packages/engine/dist`, `packages/engine/package.json`, `packages/agent/dist`, and `packages/agent/package.json`, allowing them to resolve natively as workspace packages without dev dependencies.

### Production Install & `--ignore-scripts`
- In Stage 2 (the production runner), `pnpm install --frozen-lockfile --prod --ignore-scripts` is executed with `--ignore-scripts`.
- **Why scripts are ignored in production install:** Dev tools such as TypeScript (`tsc`) and bundlers are devDependencies and are deliberately omitted during `--prod` installs. If lifecycle scripts (such as `prepare` or `postinstall`) attempt to compile TypeScript in a production install, they fail with `spawn ENOENT: tsc`. Using `--ignore-scripts` guarantees that production dependency installation never executes missing build tools, relying instead on the precompiled `dist/` artifacts copied from the builder stage.

### Environment Configuration
- **`ENGINE_IMPL=real` (default):** Dynamically loads `@settle/engine` via `createEngine()`, providing pure, deterministic integer-cents cash forecasting and counterfactual scenario simulations.
- **`ENGINE_IMPL=stub` (fallback):** Reverts to `StubEngine` from `src/adapters/stubs.ts` if running in an isolated test harness without the engine package.

---

## 5. AI Agent Deployment & LLM Configuration

### Defaults & Implementation Mode
- **`AGENT_IMPL=real` (default):** Wires the real AI agent (`createAgent({ engine, llm, clock })`) from `@settle/agent`.
- **`AGENT_IMPL=stub` (fallback):** Reverts to `StubAgent` from `src/adapters/stubs.ts`.
- **`LLM_PROVIDER=gemini` (default):** Configures Google Gemini as the generative reasoning provider. Also supports `anthropic`, `openai`, or `mock`.
- **`LLM_MODEL` (optional):** Model identifier override (defaults to provider recommendation, e.g. `gemini-1.5-flash`).

### Demo Safety & Fallback Behavior
- **`AGENT_FALLBACK_TO_STUB=true` (default):** If the LLM provider fails (due to quota limits, network timeout, rate limit, or invalid response) or if `@settle/agent` throws an error during `POST /api/agent/run` or `POST /api/chat`:
  - An `agent.error` event is appended to the audit log.
  - Pino logs full error diagnostics.
  - The API seamlessly falls back to `StubAgent` for that request, ensuring live demos and UI presentations never crash with 500 errors.
- If `AGENT_FALLBACK_TO_STUB=false`, the server returns HTTP 502 with `{ error: { code: "AGENT_FAILED", message } }`.
- **Missing API Key Handling:** If `GEMINI_API_KEY` is not set, `@settle/agent` automatically routes calls to `MockLlm`, ensuring full out-of-the-box functionality without external dependencies.

---

## 6. Render Environment & Secret Configuration

### Complete List of Render Environment Variables (`render.yaml`)

| Variable | Type | Value / Default | Description |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | Plain | `production` | Production mode |
| `HOST` | Plain | `0.0.0.0` | Bind address |
| `PORT` | Plain | `3000` | Port assigned by Render |
| `ENGINE_IMPL` | Plain | `real` | Use real deterministic forecast engine |
| `AGENT_IMPL` | Plain | `real` | Use real AI agent backend |
| `LLM_PROVIDER` | Plain | `gemini` | Generative LLM provider |
| `AGENT_FALLBACK_TO_STUB` | Plain | `true` | Fallback to stub on runtime LLM errors |
| `PAYPAL_BASE_URL` | Plain | `https://api-m.sandbox.paypal.com` | PayPal Sandbox endpoint |
| `PAYPAL_NUMBER_SUFFIX` | Plain | `true` | Unique invoice number suffix for sandbox |
| `WEBHOOK_VERIFY` | Plain | `true` | Cryptographic webhook signature verification |
| `DATABASE_URL` | Secret / Linked | fromDatabase `settle-db` | Connection string to PostgreSQL |
| `PAYPAL_CLIENT_ID` | Secret (`sync: false`) | User-supplied | PayPal developer OAuth client ID |
| `PAYPAL_CLIENT_SECRET` | Secret (`sync: false`) | User-supplied | PayPal developer OAuth client secret |
| `PAYPAL_WEBHOOK_ID` | Secret (`sync: false`) | User-supplied | PayPal registered webhook ID |
| `PAYPAL_BUYER_EMAIL` | Secret (`sync: false`) | User-supplied | Personal sandbox buyer account |
| `PAYPAL_BUYER_PASSWORD` | Secret (`sync: false`) | User-supplied | Personal sandbox buyer password |
| `GEMINI_API_KEY` | Secret (`sync: false`) | User-supplied | Google Gemini API key (Google AI Studio) |
| `ANTHROPIC_API_KEY` | Secret (`sync: false`) | User-supplied | Anthropic Claude API key (optional) |
| `OPENAI_API_KEY` | Secret (`sync: false`) | User-supplied | OpenAI API key (optional) |

### Setting Up a Free Gemini API Key on Render
1. Visit **Google AI Studio** at [https://aistudio.google.com/](https://aistudio.google.com/).
2. Sign in and click **Get API key** > **Create API key**.
3. In the Render Dashboard, open the **settle-api** web service.
4. Navigate to **Environment** > **Add Environment Variable**.
5. Set Key: `GEMINI_API_KEY` and Value: `<your-api-key>`.
6. Save changes; Render will redeploy automatically with active live LLM reasoning.

---

## 7. Web Frontend Build & Same-Origin Static Hosting

- **Docker Builder Stage:** Builds `@settle/shared`, `@settle/engine`, `@settle/agent`, `@settle/api`, and finally the React SPA (`VITE_USE_MOCKS="" VITE_API_BASE="" pnpm --filter web build`).
- **Docker Runner Stage:** Copies compiled frontend artifacts (`apps/web/dist`) into `/app/apps/web/dist`.
- **Fastify Static & SPA Fallback:** `apps/api` automatically detects `apps/web/dist` and registers `@fastify/static` (with `index: false` so `GET /` serves `index.html` cleanly without route duplication). Client-side routes (`/receivables`, `/audit`, `/policy`) fall back to `index.html` while `/api/*`, `/health`, and `/assets/*` are excluded from the fallback.
- **Same-Origin Operation:** With `VITE_USE_MOCKS` disabled and `VITE_API_BASE` empty, the frontend makes relative requests (`/api/dashboard`, `/api/events`, etc.) to the same origin, requiring zero cross-origin configuration in production.
- **Content Security Policy:** Helmet CSP allows `'self'`, inline styles (`'unsafe-inline'` for AG Grid/AG Charts), and Google Fonts (`https://fonts.googleapis.com` and `https://fonts.gstatic.com`).


