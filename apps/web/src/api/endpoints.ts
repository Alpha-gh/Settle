/**
 * The ONLY file in apps/web that knows URL paths.
 * Every network call must reference these constants or helpers.
 */

export const ENDPOINTS = {
  dashboard: () => '/api/dashboard',
  actions: () => '/api/actions',
  agentRun: () => '/api/agent/run',
  actionApprove: (id: string) => `/api/actions/${encodeURIComponent(id)}/approve`,
  actionReject: (id: string) => `/api/actions/${encodeURIComponent(id)}/reject`,
  actionRetry: (id: string) => `/api/actions/${encodeURIComponent(id)}/retry`,
  audit: () => '/api/audit',
  policy: () => '/api/policy',
  chat: () => '/api/chat',
  events: () => '/api/events',
  impact: () => '/api/impact',
  demoReset: () => '/api/demo/reset',
  demoSimulatePayment: (invoiceId: string) => `/api/demo/simulate-payment/${encodeURIComponent(invoiceId)}`,
} as const;

