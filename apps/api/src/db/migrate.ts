import { getRawSql } from './index.js';

export async function runMigrations(): Promise<void> {
  const sql = getRawSql();

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      as_of TEXT NOT NULL,
      starting_balance INTEGER NOT NULL,
      reserve_threshold INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      persona TEXT NOT NULL,
      avg_days_late DOUBLE PRECISION NOT NULL,
      lateness_risk DOUBLE PRECISION NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      payer_id TEXT NOT NULL REFERENCES payers(id),
      number TEXT NOT NULL,
      description TEXT NOT NULL,
      amount INTEGER NOT NULL,
      amount_paid INTEGER NOT NULL,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL,
      discount_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
      allow_partial BOOLEAN NOT NULL DEFAULT FALSE,
      minimum_amount_due INTEGER,
      paypal_invoice_id TEXT,
      pay_url TEXT
    );

    CREATE TABLE IF NOT EXISTS obligations (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL,
      due_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY DEFAULT 'default',
      max_discount_pct DOUBLE PRECISION NOT NULL,
      max_instalments INTEGER NOT NULL,
      auto_approve_max_amount INTEGER NOT NULL,
      require_approval_for JSONB NOT NULL,
      quiet_hours JSONB NOT NULL,
      max_reminders_per_invoice_per_week INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS action_records (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      type TEXT NOT NULL,
      params JSONB NOT NULL,
      reason TEXT NOT NULL,
      simulation JSONB,
      policy JSONB NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_by TEXT,
      executed_at TEXT,
      paypal_request_id TEXT,
      error TEXT
    );

    -- AUDIT EVENTS (APPEND-ONLY)
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      invoice_id TEXT,
      action_id TEXT,
      paypal_request_id TEXT,
      detail JSONB
    );

    CREATE TABLE IF NOT EXISTS invoice_paypal_ids (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      paypal_invoice_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      replaced_at TEXT,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS processed_webhook_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    -- Indexes for high-frequency queries
    CREATE INDEX IF NOT EXISTS idx_invoices_payer ON invoices(payer_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_paypal ON invoices(paypal_invoice_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_paypal_ids_inv ON invoice_paypal_ids(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_paypal_ids_pp ON invoice_paypal_ids(paypal_invoice_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_ts ON audit_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_actions_invoice ON action_records(invoice_id);
  `);
}
