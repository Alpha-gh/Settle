import { test, expect } from './fixtures';

test.describe('TestIDs Coverage on All Interactive Elements', () => {
  const routes = ['/', '/receivables', '/audit', '/policy'];

  for (const route of routes) {
    test(`verifies all interactive elements on ${route} have data-testid`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // Find all interactive elements
      const elements = page.locator(
        'button, a, input, select, textarea, [role="button"], [role="tab"], [role="checkbox"]',
      );
      const count = await elements.count();

      const missing: { tag: string; text: string; outerHtml: string }[] = [];

      for (let i = 0; i < count; i++) {
        const el = elements.nth(i);
        const isVisible = await el.isVisible().catch(() => false);
        if (!isVisible) continue;

        // Skip internal third-party AG Grid/AG Charts controls
        const className = (await el.getAttribute('class')) || '';
        if (className.includes('ag-')) continue;

        const testId = await el.getAttribute('data-testid');
        if (!testId || testId.trim() === '') {
          const tag = await el.evaluate((node) => node.tagName.toLowerCase());
          const text = (await el.textContent())?.trim().slice(0, 40) || '';
          const outerHtml = await el.evaluate((node) => node.outerHTML.slice(0, 100));
          missing.push({ tag, text, outerHtml });
        }
      }

      expect(
        missing,
        `Found ${missing.length} interactive elements without data-testid on ${route}:\n` +
          missing.map((m) => `  <${m.tag}> "${m.text}" (${m.outerHtml})`).join('\n'),
      ).toEqual([]);
    });
  }
});

