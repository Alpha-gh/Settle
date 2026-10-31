import type { Invoice, Payer } from '@settle/shared';
import { getEnv } from '../src/config/env.js';
import { PayPalAuthenticator } from '../src/paypal/auth.js';
import { PayPalClient } from '../src/paypal/client.js';
import { centsToPayPalString } from '../src/paypal/money.js';

async function runSpike(): Promise<void> {
  console.log('====================================================');
  console.log('        SETTLE - PAYPAL SANDBOX INVOICING SPIKE     ');
  console.log('====================================================\n');

  const env = getEnv();
  console.log(`[Config] Base URL: ${env.PAYPAL_BASE_URL}`);
  console.log(`[Config] Client ID: ${env.PAYPAL_CLIENT_ID.slice(0, 8)}...`);

  // 1. OAuth Token
  console.log('\n--- 1. OAuth Authentication ---');
  const auth = new PayPalAuthenticator({
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    baseUrl: env.PAYPAL_BASE_URL,
  });

  const token = await auth.getAccessToken();
  console.log(`OAuth token acquired successfully (token length: ${token.length})`);
  console.log(`Token cached expires at: ${new Date(auth.getCachedTokenEntry()?.expiresAt ?? 0).toISOString()}`);

  const client = new PayPalClient({
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    baseUrl: env.PAYPAL_BASE_URL,
    authenticator: auth,
  });

  // 2. Create Draft Invoice & 3. Send
  console.log('\n--- 2 & 3. Create Draft & Send Invoice ---');
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

  const testPayer: Payer = {
    id: 'pay_spike_001',
    name: 'Maya Studio Client',
    email: env.PAYPAL_BUYER_EMAIL || 'client-sb@sandbox.settle.dev',
    persona: 'slow',
    avgDaysLate: 14,
    latenessRisk: 0.6,
  };

  const initialAmountCents = 350_000; // $3,500.00
  const testInvoice: Invoice = {
    id: 'inv_spike_001',
    payerId: testPayer.id,
    number: `INV-SPK-${Date.now().toString().slice(-6)}`,
    description: 'Q4 Brand Strategy Retainer',
    amount: initialAmountCents,
    amountPaid: 0,
    issueDate: today,
    dueDate: due,
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
  };

  console.log(`Creating invoice for ${testPayer.name} (${testPayer.email})`);
  console.log(`Amount: ${initialAmountCents} cents ($${centsToPayPalString(initialAmountCents)})`);

  const { paypalInvoiceId, payUrl } = await client.createAndSendInvoice(testInvoice, testPayer);
  console.log(`Invoice created & sent!`);
  console.log(`PayPal Invoice ID: ${paypalInvoiceId}`);
  console.log(`Payer Payment Link: ${payUrl}`);

  let currentStatus = await client.getInvoice(paypalInvoiceId);
  console.log(`Initial Status: ${currentStatus.status}, Amount Paid: ${currentStatus.amountPaid} cents`);

  // 4. Send Reminder
  console.log('\n--- 4. Send Reminder ---');
  await client.sendReminder(paypalInvoiceId, 'Friendly reminder: payment is due in 10 days.');
  console.log(`Reminder sent successfully for ${paypalInvoiceId}`);
  const lastAudit = client.getLastAuditRecord();
  console.log(`Audit: ${lastAudit?.operation} -> HTTP ${lastAudit?.httpStatus} (RequestId: ${lastAudit?.paypalRequestId})`);

  // 5. Update SENT invoice: discount and due date
  console.log('\n--- 5. Update SENT Invoice (Discount & Due Date) ---');
  const newDueDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const discountPct = 10; // 10% discount -> $350 off -> $3,150.00 due

  console.log(`Updating invoice ${paypalInvoiceId}:`);
  console.log(`  Discount: ${discountPct}%`);
  console.log(`  New Due Date: ${newDueDate}`);

  await client.updateInvoice(paypalInvoiceId, {
    discountPct,
    dueDate: newDueDate,
  });

  const activeId = client.getReissuedId(paypalInvoiceId);
  if (activeId !== paypalInvoiceId) {
    console.log(`Cancel-and-reissue fallback was used: ${paypalInvoiceId} -> ${activeId}`);
  } else {
    console.log(`Direct PUT update succeeded on SENT invoice ${activeId}`);
  }

  // 6. Partial Payment Configuration
  console.log('\n--- 6. Partial Payment Configuration ---');
  const minAmountDueCents = 100_000; // $1,000.00
  try {
    await client.updateInvoice(activeId, {
      allowPartial: true,
      minimumAmountDue: minAmountDueCents,
    });
    console.log(`Partial payments enabled with min due ${minAmountDueCents} cents`);
  } catch (err) {
    console.log(`Note on partial payments: ${(err as Error).message}`);
  }

  // 7. Generate Pay Link
  console.log('\n--- 7. Generate Pay Link ---');
  const activePayUrl = client.generatePayLink(activeId);
  console.log(`Generated Pay Link: ${activePayUrl}`);

  // 8. Record Payment
  console.log('\n--- 8. Record Payment ---');
  // Pay the discounted amount: 350,000 - 10% = 315,000 cents ($3,150.00)
  const paymentAmountCents = 315_000;
  console.log(`Recording payment of ${paymentAmountCents} cents ($${centsToPayPalString(paymentAmountCents)})...`);

  const paymentResult = await client.recordExternalPayment(activeId, paymentAmountCents, 'Full settlement paid by client');
  console.log(`Payment recorded! Payment ID: ${paymentResult.paymentId} (HTTP ${paymentResult.httpStatus})`);

  // 9. Fetch and Confirm Final Status
  console.log('\n--- 9. Fetch Invoice & Confirm Final Status ---');
  const finalResult = await client.getInvoice(activeId);

  console.log('\n====================================================');
  console.log('              FINAL SPIKE RESULT                   ');
  console.log('====================================================');
  console.log(`Real Sandbox Invoice ID:  ${activeId}`);
  console.log(`Final Status:             ${finalResult.status}`);
  console.log(`Amount Paid:              ${finalResult.amountPaid} cents ($${centsToPayPalString(finalResult.amountPaid)})`);
  console.log('====================================================\n');

  // 10. Webhook Delivery List
  console.log('--- 10. Webhook Delivery Check ---');
  try {
    const webhooks = await client.listWebhookDeliveries(env.PAYPAL_WEBHOOK_ID);
    console.log(`Webhook check returned ${Array.isArray(webhooks?.events) ? webhooks.events.length : 'active'} records`);
  } catch (whErr) {
    console.log(`Webhook inquiry note: ${(whErr as Error).message}`);
  }

  console.log('\n✅ PayPal sandbox spike completed successfully!');
}

runSpike().catch((err) => {
  console.error('\n❌ Spike failed:', err);
  process.exit(1);
});
