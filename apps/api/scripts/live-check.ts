import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { closeDb } from '../src/db/index.js';
import { resetCachedEnv } from '../src/config/env.js';
import { resetAgentInstance } from '../src/adapters/agent.js';
import { resetEngineInstance } from '../src/adapters/engine.js';

async function runLiveCheck() {
  process.env.ENGINE_IMPL = 'real';
  process.env.AGENT_IMPL = 'real';
  process.env.POLICY_IGNORE_QUIET_HOURS = 'true';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/settle';

  resetCachedEnv();
  resetEngineInstance();
  resetAgentInstance();

  console.log('=== Step 1: Migrating Database on port 5433 ===');
  await runMigrations();

  console.log('=== Step 2: Initializing API App ===');
  const app = await buildApp();
  await app.ready();

  console.log('\n=== Step 3: POST /api/demo/reset ===');
  const resetRes = await app.inject({
    method: 'POST',
    url: '/api/demo/reset',
    payload: {},
  });
  console.log('Reset status:', resetRes.statusCode);

  console.log('\n=== Step 4: First POST /api/agent/run ===');
  const run1Res = await app.inject({
    method: 'POST',
    url: '/api/agent/run',
    payload: {},
  });
  console.log('Run 1 status:', run1Res.statusCode);
  const run1Body = JSON.parse(run1Res.payload);
  console.log(`Run 1 generated ${run1Body.actions?.length} actions.`);

  console.log('\n=== Step 5: Second POST /api/agent/run ===');
  const run2Res = await app.inject({
    method: 'POST',
    url: '/api/agent/run',
    payload: {},
  });
  console.log('Run 2 status:', run2Res.statusCode);
  const run2Body = JSON.parse(run2Res.payload);
  console.log(`Run 2 returned ${run2Body.actions?.length} actions.`);

  console.log('\n=== Step 6: Table of Actions from Run 2 ===');
  console.log('| Invoice ID | Type | Status | Reason (first 120 chars) |');
  console.log('| :--- | :--- | :--- | :--- |');
  for (const act of run2Body.actions) {
    const reasonSnippet = (act.reason || '').slice(0, 120).replace(/\|/g, '\\|');
    console.log(`| ${act.invoiceId} | ${act.type} | ${act.status} | ${reasonSnippet} |`);
  }

  console.log('\n=== Step 7: GET /api/dashboard ===');
  const dashRes = await app.inject({
    method: 'GET',
    url: '/api/dashboard',
  });
  const dashBody = JSON.parse(dashRes.payload);
  console.log('Dashboard KPIs:', JSON.stringify(dashBody.kpis, null, 2));

  console.log('\n=== Step 8: POST /api/chat ("Can I cover payroll on Friday?") ===');
  const chatRes = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: { question: 'Can I cover payroll on Friday?' },
  });
  const chatBody = JSON.parse(chatRes.payload);
  console.log('Chat Status:', chatRes.statusCode);
  console.log('Chat Answer Text:', chatBody.text);
  console.log('Tool Calls:', chatBody.toolCalls ? chatBody.toolCalls.map((tc: any) => tc.name) : []);
  if (chatBody.forecast) {
    console.log('Forecast Shortfall:', chatBody.forecast.shortfall);
    console.log('Forecast Lowest Amount:', chatBody.forecast.lowest?.amount);
    console.log('Forecast Lowest Date:', chatBody.forecast.lowest?.date);
  }

  console.log('\n=== Step 9: Approve Discount Action for Largest Invoice ===');
  const discountActions = run2Body.actions.filter((a: any) => a.type === 'OFFER_DISCOUNT');
  const invoiceMap = new Map(dashBody.invoices.map((inv: any) => [inv.id, inv]));
  discountActions.sort((a: any, b: any) => {
    const invA = invoiceMap.get(a.invoiceId);
    const invB = invoiceMap.get(b.invoiceId);
    const remA = invA ? invA.amount - invA.amountPaid : 0;
    const remB = invB ? invB.amount - invB.amountPaid : 0;
    return remB - remA;
  });

  const largestDiscountAction = discountActions[0];
  if (largestDiscountAction) {
    const targetInv = invoiceMap.get(largestDiscountAction.invoiceId) as any;
    console.log(`Largest invoice with discount: ${largestDiscountAction.invoiceId} (${targetInv?.number}, amount: ${targetInv?.amount})`);
    console.log(`PayPal Invoice ID: ${targetInv?.paypalInvoiceId || '(none)'}`);

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/actions/${largestDiscountAction.id}/approve`,
      payload: { note: 'Approving discount for live check' },
    });
    console.log('Approve response status:', approveRes.statusCode);
    const approveBody = JSON.parse(approveRes.payload);
    if (approveRes.statusCode === 200) {
      console.log('Action successfully approved and executed:', approveBody.status);
    } else if (approveRes.statusCode === 409) {
      console.log(`Action approval was rejected as expected with 409 ${approveBody.error?.code}: ${approveBody.error?.message} (invoice is unprovisioned in PayPal sandbox).`);
    } else {
      console.log('Approval result:', JSON.stringify(approveBody, null, 2));
    }
  } else {
    console.log('No discount action found in run results.');
  }

  if (process.env.GEMINI_API_KEY) {
    console.log('\n=== Step 10: Repeat with LLM_PROVIDER=gemini ===');
    process.env.LLM_PROVIDER = 'gemini';
    resetCachedEnv();
    resetAgentInstance();
    const geminiRunRes = await app.inject({
      method: 'POST',
      url: '/api/agent/run',
      payload: {},
    });
    const geminiBody = JSON.parse(geminiRunRes.payload);
    for (const act of geminiBody.actions.slice(0, 3)) {
      console.log(`[gemini] ${act.invoiceId} | ${act.type} | ${act.reason}`);
    }
  } else {
    console.log('\n=== Step 10: GEMINI_API_KEY check ===');
    console.log('GEMINI_API_KEY is not configured in local environment; MockLlm provider path was used.');
  }

  await app.close();
  await closeDb();
  console.log('\n=== Live Check Complete ===');
}

runLiveCheck().catch((err) => {
  console.error('Live check failed:', err);
  process.exit(1);
});
