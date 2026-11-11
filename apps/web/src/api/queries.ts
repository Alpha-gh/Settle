import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type {
  Snapshot,
  ForecastResult,
  Kpis,
  ActionRecord,
  AuditEvent,
  Policy,
  AgentRunResult,
  ChatAnswer,
} from '@settle/shared';
import { ENDPOINTS } from './endpoints';
import { apiRequest } from './client';
import {
  dashboardResponseSchema,
  actionRecordSchema,
  auditEventSchema,
  policySchema,
  agentRunResultSchema,
  agentStatusSchema,
  chatAnswerSchema,
  type DashboardResponse,
  type AgentStatus,
} from './schemas';
import {
  deriveImpactSummary,
  type ImpactSummary,
} from './impactAdapter';

export const QUERY_KEYS = {
  dashboard: ['dashboard'] as const,
  snapshot: ['dashboard'] as const,
  forecast: ['dashboard'] as const,
  kpis: ['dashboard'] as const,
  actions: ['actions'] as const,
  audit: ['audit'] as const,
  policy: ['policy'] as const,
  impact: ['impact'] as const,
  agentStatus: ['agentStatus'] as const,
};

export function useDashboard() {
  return useQuery<DashboardResponse>({
    queryKey: QUERY_KEYS.dashboard,
    queryFn: () => apiRequest(ENDPOINTS.dashboard(), dashboardResponseSchema),
  });
}

export function useSnapshot() {
  return useQuery<DashboardResponse, Error, Snapshot>({
    queryKey: QUERY_KEYS.dashboard,
    queryFn: () => apiRequest(ENDPOINTS.dashboard(), dashboardResponseSchema),
    select: (dashboard): Snapshot => ({
      business: dashboard.business,
      payers: dashboard.payers,
      invoices: dashboard.invoices,
      obligations: dashboard.obligations,
      policy: dashboard.policy ?? {
        maxDiscountPct: 0,
        maxInstalments: 1,
        autoApproveMaxAmount: 0,
        requireApprovalFor: [],
        quietHours: { startHour: 0, endHour: 0 },
        maxRemindersPerInvoicePerWeek: 0,
      },
    }),
  });
}

export function useForecast() {
  return useQuery<DashboardResponse, Error, ForecastResult>({
    queryKey: QUERY_KEYS.dashboard,
    queryFn: () => apiRequest(ENDPOINTS.dashboard(), dashboardResponseSchema),
    select: (dashboard) => dashboard.forecast,
  });
}

export function useKpis() {
  return useQuery<DashboardResponse, Error, Kpis>({
    queryKey: QUERY_KEYS.dashboard,
    queryFn: () => apiRequest(ENDPOINTS.dashboard(), dashboardResponseSchema),
    select: (dashboard) => dashboard.kpis,
  });
}

export function useActions() {
  return useQuery<ActionRecord[]>({
    queryKey: QUERY_KEYS.actions,
    queryFn: () => apiRequest(ENDPOINTS.actions(), z.array(actionRecordSchema)),
  });
}

export function useAudit() {
  return useQuery<AuditEvent[]>({
    queryKey: QUERY_KEYS.audit,
    queryFn: () => apiRequest(ENDPOINTS.audit(), z.array(auditEventSchema)),
  });
}

export function usePolicy() {
  return useQuery<Policy>({
    queryKey: QUERY_KEYS.policy,
    queryFn: () => apiRequest(ENDPOINTS.policy(), policySchema),
  });
}

export function useImpact() {
  const queryClient = useQueryClient();

  return useQuery<ImpactSummary>({
    queryKey: QUERY_KEYS.impact,
    queryFn: () => {
      const actions = queryClient.getQueryData<ActionRecord[]>(QUERY_KEYS.actions) || [];
      const forecast = queryClient.getQueryData<ForecastResult>(QUERY_KEYS.forecast);
      if (forecast) {
        return deriveImpactSummary(actions, forecast);
      }
      return {
        cashRecovered: 0,
        projectedShortfallClosed: 0,
        actionsCount: 0,
        actionsExecuted: 0,
        gapClosed: false,
      };
    },
  });
}

export function useAgentStatus(enabled = false) {
  return useQuery<AgentStatus>({
    queryKey: QUERY_KEYS.agentStatus,
    queryFn: () => apiRequest(ENDPOINTS.agentStatus(), agentStatusSchema),
    enabled,
    refetchInterval: enabled ? 2000 : false,
  });
}

export function useRunAgent() {
  const queryClient = useQueryClient();
  return useMutation<AgentRunResult, Error>({
    mutationFn: () => apiRequest(ENDPOINTS.agentRun(), agentRunResultSchema, { method: 'POST', body: '{}' }),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEYS.actions, data.actions);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.actions });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.impact });
    },
  });
}

export function useApproveAction() {
  const queryClient = useQueryClient();
  return useMutation<ActionRecord, Error, { id: string; note?: string }>({
    mutationFn: ({ id, note }) =>
      apiRequest(ENDPOINTS.actionApprove(id), actionRecordSchema, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ActionRecord[]>(QUERY_KEYS.actions, (old = []) =>
        old.map((a) => (a.id === updated.id ? updated : a)),
      );
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.actions });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit });
    },
  });
}
export const useApprove = useApproveAction;

export function useRejectAction() {
  const queryClient = useQueryClient();
  return useMutation<ActionRecord, Error, { id: string; note?: string }>({
    mutationFn: ({ id, note }) =>
      apiRequest(ENDPOINTS.actionReject(id), actionRecordSchema, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ActionRecord[]>(QUERY_KEYS.actions, (old = []) =>
        old.map((a) => (a.id === updated.id ? updated : a)),
      );
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.actions });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit });
    },
  });
}
export const useReject = useRejectAction;

export function useUpdatePolicy() {
  const queryClient = useQueryClient();
  return useMutation<Policy, Error, Policy>({
    mutationFn: (newPolicy) =>
      apiRequest(ENDPOINTS.policy(), policySchema, {
        method: 'PUT',
        body: JSON.stringify(newPolicy),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEYS.policy, updated);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
    },
  });
}

export function useChat() {
  return useMutation<ChatAnswer, Error, { question: string }>({
    mutationFn: ({ question }) =>
      apiRequest(ENDPOINTS.chat(), chatAnswerSchema, {
        method: 'POST',
        body: JSON.stringify({ question }),
      }),
  });
}

export const provisionPayPalResponseSchema = z
  .object({
    provisioned: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    remaining: z.number().int(),
    failures: z.array(z.unknown()),
  })
  .passthrough();

export type ProvisionPayPalResult = z.infer<typeof provisionPayPalResponseSchema>;

export const demoResetResponseSchema = z
  .object({
    status: z.string(),
    provisioning: provisionPayPalResponseSchema.optional(),
  })
  .passthrough();

export type DemoResetResult = z.infer<typeof demoResetResponseSchema>;

export function useDemoReset() {
  const queryClient = useQueryClient();
  return useMutation<DemoResetResult, Error>({
    mutationFn: () =>
      apiRequest(
        ENDPOINTS.demoReset(),
        demoResetResponseSchema,
        { method: 'POST', body: '{}' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}

export function useDemoProvisionPayPal() {
  return useMutation<ProvisionPayPalResult, Error>({
    mutationFn: () =>
      apiRequest(
        ENDPOINTS.demoProvisionPayPal(),
        provisionPayPalResponseSchema,
        { method: 'POST', body: '{}' },
      ),
  });
}

export function useDemoSimulatePayment() {
  const queryClient = useQueryClient();
  return useMutation<
    { status: string; invoice?: unknown; cashBalance?: number },
    Error,
    { invoiceId: string; amount?: number }
  >({
    mutationFn: ({ invoiceId, amount }) =>
      apiRequest(
        ENDPOINTS.demoSimulatePayment(),
        z.object({
          status: z.string(),
          invoice: z.unknown().optional(),
          cashBalance: z.number().int().optional(),
        }).passthrough(),
        {
          method: 'POST',
          body: JSON.stringify({ invoiceId, amount }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.actions });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.impact });
    },
  });
}

