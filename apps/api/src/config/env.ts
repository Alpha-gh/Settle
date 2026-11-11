import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export function findRepoRoot(startDir: string = process.cwd()): string {
  let curr = resolve(startDir);
  while (true) {
    if (existsSync(resolve(curr, 'pnpm-workspace.yaml')) || existsSync(resolve(curr, '.git'))) {
      return curr;
    }
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return startDir;
}

export function loadEnvFileSafe(options?: { override?: boolean }): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = findRepoRoot();
  const candidatePaths = [
    resolve(root, '.env'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
    resolve(process.cwd(), '..', '..', '.env'),
    resolve(here, '..', '..', '..', '..', '.env'),
    resolve(here, '..', '..', '..', '.env'),
    'C:/Documents/Settle/.env',
  ];

  for (const p of candidatePaths) {
    if (existsSync(p)) {
      try {
        const text = readFileSync(p, 'utf-8');
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const idx = trimmed.indexOf('=');
          if (idx !== -1) {
            const k = trimmed.slice(0, idx).trim();
            const v = trimmed.slice(idx + 1).trim();
            if (options?.override || !process.env[k]) {
              process.env[k] = v;
            }
          }
        }
      } catch {
        // ignore read errors
      }
    }
  }

  // If PAYPAL_CLIENT_SECRET is missing but SECRET_KEY is set, map it
  if (!process.env.PAYPAL_CLIENT_SECRET && process.env.SECRET_KEY) {
    process.env.PAYPAL_CLIENT_SECRET = process.env.SECRET_KEY;
  }
}

loadEnvFileSafe();

const LIVE_PAYPAL_HOSTS = ['api-m.paypal.com', 'api.paypal.com'];

export const EnvSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5433/settle'),
    TEST_DATABASE_URL: z.string().optional(),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    ENGINE_IMPL: z.enum(['stub', 'real']).default('real'),
    AGENT_IMPL: z.enum(['stub', 'real']).default('real'),
    AGENT_FALLBACK_TO_STUB: z
      .union([z.boolean(), z.string()])
      .transform((val) => (typeof val === 'boolean' ? val : val !== 'false'))
      .default(true),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    WEBHOOK_VERIFY: z
      .union([z.boolean(), z.string()])
      .transform((val) => (typeof val === 'boolean' ? val : val !== 'false'))
      .default(true),
    PAYPAL_CLIENT_ID: z.string().min(1, 'PAYPAL_CLIENT_ID is required'),
    PAYPAL_CLIENT_SECRET: z.string().min(1, 'PAYPAL_CLIENT_SECRET is required'),
    PAYPAL_BASE_URL: z.string().url().default('https://api-m.sandbox.paypal.com'),
    PAYPAL_WEBHOOK_ID: z.string().optional(),
    PAYPAL_BUYER_EMAIL: z.string().optional(),
    PAYPAL_BUYER_PASSWORD: z.string().optional(),
    DEMO_BUYER_INVOICE_IDS: z.string().default(''),
    AUTO_PROVISION_PAYPAL: z
      .union([z.boolean(), z.string()])
      .transform((val) => (typeof val === 'boolean' ? val : val === 'true'))
      .default(false),
    POLICY_IGNORE_QUIET_HOURS: z
      .union([z.boolean(), z.string()])
      .transform((val) => (typeof val === 'boolean' ? val : val === 'true'))
      .default(false),
    PAYPAL_NUMBER_SUFFIX: z
      .union([z.boolean(), z.string()])
      .transform((val) => (typeof val === 'boolean' ? val : val !== 'false'))
      .default(true),
    DEMO_TODAY: z.string().default('2026-11-05'),
    AGENT_RUN_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(150),
    AGENT_RUN_MAX_SECONDS: z.coerce.number().int().positive().default(90),
    PROVISION_BUDGET_SECONDS: z.coerce.number().positive().default(60),
    LLM_CALL_TIMEOUT_SECONDS: z.coerce.number().positive().default(12),
    AGENT_LLM_MAX_CALLS_PER_RUN: z.coerce.number().int().min(0).default(4),
    LLM_PROVIDER: z.string().optional(),
    LLM_MODEL: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== 'test') {
      try {
        const parsed = new URL(data.PAYPAL_BASE_URL);
        if (LIVE_PAYPAL_HOSTS.includes(parsed.hostname)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['PAYPAL_BASE_URL'],
            message: 'Refusing to connect to live PayPal URL outside of test environment',
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PAYPAL_BASE_URL'],
          message: 'Invalid URL format for PAYPAL_BASE_URL',
        });
      }
    }
  });

export type ApiEnv = z.infer<typeof EnvSchema>;

let cachedEnv: ApiEnv | null = null;

export function getEnv(overrides: Record<string, string | undefined> = {}): ApiEnv {
  if (Object.keys(overrides).length > 0) {
    const merged = { ...process.env, ...overrides };
    return EnvSchema.parse(merged);
  }
  if (!cachedEnv) {
    cachedEnv = EnvSchema.parse(process.env);
  }
  return cachedEnv;
}


export function validateEnv(overrides: Record<string, string | undefined> = {}): ApiEnv {
  try {
    resetCachedEnv();
    return getEnv(overrides);
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('\n================================================================================');
      console.error('🚨 CONFIGURATION ERROR: Invalid environment variables!');
      console.error('--------------------------------------------------------------------------------');
      for (const issue of err.issues) {
        const p = issue.path.join('.') || 'root';
        console.error(`- ${p}: ${issue.message}`);
      }
      console.error('================================================================================\n');
    }
    throw err;
  }
}

export function resetCachedEnv(): void {
  cachedEnv = null;
}

export function getTestDatabaseUrl(): string {
  loadEnvFileSafe();
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  const baseDb = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/settle';
  try {
    const url = new URL(baseDb);
    url.pathname = '/settle_test';
    return url.toString();
  } catch {
    return 'postgresql://postgres:postgres@localhost:5433/settle_test';
  }
}
