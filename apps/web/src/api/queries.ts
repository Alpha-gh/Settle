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
  chatAnswerSchema,
  type DashboardResponse,
} from './schemas';
import {
  impactSummarySchema,
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
    queryFn: async () => {
      try {
        return await apiRequest(ENDPOINTS.impact(), impactSummarySchema);
      } catch (err: unknown) {
        // Fallback: If 404, derive client-side using engine-provided cents from query cache
        const actions = queryClient.getQueryData<ActionRecord[]>(QUERY_KEYS.actions) || [];
        const forecast = queryClient.getQueryData<ForecastResult>(QUERY_KEYS.forecast);
        if (forecast) {
          return deriveImpactSummary(actions, forecast);
        }
        throw err;
      }
    },
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

export function useRetryAction() {
  const queryClient = useQueryClient();
  return useMutation<ActionRecord, Error, { id: string }>({
    mutationFn: ({ id }) =>
      apiRequest(ENDPOINTS.actionApprove(id), actionRecordSchema, {
        method: 'POST',
        body: '{}',
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
export const useRetry = useRetryAction;

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

export function useDemoReset() {
  const queryClient = useQueryClient();
  return useMutation<{ status: string }, Error>({
    mutationFn: () =>
      apiRequest(
        ENDPOINTS.demoReset(),
        z.object({ status: z.string() }),
        { method: 'POST', body: '{}' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
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

