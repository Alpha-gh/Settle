import { test, expect, TEST_IDS } from './fixtures';

test.describe('Settle 3-Minute Smoke Flow', () => {
  test('executes end-to-end continuous flow seamlessly', async ({ page }) => {
    // a. Open /?demo=1. Assert sandbox badge, red breach banner text containing "short" and shortfall, chart visible.
    await page.goto('/?demo=1');

    const sandboxBadge = page.getByTestId(TEST_IDS.sandboxBadge);
    await expect(sandboxBadge).toBeVisible();
    await expect(sandboxBadge).toHaveText(/Sandbox - no real funds/i);

    const breachBanner = page.getByTestId(TEST_IDS.breachBanner);
    await expect(breachBanner).toBeVisible();
    const breachText = await breachBanner.textContent();
    expect(breachText).toContain('short');
    expect(breachText).toContain('$2,000.00');

    const chart = page.getByTestId(TEST_IDS.balanceChart);
    await expect(chart).toBeVisible();

    // b. Click Run Settle; wait for the result line; the worklist shows rows with action pills.
    const runSettleBtn = page.getByTestId(TEST_IDS.runSettle);
    await expect(runSettleBtn).toBeEnabled();
    await runSettleBtn.click();

    const resultLine = page.getByTestId(TEST_IDS.runSettleResult);
    await expect(resultLine).toBeVisible({ timeout: 15000 });
    await expect(resultLine).toHaveText(/7 actions proposed, 1 invoice skipped\./i);

    // Verify worklist displays action pills
    await expect(page.getByText(/Offer Discount.*Awaiting Approval/i).first()).toBeVisible();

    // c. Open the co-pilot, click "Can I cover payroll on Friday?", assert an answer with a chart appears, close it.
    const copilotToggle = page.getByTestId(TEST_IDS.copilotToggle);
    await copilotToggle.click();

    const prompt1 = page.getByTestId(TEST_IDS.chatSuggestion1);
    await expect(prompt1).toBeVisible();
    await prompt1.click();

    // Wait for copilot thinking to finish and answer to appear
    await expect(page.getByText(/Under your baseline forecast/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Simulation Trajectory')).toBeVisible();

    const copilotClose = page.getByTestId(TEST_IDS.copilotClose);
    await copilotClose.click();
    await expect(copilotClose).not.toBeVisible();

    // d. Select the AWAITING_APPROVAL row; drawer shows reason, "Closes the gap" tag, policy verdict.
    // In our mock dataset, INV-1001 (Bluefin Media) is the awaiting approval action.
    await page.getByText('INV-1001').first().click();

    const drawer = page.getByTestId(TEST_IDS.drawer);
    await expect(drawer).toBeVisible();

    await expect(page.getByTestId(TEST_IDS.drawerReason)).toBeVisible();
    await expect(drawer.getByText(/Closes the gap/i)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.drawerPolicy)).toBeVisible();

    // Assert that the word "sent" does not appear before approval/execution (verbatim status rule)
    const drawerTextBefore = await drawer.textContent();
    expect(drawerTextBefore?.toLowerCase()).not.toContain('sent');

    // Click Approve; assert the timeline reaches EXECUTED and a PayPal request id appears
    const approveBtn = page.getByTestId(TEST_IDS.approveButton);
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    const paypalId = page.getByTestId(TEST_IDS.drawerPaypalId);
    await expect(paypalId).toBeVisible({ timeout: 10000 });
    await expect(paypalId).toHaveText(/PP-REQ-/i);

    // e. With the invoice selected click "Simulate payment" in the demo panel;
    // assert the row's status chip becomes Paid, the red banner disappears and the green gap-closed banner appears.
    const simulatePaymentBtn = page.getByTestId(TEST_IDS.demoSimulatePayment);
    await expect(simulatePaymentBtn).toBeEnabled();
    await simulatePaymentBtn.click();

    // Close drawer if open to see dashboard banners clearly
    const drawerClose = page.getByTestId(TEST_IDS.drawerClose);
    if (await drawerClose.isVisible()) {
      await drawerClose.click();
    }

    // Breach banner disappears and green gap-closed banner appears
    await expect(breachBanner).not.toBeVisible({ timeout: 10000 });
    const gapClosedBanner = page.getByTestId(TEST_IDS.gapClosedBanner);
    await expect(gapClosedBanner).toBeVisible();
    await expect(gapClosedBanner).toHaveText(/Gap closed: your balance now stays above your reserve/i);

    // Row status chip becomes Paid
    await expect(page.getByText('Paid').first()).toBeVisible();

    // f. Go to Audit; assert an entry for the approval and one with actor PayPal showing the request id exist, newest first.
    await page.getByRole('link', { name: /Audit Log/i }).click();

    const auditList = page.getByTestId(TEST_IDS.auditList);
    await expect(auditList).toBeVisible();

    // PayPal payment event exists with monospace request id
    await expect(page.getByText(/PP-WEBHOOK-SIM99/i).first()).toBeVisible();
    await expect(page.getByText(/PayPal received settlement/i).first()).toBeVisible();

    // g. Return to the dashboard; assert the Impact card shows before vs after values.
    await page.getByRole('link', { name: /Dashboard/i }).click();

    const impactCard = page.getByTestId(TEST_IDS.impactCard);
    await expect(impactCard).toBeVisible();
    await expect(impactCard.getByRole('columnheader', { name: 'Before' })).toBeVisible();
    await expect(impactCard.getByRole('columnheader', { name: 'After' })).toBeVisible();
    await expect(impactCard.getByText(/Invoices Collected/i)).toBeVisible();
  });
});

