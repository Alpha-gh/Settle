import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Invoice, Payer } from '@settle/shared';
import { EnvSchema } from '../src/config/env.js';
import { PayPalAuthenticator } from '../src/paypal/auth.js';
import { PayPalClient } from '../src/paypal/client.js';
import { PayPalError } from '../src/paypal/errors.js';
import { centsToPayPalString, payPalStringToCents } from '../src/paypal/money.js';

describe('PayPal Integration Unit Tests', () => {
  // ── 1. Money Conversion ────────────────────────────────────────────────
  describe('Money Conversion Helper (No Floats)', () => {
    describe('centsToPayPalString', () => {
      it('converts positive cents to two-decimal strings', () => {
        expect(centsToPayPalString(100)).toBe('1.00');
        expect(centsToPayPalString(25_000)).toBe('250.00');
        expect(centsToPayPalString(5)).toBe('0.05');
        expect(centsToPayPalString(99)).toBe('0.99');
        expect(centsToPayPalString(1_234_567)).toBe('12345.67');
      });

      it('converts zero cents to 0.00', () => {
        expect(centsToPayPalString(0)).toBe('0.00');
      });

      it('converts negative cents with leading minus', () => {
        expect(centsToPayPalString(-2500)).toBe('-25.00');
        expect(centsToPayPalString(-5)).toBe('-0.05');
      });

      it('throws error for non-integer cents', () => {
        expect(() => centsToPayPalString(100.5 as any)).toThrow(/integer/i);
        expect(() => centsToPayPalString(NaN as any)).toThrow(/integer/i);
        expect(() => centsToPayPalString(Infinity as any)).toThrow(/integer/i);
      });
    });

    describe('payPalStringToCents', () => {
      it('converts decimal strings to integer cents', () => {
        expect(payPalStringToCents('1.00')).toBe(100);
        expect(payPalStringToCents('250.00')).toBe(25_000);
        expect(payPalStringToCents('0.05')).toBe(5);
        expect(payPalStringToCents('0.99')).toBe(99);
        expect(payPalStringToCents('12345.67')).toBe(1_234_567);
      });

      it('handles integer and single-decimal strings', () => {
        expect(payPalStringToCents('100')).toBe(10_000);
        expect(payPalStringToCents('100.5')).toBe(10_050);
        expect(payPalStringToCents('0')).toBe(0);
        expect(payPalStringToCents('0.0')).toBe(0);
        expect(payPalStringToCents('0.00')).toBe(0);
      });

      it('converts negative strings to negative cents', () => {
        expect(payPalStringToCents('-25.00')).toBe(-2500);
        expect(payPalStringToCents('-0.05')).toBe(-5);
      });

      it('handles whitespace', () => {
        expect(payPalStringToCents('  50.25  ')).toBe(5025);
      });

      it('rejects values with more than two decimal places', () => {
        expect(() => payPalStringToCents('10.999')).toThrow(/decimal/i);
        expect(() => payPalStringToCents('0.1234')).toThrow(/decimal/i);
      });

      it('rejects invalid non-numeric strings', () => {
        expect(() => payPalStringToCents('abc')).toThrow(/invalid/i);
        expect(() => payPalStringToCents('$100.00')).toThrow(/invalid/i);
        expect(() => payPalStringToCents('')).toThrow(/invalid/i);
      });

      it('satisfies bidirectional roundtrip for all test amounts', () => {
        const amounts = [0, 1, 5, 10, 99, 100, 250, 10_000, 350_000, 1_000_000, -500];
        for (const cents of amounts) {
          expect(payPalStringToCents(centsToPayPalString(cents))).toBe(cents);
        }
      });
    });
  });

  // ── 2. Request-ID Uniqueness ───────────────────────────────────────────
  describe('Request-ID Uniqueness & Audit Trail', () => {
    it('sends a unique PayPal-Request-Id header on each call and records audit', async () => {
      const capturedRequestIds: string[] = [];

      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        const headers = init?.headers as Record<string, string>;
        const reqId = headers['PayPal-Request-Id'];
        if (reqId) capturedRequestIds.push(reqId);

        if (urlStr.endsWith('/v1/oauth2/token')) {
          return new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.endsWith('/v2/invoicing/generate-next-invoice-number')) {
          return new Response(JSON.stringify({ invoice_number: 'INV-TEST-001' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'paypal-debug-id': 'dbg-num-1' },
          });
        }
        if (urlStr.endsWith('/v2/invoicing/invoices')) {
          return new Response(JSON.stringify({ id: 'INV2-MOCK-ID-1', status: 'DRAFT' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json', 'paypal-debug-id': 'dbg-draft-1' },
          });
        }
        if (urlStr.includes('/send')) {
          return new Response(JSON.stringify({ href: 'https://pay.mock/INV2-MOCK-ID-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'paypal-debug-id': 'dbg-send-1' },
          });
        }
        if (urlStr.includes('/remind')) {
          return new Response(null, {
            status: 204,
            headers: { 'paypal-debug-id': 'dbg-remind-1' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      const client = new PayPalClient({
        clientId: 'mock_client',
        clientSecret: 'mock_secret',
        baseUrl: 'https://api-m.sandbox.paypal.com',
        fetchFn: mockFetch as any,
      });

      const testInvoice: Invoice = {
        id: 'inv_1',
        payerId: 'pay_1',
        number: 'INV-001',
        description: 'Test invoice',
        amount: 10_000,
        amountPaid: 0,
        issueDate: '2026-10-31',
        dueDate: '2026-11-15',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      };

      const testPayer: Payer = {
        id: 'pay_1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        persona: 'reliable',
        avgDaysLate: 0,
        latenessRisk: 0.05,
      };

      await client.createAndSendInvoice(testInvoice, testPayer);
      await client.sendReminder('INV2-MOCK-ID-1', 'Please pay');

      // Verify each request had a PayPal-Request-Id header
      expect(capturedRequestIds.length).toBeGreaterThanOrEqual(3);
      // Verify all Request IDs are unique
      const uniqueIds = new Set(capturedRequestIds);
      expect(uniqueIds.size).toBe(capturedRequestIds.length);

      // Verify audit trail recorded each operation with requestId, httpStatus, debugId
      const trail = client.getAuditTrail();
      expect(trail.length).toBeGreaterThanOrEqual(3);
      for (const entry of trail) {
        expect(entry.paypalRequestId).toBeDefined();
        expect(entry.httpStatus).toBeGreaterThanOrEqual(200);
        expect(entry.timestamp).toBeDefined();
      }
    });
  });

  // ── 3. Error Mapping ──────────────────────────────────────────────────
  describe('Error Mapping (PayPalError)', () => {
    it('maps PayPal API error responses into typed PayPalError with debug_id', async () => {
      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/v1/oauth2/token')) {
          return new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            name: 'UNPROCESSABLE_ENTITY',
            message: 'Invoice cannot be reminded in current state.',
            debug_id: 'debug-xyz-789',
            details: [{ field: 'status', issue: 'CANNOT_REMIND' }],
          }),
          {
            status: 422,
            headers: {
              'Content-Type': 'application/json',
              'paypal-debug-id': 'debug-xyz-789',
            },
          },
        );
      });

      const client = new PayPalClient({
        clientId: 'mock_client',
        clientSecret: 'mock_secret',
        fetchFn: mockFetch as any,
      });

      await expect(client.sendReminder('INV2-FAIL', 'Note')).rejects.toThrow(PayPalError);

      try {
        await client.sendReminder('INV2-FAIL', 'Note');
      } catch (err: any) {
        expect(err).toBeInstanceOf(PayPalError);
        expect(err.status).toBe(422);
        expect(err.debugId).toBe('debug-xyz-789');
        expect(err.message).toMatch(/Invoice cannot be reminded/);
        expect(err.details).toBeDefined();
        expect(err.paypalRequestId).toBeDefined();
      }
    });

    it('maps network connection failures to status 500 PayPalError', async () => {
      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/v1/oauth2/token')) {
          return new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }), {
            status: 200,
          });
        }
        throw new Error('ECONNRESET');
      });

      const client = new PayPalClient({
        clientId: 'mock_client',
        clientSecret: 'mock_secret',
        fetchFn: mockFetch as any,
      });

      await expect(client.getInvoice('INV2-NET-ERR')).rejects.toThrow(PayPalError);
      try {
        await client.getInvoice('INV2-NET-ERR');
      } catch (err: any) {
        expect(err.status).toBe(500);
        expect(err.message).toMatch(/network error/i);
      }
    });
  });

  // ── 4. Live-URL Refusal ────────────────────────────────────────────────
  describe('Live-URL Refusal', () => {
    const validBase = {
      PAYPAL_CLIENT_ID: 'mock_client_id',
      PAYPAL_CLIENT_SECRET: 'mock_secret',
    };

    it('allows sandbox URL in development and test environments', () => {
      const parsed = EnvSchema.parse({
        ...validBase,
        NODE_ENV: 'development',
        PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com',
      });
      expect(parsed.PAYPAL_BASE_URL).toBe('https://api-m.sandbox.paypal.com');
    });

    it('refuses live URL https://api-m.paypal.com when NODE_ENV is development', () => {
      expect(() =>
        EnvSchema.parse({
          ...validBase,
          NODE_ENV: 'development',
          PAYPAL_BASE_URL: 'https://api-m.paypal.com',
        }),
      ).toThrow(/refusing to connect to live paypal url/i);
    });

    it('refuses live URL https://api.paypal.com when NODE_ENV is production', () => {
      expect(() =>
        EnvSchema.parse({
          ...validBase,
          NODE_ENV: 'production',
          PAYPAL_BASE_URL: 'https://api.paypal.com',
        }),
      ).toThrow(/refusing to connect to live paypal url/i);
    });

    it('allows live URL ONLY when NODE_ENV is test', () => {
      const parsed = EnvSchema.parse({
        ...validBase,
        NODE_ENV: 'test',
        PAYPAL_BASE_URL: 'https://api-m.paypal.com',
      });
      expect(parsed.PAYPAL_BASE_URL).toBe('https://api-m.paypal.com');
    });
  });

  // ── 5. Token Caching & Early Refresh ──────────────────────────────────
  describe('OAuth Token Caching and Early Refresh', () => {
    it('caches token and avoids re-fetching before expiry', async () => {
      let fetchCount = 0;
      const mockFetch = vi.fn(async () => {
        fetchCount++;
        return new Response(
          JSON.stringify({
            access_token: `token-v${fetchCount}`,
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 },
        );
      });

      const auth = new PayPalAuthenticator({
        clientId: 'id',
        clientSecret: 'secret',
        baseUrl: 'https://api-m.sandbox.paypal.com',
        fetchFn: mockFetch as any,
      });

      const token1 = await auth.getAccessToken();
      const token2 = await auth.getAccessToken();

      expect(token1).toBe('token-v1');
      expect(token2).toBe('token-v1');
      expect(fetchCount).toBe(1);
    });

    it('refreshes token early when within refreshBufferMs', async () => {
      let fetchCount = 0;
      const mockFetch = vi.fn(async () => {
        fetchCount++;
        return new Response(
          JSON.stringify({
            access_token: `token-v${fetchCount}`,
            expires_in: 10, // 10 seconds
            token_type: 'Bearer',
          }),
          { status: 200 },
        );
      });

      const auth = new PayPalAuthenticator({
        clientId: 'id',
        clientSecret: 'secret',
        baseUrl: 'https://api-m.sandbox.paypal.com',
        refreshBufferMs: 15_000, // buffer larger than 10s expiry -> forces early refresh
        fetchFn: mockFetch as any,
      });

      const token1 = await auth.getAccessToken();
      expect(token1).toBe('token-v1');

      // Next call triggers early refresh because remaining time < refreshBufferMs
      const token2 = await auth.getAccessToken();
      expect(token2).toBe('token-v2');
      expect(fetchCount).toBe(2);
    });
  });

  // ── 6. Status and Payment Mapping ─────────────────────────────────────
  describe('Invoice Status and Payment Parsing', () => {
    it('maps MARKED_AS_PAID to PAID with amountPaid in cents', async () => {
      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/v1/oauth2/token')) {
          return new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            id: 'INV2-PAID-001',
            status: 'MARKED_AS_PAID',
            payments: {
              paid_amount: { currency_code: 'USD', value: '3150.00' },
            },
          }),
          { status: 200 },
        );
      });

      const client = new PayPalClient({
        clientId: 'mock',
        clientSecret: 'mock',
        fetchFn: mockFetch as any,
      });

      const inv = await client.getInvoice('INV2-PAID-001');
      expect(inv.status).toBe('PAID');
      expect(inv.amountPaid).toBe(315_000);
    });

    it('maps PARTIALLY_PAID status correctly', async () => {
      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/v1/oauth2/token')) {
          return new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            id: 'INV2-PARTIAL-001',
            status: 'PARTIALLY_PAID',
            payments: {
              paid_amount: { currency_code: 'USD', value: '1000.00' },
            },
          }),
          { status: 200 },
        );
      });

      const client = new PayPalClient({
        clientId: 'mock',
        clientSecret: 'mock',
        fetchFn: mockFetch as any,
      });

      const inv = await client.getInvoice('INV2-PARTIAL-001');
      expect(inv.status).toBe('PARTIALLY_PAID');
      expect(inv.amountPaid).toBe(100_000);
    });
  });
});
