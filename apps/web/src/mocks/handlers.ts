import { http, HttpResponse, delay } from 'msw';
import { mockState } from './state';
import { deriveImpactSummary } from '../api/impactAdapter';
import type { Policy } from '@settle/shared';

const getLatency = (): number => {
  const envVal = import.meta.env.VITE_MOCK_LATENCY_MS;
  if (envVal !== undefined && envVal !== '') {
    const parsed = Number(envVal);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 250;
};

export const handlers = [
  // 0. GET /api/dashboard
  http.get('/api/dashboard', async ({ request }) => {
    await delay(getLatency());
    const url = new URL(request.url);
    const use200 = url.searchParams.get('mockInvoices') === '200';
    return HttpResponse.json(mockState.getDashboard(use200));
  }),

  // 1. GET /api/snapshot (legacy/test compatibility)
  http.get('/api/snapshot', async ({ request }) => {
    await delay(getLatency());
    const url = new URL(request.url);
    const use200 = url.searchParams.get('mockInvoices') === '200';
    return HttpResponse.json(mockState.getSnapshot(use200));
  }),

  // 2. GET /api/forecast
  http.get('/api/forecast', async () => {
    await delay(getLatency());
    return HttpResponse.json(mockState.forecast);
  }),

  // 3. GET /api/kpis
  http.get('/api/kpis', async () => {
    await delay(getLatency());
    return HttpResponse.json(mockState.kpis);
  }),

  // 4. GET /api/actions
  http.get('/api/actions', async () => {
    await delay(getLatency());
    return HttpResponse.json(mockState.actions);
  }),

  // 5. POST /api/agent/run (1500 ms delay per spec)
  http.post('/api/agent/run', async () => {
    await delay(1500);
    const result = mockState.runAgent();
    return HttpResponse.json(result);
  }),

  // 6. POST /api/actions/:id/approve
  http.post('/api/actions/:id/approve', async ({ params, request }) => {
    await delay(getLatency());
    const id = params['id'] as string;
    let body: { note?: string } = {};
    try {
      body = (await request.json()) as { note?: string };
    } catch {
      // Body is optional
    }
    const approved = mockState.approveAction(id, body?.note);
    return HttpResponse.json(approved);
  }),

  // 7. POST /api/actions/:id/reject
  http.post('/api/actions/:id/reject', async ({ params, request }) => {
    await delay(getLatency());
    const id = params['id'] as string;
    let body: { note?: string } = {};
    try {
      body = (await request.json()) as { note?: string };
    } catch {
      // Body is optional
    }
    const rejected = mockState.rejectAction(id, body?.note);
    return HttpResponse.json(rejected);
  }),

  // 8. POST /api/actions/:id/retry
  http.post('/api/actions/:id/retry', async ({ params }) => {
    await delay(getLatency());
    const id = params['id'] as string;
    const retried = mockState.retryAction(id);
    return HttpResponse.json(retried);
  }),

  // 9. GET /api/audit
  http.get('/api/audit', async () => {
    await delay(getLatency());
    return HttpResponse.json(mockState.audit);
  }),

  // 10. GET /api/policy
  http.get('/api/policy', async () => {
    await delay(getLatency());
    return HttpResponse.json(mockState.policy);
  }),

  // 11. PUT /api/policy
  http.put('/api/policy', async ({ request }) => {
    await delay(getLatency());
    const newPolicy = (await request.json()) as Policy;
    const updated = mockState.updatePolicy(newPolicy);
    return HttpResponse.json(updated);
  }),

  // 12. POST /api/chat
  http.post('/api/chat', async ({ request }) => {
    await delay(getLatency());
    const body = (await request.json()) as { question: string };
    const answer = mockState.chat(body.question);
    return HttpResponse.json(answer);
  }),

  // 13. GET /api/impact
  http.get('/api/impact', async () => {
    await delay(getLatency());
    const impact = deriveImpactSummary(mockState.actions, mockState.forecast);
    return HttpResponse.json(impact);
  }),

  // 14. POST /api/demo/reset
  http.post('/api/demo/reset', async () => {
    await delay(getLatency());
    mockState.reset();
    return HttpResponse.json({ status: 'ok' });
  }),

  // 15. POST /api/demo/simulate-payment
  http.post('/api/demo/simulate-payment', async ({ request }) => {
    await delay(getLatency());
    const body = (await request.json()) as { invoiceId: string; amount?: number };
    const result = mockState.simulatePayment(body.invoiceId, body.amount);
    return HttpResponse.json(result);
  }),
];

