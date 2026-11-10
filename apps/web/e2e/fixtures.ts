import { test as base, expect } from '@playwright/test';
export { TEST_IDS } from '../src/testids';

export const test = base.extend<{ pageWithNoErrors: void }>({
  page: async ({ page }, use) => {
    const errorLogs: string[] = [];

    // Capture console errors and warnings
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();

      // Ignore standard React router future flag notices and benign AG grid license notice in dev
      if (text.includes('React Router Future Flag Warning')) return;
      if (text.includes('AG Grid: license key not found') || text.includes('ag-grid')) return;

      if (type === 'error' || type === 'warning') {
        errorLogs.push(`[Console ${type.toUpperCase()}] ${text}`);
      }
    });

    // Capture unhandled page errors
    page.on('pageerror', (err) => {
      errorLogs.push(`[Page Error] ${err.message}`);
    });

    // Capture failed network requests
    page.on('requestfailed', (req) => {
      // Ignore favicon or analytics if any
      if (req.url().includes('favicon.ico')) return;
      errorLogs.push(`[Network Failure] ${req.method()} ${req.url()}: ${req.failure()?.errorText}`);
    });

    // Capture HTTP 4xx / 5xx responses (unless intentionally testing errors)
    page.on('response', (res) => {
      if (res.status() >= 400 && !res.url().includes('/api/error-test')) {
        errorLogs.push(`[HTTP ${res.status()}] ${res.request().method()} ${res.url()}`);
      }
    });

    await use(page);

    expect(
      errorLogs,
      `Expected zero console errors/warnings, page errors, or failed requests, but found:\n${errorLogs.join('\n')}`,
    ).toEqual([]);
  },
});

export { expect };

