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

  console.log('\n=== Step 4: POST /api/demo/provision-paypal ===');
  const provRes = await app.inject({
    method: 'POST',
    url: '/api/demo/provision-paypal',
    payload: {},
  });
  console.log('Provision status:', provRes.statusCode);
  const provBody = JSON.parse(provRes.payload);
  console.log(`Provisioned ${provBody.provisioned?.length || 0} invoices.`);

  console.log('\n=== Step 5: First POST /api/agent/run ===');
  const run1Res = await app.inject({
    method: 'POST',
    url: '/api/agent/run',
    payload: {},
  });
  console.log('Run 1 status:', run1Res.statusCode);
  const run1Body = JSON.parse(run1Res.payload);
  console.log(`Run 1 generated ${run1Body.actions?.length} actions.`);

  console.log('\n=== Step 6: Second POST /api/agent/run ===');
  const run2Res = await app.inject({
    method: 'POST',
    url: '/api/agent/run',
    payload: {},
  });
  console.log('Run 2 status:', run2Res.statusCode);
  const run2Body = JSON.parse(run2Res.payload);
  console.log(`Run 2 returned ${run2Body.actions?.length} actions.`);

  console.log('\n=== Step 7: GET /api/actions?open=true (8 rows expected) ===');
  const openRes = await app.inject({
    method: 'GET',
    url: '/api/actions?open=true',
  });
  console.log('Open actions HTTP status:', openRes.statusCode);
  const openActions = JSON.parse(openRes.payload);
  console.log(`Open actions count: ${openActions.length}`);
  console.log('\n| # | Invoice ID | Type | Status | Reason (first 150 chars) | reasonDisplay | reasonSource |');
  console.log('| :- | :--- | :--- | :--- | :--- | :--- | :--- |');
  openActions.forEach((act: any, idx: number) => {
    const reason150 = (act.reason || '').slice(0, 150).replace(/\|/g, '\\|');
    const display100 = (act.reasonDisplay || '').slice(0, 100).replace(/\|/g, '\\|');
    const source = (act.reasonSource || '').replace(/\|/g, '\\|');
    console.log(`| ${idx + 1} | ${act.invoiceId} | ${act.type} | ${act.status} | ${reason150} | ${display100} | ${source} |`);
  });

  console.log('\n=== Step 8: POST /api/demo/simulate-payment on inv_001 ===');
  const payRes = await app.inject({
    method: 'POST',
    url: '/api/demo/simulate-payment',
    payload: { invoiceId: 'inv_001', amountCents: 350000 },
  });
  console.log('Simulate payment status:', payRes.statusCode);
  const payBody = JSON.parse(payRes.payload);
  console.log(`Payment confirmed: invoice status=${payBody.invoice?.status}, amountPaid=${payBody.invoice?.amountPaid}, cashBalance=${payBody.cashBalance}`);

  console.log('\n=== Step 9: GET /api/dashboard (confirm cash 1330000 and shortfall 0) ===');
  const dashRes = await app.inject({
    method: 'GET',
    url: '/api/dashboard',
  });
  console.log('Dashboard status:', dashRes.statusCode);
  const dashBody = JSON.parse(dashRes.payload);
  console.log('Dashboard KPIs:');
  console.log(`  cash: ${dashBody.kpis?.cash} (expected 1330000)`);
  console.log(`  shortfall: ${dashBody.kpis?.shortfall} (expected 0)`);
  console.log(`  overdueTotal: ${dashBody.kpis?.overdueTotal}`);
  console.log(`  overdueCount: ${dashBody.kpis?.overdueCount}`);
  console.log(`  lowest:`, dashBody.kpis?.lowest);

  await app.close();
  await closeDb();
  console.log('\n=== Live Check Complete ===');
}

runLiveCheck().catch((err) => {
  console.error('Live check failed:', err);
  process.exit(1);
});
