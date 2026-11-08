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

## 4. Cash Engine Integration & ENGINE_IMPL

### Build & Packaging
- The cash engine (`@settle/engine`) is built alongside `@settle/shared` and `@settle/api` during the Docker builder stage:
  ```bash
  pnpm --filter @settle/shared build && pnpm --filter @settle/engine build && pnpm --filter @settle/api build
  ```
- It emits clean CommonJS/ESM outputs to `packages/engine/dist/index.js` via `tsconfig.build.json`.
- The production runner container copies `packages/engine/dist` and `packages/engine/package.json`, making `@settle/engine` resolve natively without dev dependencies.

### Production Install & `--ignore-scripts`
- In Stage 2 (the production runner), `pnpm install --frozen-lockfile --prod --ignore-scripts` is executed with `--ignore-scripts`.
- **Why scripts are ignored in production install:** Dev tools such as TypeScript (`tsc`) and bundlers are devDependencies and are deliberately omitted during `--prod` installs. If lifecycle scripts (such as `prepare` or `postinstall`) attempt to compile TypeScript in a production install, they fail with `spawn ENOENT: tsc`. Using `--ignore-scripts` guarantees that production dependency installation never executes missing build tools, relying instead on the precompiled `dist/` artifacts copied from the builder stage.

### Environment Configuration
- **`ENGINE_IMPL=real` (default):** Dynamically loads `@settle/engine` via `createEngine()`, providing pure, deterministic integer-cents cash forecasting and counterfactual scenario simulations.
- **`ENGINE_IMPL=stub` (fallback):** Reverts to `StubEngine` from `src/adapters/stubs.ts` if running in an isolated test harness without the engine package.


