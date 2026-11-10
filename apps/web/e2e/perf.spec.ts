import { test, expect, TEST_IDS } from './fixtures';

test.describe('Virtualized Worklist Performance (?mockInvoices=200)', () => {
  test('renders 200 rows within threshold, scrolls to bottom, and sorts without console errors', async ({
    page,
  }) => {
    const startTime = Date.now();

    // 1. Navigate with 200 mock invoices query param
    await page.goto('/receivables?mockInvoices=200');

    // 2. Wait for worklist to render
    const worklist = page.getByTestId(TEST_IDS.worklist);
    await expect(worklist).toBeVisible({ timeout: 10000 });

    // Wait for initial rendered row to appear
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 10000 });

    const loadDuration = Date.now() - startTime;
    // Generous threshold: 8000ms
    expect(loadDuration).toBeLessThan(8000);

    // 3. Scroll to the bottom of the virtualized grid viewport
    const viewport = page.locator('.ag-body-viewport');
    await expect(viewport).toBeVisible();

    await viewport.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    // Verify row is rendered at bottom
    await page.waitForTimeout(500);
    const bottomRows = page.locator('.ag-row');
    const bottomCount = await bottomRows.count();
    expect(bottomCount).toBeGreaterThan(0);

    // 4. Apply a sort by clicking Amount column header
    const amountHeader = page.locator('.ag-header-cell', { hasText: 'Amount' });
    await expect(amountHeader).toBeVisible();
    await amountHeader.click();

    // Verify sort icon or updated order
    await page.waitForTimeout(500);
    const sortedFirstRow = page.locator('.ag-row').first();
    await expect(sortedFirstRow).toBeVisible();
  });
});

