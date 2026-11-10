import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuditEvent, AuditActor } from '@settle/shared';
import { useAudit } from '../api/queries';
import { formatDate } from '../lib/format';
import { TEST_IDS } from '../testids';

export interface AuditTimelineProps {
  compact?: boolean;
  limit?: number;
}

const ACTOR_FILTERS: { label: string; value: 'all' | AuditActor }[] = [
  { label: 'All', value: 'all' },
  { label: 'Agent', value: 'agent' },
  { label: 'Owner', value: 'owner' },
  { label: 'PayPal', value: 'paypal' },
  { label: 'System', value: 'system' },
];

export const AuditTimeline: React.FC<AuditTimelineProps> = ({ compact = false, limit }) => {
  const { data: auditEvents = [], isLoading, error, refetch } = useAudit();
  const [selectedActor, setSelectedActor] = useState<'all' | AuditActor>('all');
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  // Sort newest first by ISO string comparison only
  const sortedEvents = useMemo(() => {
    const list = [...auditEvents];
    list.sort((a, b) => b.ts.localeCompare(a.ts));
    return list;
  }, [auditEvents]);

  // Filter by selected actor
  const filteredEvents = useMemo(() => {
    let list = sortedEvents;
    if (selectedActor !== 'all') {
      list = list.filter((e) => e.actor === selectedActor);
    }
    if (limit && limit > 0) {
      list = list.slice(0, limit);
    }
    return list;
  }, [sortedEvents, selectedActor, limit]);

  const toggleDetail = (id: string) => {
    setExpandedDetails((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const getActorBadgeClass = (actor: AuditActor) => {
    switch (actor) {
      case 'agent':
        return 'bg-blue-50 text-blue-800 border-blue-200';
      case 'owner':
        return 'bg-purple-50 text-purple-800 border-purple-200';
      case 'paypal':
        return 'bg-green-50 text-green-800 border-green-200';
      case 'system':
      default:
        return 'bg-slate-100 text-slate-700 border-border';
    }
  };

  const formatUtcTimestamp = (isoString: string) => {
    try {
      const datePart = isoString.slice(0, 10);
      const timePart = isoString.slice(11, 19);
      return `${formatDate(datePart)} at ${timePart} UTC`;
    } catch {
      return isoString;
    }
  };

  if (isLoading) {
    return (
      <div data-testid={TEST_IDS.auditList} className="space-y-3 animate-pulse">
        <div className="h-14 bg-surface border border-border rounded" />
        <div className="h-14 bg-surface border border-border rounded" />
        <div className="h-14 bg-surface border border-border rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid={TEST_IDS.auditList}
        className="p-6 bg-red-50 border border-red-200 rounded text-center space-y-3"
      >
        <div className="text-sm font-semibold text-status-red">Failed to load audit history</div>
        <p className="text-xs text-muted">{(error as Error)?.message || 'Network error'}</p>
        <button
          type="button"
          data-testid="audit-retry"
          onClick={() => refetch()}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-white border border-red-300 text-status-red hover:bg-red-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div data-testid={TEST_IDS.auditList} className="space-y-4">
      {/* Actor Filter Chips (omitted in compact mode) */}
      {!compact && (
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted mr-1">
            Filter:
          </span>
          {ACTOR_FILTERS.map((f) => {
            const isSelected = selectedActor === f.value;
            return (
              <button
                key={f.value}
                type="button"
                data-testid={TEST_IDS.auditFilter(f.value)}
                onClick={() => setSelectedActor(f.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  isSelected
                    ? 'bg-ink text-white border-ink'
                    : 'bg-surface text-muted border-border hover:text-ink hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {filteredEvents.length === 0 ? (
        <div className="p-8 bg-surface border border-border rounded text-center text-sm text-muted">
          No activity yet
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((event: AuditEvent) => {
            const hasDetail = event.detail !== undefined && event.detail !== null;
            const isExpanded = Boolean(expandedDetails[event.id]);

            return (
              <div
                key={event.id}
                data-testid={TEST_IDS.auditEvent(event.id)}
                className="bg-surface border border-border rounded p-4 space-y-2 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider border ${getActorBadgeClass(
                        event.actor,
                      )}`}
                    >
                      {event.actor}
                    </span>
                    <span className="text-muted font-mono">{event.kind}</span>
                  </div>
                  <time className="text-muted tabular">{formatUtcTimestamp(event.ts)}</time>
                </div>

                <p className="text-sm text-ink leading-relaxed font-normal">{event.summary}</p>

                <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                  {/* Link to invoice / action drawer */}
                  {event.actionId ? (
                    <button
                      type="button"
                      data-testid={`audit-action-${event.actionId}`}
                      onClick={() => navigate(`/?action=${event.actionId}`)}
                      className="text-accent hover:underline font-medium flex items-center gap-1"
                    >
                      <span>Action: {event.actionId}</span>
                      <span aria-hidden="true">&rarr;</span>
                    </button>
                  ) : event.invoiceId ? (
                    <button
                      type="button"
                      data-testid={`audit-invoice-${event.invoiceId}`}
                      onClick={() => navigate(`/?invoice=${event.invoiceId}`)}
                      className="text-accent hover:underline font-medium flex items-center gap-1"
                    >
                      <span>Invoice: {event.invoiceId}</span>
                      <span aria-hidden="true">&rarr;</span>
                    </button>
                  ) : null}

                  {/* Monospace PayPal request ID */}
                  {event.paypalRequestId && (
                    <span className="font-mono text-[11px] px-2 py-0.5 bg-slate-50 border border-border rounded text-slate-700">
                      PayPal: {event.paypalRequestId}
                    </span>
                  )}

                  {/* Expandable JSON Detail Viewer */}
                  {hasDetail && (
                    <button
                      type="button"
                      data-testid={`audit-toggle-detail-${event.id}`}
                      onClick={() => toggleDetail(event.id)}
                      className="text-muted hover:text-ink text-[11px] font-medium underline ml-auto"
                    >
                      {isExpanded ? 'Hide payload' : 'View payload'}
                    </button>
                  )}
                </div>

                {/* Collapsed Detail Drawer */}
                {hasDetail && isExpanded && (
                  <pre className="p-3 bg-slate-900 text-slate-100 rounded text-xs font-mono overflow-x-auto mt-2">
                    {JSON.stringify(event.detail, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

