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
  audit: () => '/api/audit',
  policy: () => '/api/policy',
  chat: () => '/api/chat',
  events: () => '/api/events',
  demoReset: () => '/api/demo/reset',
  demoSimulatePayment: () => '/api/demo/simulate-payment',
} as const;

