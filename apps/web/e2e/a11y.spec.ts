import { test, expect, TEST_IDS } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

test.describe('A11y Accessibility Audits (Zero Serious/Critical Violations)', () => {
  test('verifies WCAG 2.1 AA on Dashboard (/)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(violations, `Violations on Dashboard: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
  });

  test('verifies WCAG 2.1 AA on Receivables (/receivables)', async ({ page }) => {
    await page.goto('/receivables');
    await page.waitForLoadState('networkidle');

    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(violations, `Violations on Receivables: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
  });

  test('verifies WCAG 2.1 AA on Audit (/audit)', async ({ page }) => {
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');

    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(violations, `Violations on Audit: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
  });

  test('verifies WCAG 2.1 AA on Policy (/policy)', async ({ page }) => {
    await page.goto('/policy');
    await page.waitForLoadState('networkidle');

    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(violations, `Violations on Policy: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
  });

  test('verifies WCAG 2.1 AA with Action Review Drawer open', async ({ page }) => {
    await page.goto('/?invoice=inv_001');
    await page.waitForSelector(`[data-testid="${TEST_IDS.drawer}"]`);
    await page.waitForTimeout(500);

    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(violations, `Violations with Drawer open: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
  });

  test('verifies WCAG 2.1 AA with Cashflow Co-pilot open', async ({ page }) => {
    await page.goto('/');
    await page.click(`[data-testid="${TEST_IDS.copilotToggle}"]`);
    await page.waitForSelector(`[data-testid="${TEST_IDS.copilotInput}"]`);
    await page.waitForTimeout(500);

    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(violations, `Violations with Copilot open: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
  });
});

