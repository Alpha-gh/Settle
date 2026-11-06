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
  snapshotSchema,
  forecastResultSchema,
  kpisSchema,
  actionRecordSchema,
  auditEventSchema,
  policySchema,
  agentRunResultSchema,
  chatAnswerSchema,
} from './schemas';
import {
  impactSummarySchema,
  deriveImpactSummary,
  type ImpactSummary,
} from './impactAdapter';

export const QUERY_KEYS = {
  snapshot: ['snapshot'] as const,
  forecast: ['forecast'] as const,
  kpis: ['kpis'] as const,
  actions: ['actions'] as const,
  audit: ['audit'] as const,
  policy: ['policy'] as const,
  impact: ['impact'] as const,
};

export function useSnapshot() {
  return useQuery<Snapshot>({
    queryKey: QUERY_KEYS.snapshot,
    queryFn: () => apiRequest(ENDPOINTS.snapshot(), snapshotSchema),
  });
}

export function useForecast() {
  return useQuery<ForecastResult>({
    queryKey: QUERY_KEYS.forecast,
    queryFn: () => apiRequest(ENDPOINTS.forecast(), forecastResultSchema),
  });
}

export function useKpis() {
  return useQuery<Kpis>({
    queryKey: QUERY_KEYS.kpis,
    queryFn: () => apiRequest(ENDPOINTS.kpis(), kpisSchema),
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
    mutationFn: () => apiRequest(ENDPOINTS.agentRun(), agentRunResultSchema, { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEYS.actions, data.actions);
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
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.actions });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit });
    },
  });
}

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
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.actions });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit });
    },
  });
}

export function useRetryAction() {
  const queryClient = useQueryClient();
  return useMutation<ActionRecord, Error, { id: string }>({
    mutationFn: ({ id }) =>
      apiRequest(ENDPOINTS.actionRetry(id), actionRecordSchema, {
        method: 'POST',
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ActionRecord[]>(QUERY_KEYS.actions, (old = []) =>
        old.map((a) => (a.id === updated.id ? updated : a)),
      );
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.actions });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit });
    },
  });
}

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
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.snapshot });
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
        { method: 'POST' },
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
    { invoiceId: string }
  >({
    mutationFn: ({ invoiceId }) =>
      apiRequest(
        ENDPOINTS.demoSimulatePayment(invoiceId),
        z.object({
          status: z.string(),
          invoice: z.unknown().optional(),
          cashBalance: z.number().int().optional(),
        }),
        { method: 'POST' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.snapshot });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.forecast });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.kpis });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.impact });
    },
  });
}

