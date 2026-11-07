import React, { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ActionRecord, Invoice, Payer, Cents } from '@settle/shared';
import { TEST_IDS } from '../testids';
import { formatUsd, formatDate, humanizeStatus } from '../lib/format';
import { useApproveAction, useRejectAction, useRetryAction } from '../api/queries';
import { BalanceChart } from './BalanceChart';

export interface ActionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  action?: ActionRecord;
  invoice?: Invoice;
  payer?: Payer;
  reserve?: Cents;
  lastFocusedElement?: HTMLElement | null;
}

export const ActionDrawer: React.FC<ActionDrawerProps> = ({
  isOpen,
  onClose,
  action,
  invoice,
  payer,
  reserve = 500000,
  lastFocusedElement,
}) => {
  const isSubmittingRef = useRef(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const approveMutation = useApproveAction();
  const rejectMutation = useRejectAction();
  const retryMutation = useRetryAction();

  const isPending =
    approveMutation.isPending || rejectMutation.isPending || retryMutation.isPending;

  const handleApprove = () => {
    if (!action || isSubmittingRef.current || isPending) return;
    isSubmittingRef.current = true;
    setMutationError(null);

    approveMutation.mutate(
      { id: action.id },
      {
        onError: (err) => {
          setMutationError(err.message || 'Failed to approve action');
        },
        onSettled: () => {
          isSubmittingRef.current = false;
        },
      },
    );
  };

  const handleReject = () => {
    if (!action || isSubmittingRef.current || isPending) return;
    isSubmittingRef.current = true;
    setMutationError(null);

    rejectMutation.mutate(
      { id: action.id },
      {
        onError: (err) => {
          setMutationError(err.message || 'Failed to reject action');
        },
        onSettled: () => {
          isSubmittingRef.current = false;
        },
      },
    );
  };

  const handleRetry = () => {
    if (!action || isSubmittingRef.current || isPending) return;
    isSubmittingRef.current = true;
    setMutationError(null);

    retryMutation.mutate(
      { id: action.id },
      {
        onError: (err) => {
          setMutationError(err.message || 'Failed to retry action');
        },
        onSettled: () => {
          isSubmittingRef.current = false;
        },
      },
    );
  };

  // Status badge styling per AGENT_RULES (Rule 8)
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'AWAITING_APPROVAL':
        return 'bg-amber-50 text-amber-900 border border-amber-300';
      case 'EXECUTED':
      case 'PAID':
        return 'bg-green-50 text-green-900 border border-green-300';
      case 'BLOCKED':
      case 'FAILED':
        return 'bg-red-50 text-red-900 border border-red-300';
      case 'APPROVED':
        return 'bg-blue-50 text-blue-900 border border-blue-200';
      case 'PARTIALLY_PAID':
        return 'bg-amber-50 text-amber-900 border border-amber-300';
      default:
        return 'bg-slate-100 text-muted border border-border';
    }
  };

  const displayStatus = action ? action.status : invoice?.status ?? 'UNKNOWN';

  return (
    <Dialog.Root
      open={isOpen}
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Content
          data-testid={TEST_IDS.drawer}
          onCloseAutoFocus={(e) => {
            if (lastFocusedElement) {
              e.preventDefault();
              lastFocusedElement.focus();
            }
          }}
          className="fixed top-0 right-0 h-full w-[480px] max-w-full bg-surface border-l border-border shadow-none z-50 overflow-y-auto p-6 focus:outline-none flex flex-col justify-between"
          aria-describedby="drawer-description"
        >
          <div className="space-y-6">
            {/* Header: invoice number, payer, amount, status pill, close button */}
            <div className="flex items-start justify-between pb-4 border-b border-border">
              <div>
                <Dialog.Title className="text-xl font-bold font-mono tracking-tight text-ink">
                  {invoice?.number ?? 'Invoice'}
                </Dialog.Title>
                <Dialog.Description id="drawer-description" className="text-sm text-muted mt-0.5">
                  {payer?.name ?? 'Unknown payer'} &bull;{' '}
                  <span className="tabular font-medium text-ink">
                    {invoice ? formatUsd(invoice.amount) : '—'}
                  </span>
                </Dialog.Description>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`inline-block px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wider ${getStatusBadgeClass(
                    displayStatus,
                  )}`}
                >
                  {humanizeStatus(displayStatus)}
                </span>
                <Dialog.Close asChild>
                  <button
                    data-testid={TEST_IDS.drawerClose}
                    className="p-1 rounded text-muted hover:text-ink hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
                    aria-label="Close drawer"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </Dialog.Close>
              </div>
            </div>

            {/* Agent Reason: verbatim reason labelled "Why Settle proposes this" */}
            <section
              data-testid={TEST_IDS.drawerReason}
              aria-labelledby="agent-reason-label"
              className="space-y-1.5 bg-slate-50 border border-border rounded p-4"
            >
              <div
                id="agent-reason-label"
                className="text-xs font-semibold text-muted uppercase tracking-wider"
              >
                Why Settle proposes this
              </div>
              <p className="text-sm text-ink leading-relaxed">
                {action?.reason ??
                  'No proposed action. This invoice was evaluated without active recovery required.'}
              </p>
            </section>

            {/* Option Details */}
            {action && (
              <section className="space-y-2">
                <div className="text-xs font-semibold text-muted uppercase tracking-wider">
                  Proposed Option Details
                </div>
                <div className="p-3 bg-surface border border-border rounded text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted">Type:</span>
                    <span className="font-medium text-ink">{humanizeStatus(action.type)}</span>
                  </div>
                  {action.params.discountPct !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-muted">Early settlement discount:</span>
                      <span className="font-semibold text-accent tabular">
                        {action.params.discountPct}%
                      </span>
                    </div>
                  )}
                  {action.params.instalments && (
                    <div className="flex justify-between">
                      <span className="text-muted">Instalment plan:</span>
                      <span className="font-medium text-ink tabular">
                        {action.params.instalments.count} instalments spaced{' '}
                        {action.params.instalments.spacingDays} days apart
                      </span>
                    </div>
                  )}
                  {action.params.note && (
                    <div className="pt-1 text-xs text-muted border-t border-border mt-1">
                      {action.params.note}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Baseline vs Scenario mini chart */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                  Impact Simulation
                </span>
                {action?.simulation?.closesGap && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-800 border border-green-200">
                    Closes the gap
                  </span>
                )}
              </div>

              {action?.simulation ? (
                <div className="space-y-3">
                  <div className="bg-surface border border-border rounded p-3">
                    <BalanceChart
                      forecast={action.simulation.baseline}
                      reserve={reserve}
                      scenario={action.simulation.scenario}
                      scenarioLabel="Scenario"
                      height={200}
                      compact
                    />
                  </div>

                  {/* Metric row: cashCost, lowestDelta, shortfallDelta */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 bg-slate-50 border border-border rounded">
                      <div className="text-[11px] text-muted">Cash given up</div>
                      <div className="text-sm font-semibold tabular text-ink">
                        {formatUsd(action.simulation.cashCost)}
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 border border-border rounded">
                      <div className="text-[11px] text-muted">Lowest balance Δ</div>
                      <div className="text-sm font-semibold tabular text-green-700">
                        {action.simulation.lowestDelta > 0
                          ? `+${formatUsd(action.simulation.lowestDelta)}`
                          : formatUsd(action.simulation.lowestDelta)}
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 border border-border rounded">
                      <div className="text-[11px] text-muted">Shortfall Δ</div>
                      <div className="text-sm font-semibold tabular text-ink">
                        {formatUsd(action.simulation.shortfallDelta)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 border border-dashed border-border rounded text-center text-xs text-muted">
                  No simulation attached
                </div>
              )}
            </section>

            {/* Assumptions list */}
            <section
              data-testid={TEST_IDS.drawerAssumptions}
              aria-labelledby="drawer-assumptions-label"
              className="space-y-1.5"
            >
              <div
                id="drawer-assumptions-label"
                className="text-xs font-semibold text-muted uppercase tracking-wider"
              >
                Simulation Assumptions
              </div>
              {action?.simulation?.assumptions && action.simulation.assumptions.length > 0 ? (
                <ul className="list-disc pl-5 space-y-1 text-xs text-muted">
                  {action.simulation.assumptions.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted italic">No specific assumptions recorded.</p>
              )}
            </section>

            {/* Policy verdict panel */}
            {action && (
              <section
                data-testid={TEST_IDS.drawerPolicy}
                aria-labelledby="drawer-policy-label"
                className={`p-4 rounded border text-sm space-y-2 ${
                  action.status === 'BLOCKED' || !action.policy.allowed
                    ? 'bg-red-50/50 border-red-200'
                    : 'bg-slate-50 border-border'
                }`}
              >
                <div
                  id="drawer-policy-label"
                  className="text-xs font-semibold text-muted uppercase tracking-wider"
                >
                  Policy Safety Review
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted">Policy Status:</span>
                    <span
                      className={`font-medium ${
                        action.policy.allowed ? 'text-green-700' : 'text-red-700'
                      }`}
                    >
                      {action.policy.allowed ? 'Allowed by rules' : 'Blocked by policy'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Review Requirement:</span>
                    <span className="font-medium text-ink">
                      {action.policy.requiresApproval ? 'Human review required' : 'Auto-executable'}
                    </span>
                  </div>
                </div>

                {/* Violations */}
                {action.policy.violations && action.policy.violations.length > 0 && (
                  <div className="pt-2 border-t border-red-200 text-xs text-red-700 space-y-1">
                    <div className="font-semibold">Violations:</div>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {action.policy.violations.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {action.status === 'BLOCKED' && (
                  <div className="mt-2 text-xs font-semibold text-red-700">
                    Blocked by policy. Settle cannot override this.
                  </div>
                )}
              </section>
            )}

            {/* Status Timeline */}
            {action && (
              <section
                data-testid={TEST_IDS.drawerTimeline}
                aria-labelledby="drawer-timeline-label"
                className="space-y-3 pt-2 border-t border-border"
              >
                <div
                  id="drawer-timeline-label"
                  className="text-xs font-semibold text-muted uppercase tracking-wider"
                >
                  Status Timeline
                </div>

                <div className="space-y-3 text-xs">
                  {/* Step 1: PROPOSED */}
                  <div className="flex items-start gap-3">
                    <span
                      className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${
                        action.status !== 'REJECTED' && action.status !== 'BLOCKED'
                          ? 'bg-accent'
                          : 'bg-muted'
                      }`}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-ink">Proposed by agent</div>
                      <div className="text-[11px] text-muted">
                        {formatDate(action.createdAt.slice(0, 10))} &bull;{' '}
                        {action.createdAt.slice(11, 16)} UTC
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Intermediate: APPROVED / REJECTED / BLOCKED / AWAITING */}
                  {action.status === 'AWAITING_APPROVAL' && (
                    <div className="flex items-start gap-3">
                      <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0 bg-amber-500 animate-pulse" />
                      <div className="flex-1">
                        <div className="font-medium text-amber-800">Awaiting human review</div>
                        <div className="text-[11px] text-muted">Approval required before execution</div>
                      </div>
                    </div>
                  )}

                  {action.status === 'APPROVED' && (
                    <div className="flex items-start gap-3">
                      <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0 bg-blue-600" />
                      <div className="flex-1">
                        <div className="font-medium text-blue-900">
                          Approved, waiting for PayPal
                        </div>
                        <div className="text-[11px] text-muted">
                          Decided by {action.decidedBy ?? 'owner'}
                        </div>
                      </div>
                    </div>
                  )}

                  {action.status === 'REJECTED' && (
                    <div className="flex items-start gap-3">
                      <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0 bg-slate-400" />
                      <div className="flex-1">
                        <div className="font-medium text-muted">Rejected by owner</div>
                        <div className="text-[11px] text-muted">Action dismissed</div>
                      </div>
                    </div>
                  )}

                  {action.status === 'BLOCKED' && (
                    <div className="flex items-start gap-3">
                      <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0 bg-red-600" />
                      <div className="flex-1">
                        <div className="font-medium text-red-700">Blocked by policy</div>
                        <div className="text-[11px] text-muted">Guardrail violation</div>
                      </div>
                    </div>
                  )}

                  {/* Step 3: Terminal: EXECUTED / FAILED */}
                  {action.status === 'EXECUTED' && (
                    <div className="flex items-start gap-3">
                      <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0 bg-green-600" />
                      <div className="flex-1">
                        <div className="font-medium text-green-900">Executed via PayPal</div>
                        {action.executedAt && (
                          <div className="text-[11px] text-muted">
                            {formatDate(action.executedAt.slice(0, 10))} &bull;{' '}
                            {action.executedAt.slice(11, 16)} UTC
                          </div>
                        )}
                        {action.paypalRequestId && (
                          <div className="text-[11px] font-mono text-muted mt-0.5">
                            PayPal Request: {action.paypalRequestId}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {action.status === 'FAILED' && (
                    <div className="flex items-start gap-3">
                      <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0 bg-red-600" />
                      <div className="flex-1">
                        <div className="font-medium text-red-700">Execution failed</div>
                        {action.error && (
                          <div className="text-[11px] text-red-600 mt-0.5">{action.error}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* Bottom Actions area */}
          <div className="pt-6 border-t border-border mt-6 space-y-3">
            {mutationError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 p-2 rounded">
                {mutationError}
              </div>
            )}

            {/* AWAITING_APPROVAL buttons */}
            {action?.status === 'AWAITING_APPROVAL' && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  data-testid={TEST_IDS.approveButton}
                  onClick={handleApprove}
                  disabled={isPending}
                  className="flex-1 py-2 px-4 rounded text-sm font-semibold bg-accent text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {approveMutation.isPending ? 'Approving...' : 'Approve'}
                </button>
                <button
                  type="button"
                  data-testid={TEST_IDS.rejectButton}
                  onClick={handleReject}
                  disabled={isPending}
                  className="py-2 px-4 rounded text-sm font-semibold bg-surface text-ink border border-border hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
                </button>
              </div>
            )}

            {/* FAILED action retry button */}
            {action?.status === 'FAILED' && (
              <button
                type="button"
                data-testid={TEST_IDS.retryButton}
                onClick={handleRetry}
                disabled={isPending}
                className="w-full py-2 px-4 rounded text-sm font-semibold bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {retryMutation.isPending ? 'Retrying...' : 'Retry Execution'}
              </button>
            )}

            {/* Read-only / terminal state indicator */}
            {(!action ||
              (action.status !== 'AWAITING_APPROVAL' && action.status !== 'FAILED')) && (
              <div className="text-center text-xs text-muted">
                {action?.status === 'BLOCKED'
                  ? 'No actions available for blocked proposal.'
                  : action?.status === 'EXECUTED'
                  ? 'Action completed.'
                  : action?.status === 'REJECTED'
                  ? 'Action rejected.'
                  : 'Read-only view.'}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
