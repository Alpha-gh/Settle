import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

function loadEnvFileSafe(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
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
            if (!process.env[k]) {
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
    DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/settle'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    ENGINE_IMPL: z.enum(['stub', 'real']).default('stub'),
    AGENT_IMPL: z.enum(['stub', 'real']).default('stub'),
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

export function resetCachedEnv(): void {
  cachedEnv = null;
}
