export const TEST_IDS = {
  sandboxBadge: 'sandbox-badge',
  runSettle: 'run-settle',
  kpiCash: 'kpi-cash',
  kpiLowest: 'kpi-lowest',
  kpiShortfall: 'kpi-shortfall',
  kpiOverdue: 'kpi-overdue',
  breachBanner: 'breach-banner',
  gapClosedBanner: 'gap-closed-banner',
  balanceChart: 'balance-chart',
  worklist: 'worklist',
  drawer: 'drawer',
  approveButton: 'approve-button',
  rejectButton: 'reject-button',
  retryButton: 'retry-button',
  copilotToggle: 'copilot-toggle',
  copilotInput: 'copilot-input',
  copilotSend: 'copilot-send',
  auditList: 'audit-list',
  policyForm: 'policy-form',
  policySave: 'policy-save',
  impactCard: 'impact-card',
  demoReset: 'demo-reset',
  demoSimulatePayment: 'demo-simulate-payment',
  // Error overlay test IDs
  devErrorOverlay: 'dev-error-overlay',
  devErrorOverlayEndpoint: 'dev-error-overlay-endpoint',
  devErrorOverlayDetails: 'dev-error-overlay-details',
  devErrorOverlayDismiss: 'dev-error-overlay-dismiss',
  // Connection indicator
  connectionStatus: 'connection-status',
} as const;

export type TestIdKey = keyof typeof TEST_IDS;

