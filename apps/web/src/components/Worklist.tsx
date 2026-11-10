import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  GridReadyEvent,
  RowClickedEvent,
  CellKeyDownEvent,
  RowClassRules,
  IRowNode,
  GridApi,
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

import { useSnapshot, useActions } from '../api/queries';
import { selectWorklistRows, type WorklistRow } from '../api/selectors';
import { useSelectedAction } from '../state/selection';
import { formatUsd, formatDateShort, humanizeStatus, riskToPercent } from '../lib/format';
import { TEST_IDS } from '../testids';
import { ActionDrawer } from './ActionDrawer';
import { mockEventBus } from '../api/bus';

// --- Custom Cell Renderers (Memoized for high-performance virtualized rendering) ---

interface CellRendererParams<T = unknown> {
  value: T;
  data: WorklistRow;
}

const InvoiceNumberRenderer = React.memo(({ data }: CellRendererParams) => {
  if (!data) return null;
  return (
    <div
      data-testid={TEST_IDS.worklistRow(data.id)}
      className="flex items-center h-full font-mono font-medium text-ink"
    >
      {data.invoice.number}
    </div>
  );
});
InvoiceNumberRenderer.displayName = 'InvoiceNumberRenderer';

const DaysOverdueRenderer = React.memo(({ data }: CellRendererParams) => {
  if (!data) return null;
  const isOverdue = data.daysOverdue > 0 && data.invoice.status !== 'PAID';
  return (
    <div className="flex items-center h-full tabular">
      {isOverdue ? (
        <span className="text-status-red font-medium">{data.daysOverdue} days</span>
      ) : (
        <span className="text-muted">{data.daysOverdue === 0 ? '0 days' : `${data.daysOverdue} days`}</span>
      )}
    </div>
  );
});
DaysOverdueRenderer.displayName = 'DaysOverdueRenderer';

const InvoiceStatusRenderer = React.memo(({ data }: CellRendererParams) => {
  if (!data) return null;
  const status = data.invoice.status;
  let colorClasses = 'bg-slate-100 text-muted border border-border';
  if (status === 'PAID') {
    colorClasses = 'bg-green-50 text-green-900 border border-green-300';
  } else if (status === 'PARTIALLY_PAID') {
    colorClasses = 'bg-amber-50 text-amber-900 border border-amber-300';
  }

  return (
    <div className="flex items-center h-full">
      <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${colorClasses}`}>
        {humanizeStatus(status)}
      </span>
    </div>
  );
});
InvoiceStatusRenderer.displayName = 'InvoiceStatusRenderer';

const PayerRiskRenderer = React.memo(({ data }: CellRendererParams) => {
  if (!data) return null;
  const risk = data.payer?.latenessRisk ?? 0;
  const persona = data.payer?.persona ?? 'unknown';
  const riskPercent = riskToPercent(risk);

  return (
    <div
      className="flex items-center gap-2 h-full w-full"
      aria-label={`Lateness risk ${riskPercent}%, persona ${persona}`}
      role="meter"
      aria-valuenow={riskPercent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden shrink-0">
        <div
          className="h-full bg-slate-500 rounded-full"
          style={{ width: `${Math.min(100, Math.max(0, riskPercent))}%` }}
        />
      </div>
      <span className="text-xs text-muted capitalize truncate">{persona}</span>
    </div>
  );
});
PayerRiskRenderer.displayName = 'PayerRiskRenderer';

const ProposedActionRenderer = React.memo(({ data }: CellRendererParams) => {
  if (!data) return null;
  const action = data.action;

  if (!action) {
    return (
      <div className="flex items-center h-full">
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-muted border border-border">
          No action
        </span>
      </div>
    );
  }

  let colorClasses = 'bg-slate-100 text-muted border border-border';
  if (action.status === 'AWAITING_APPROVAL') {
    colorClasses = 'bg-amber-50 text-amber-900 border border-amber-300';
  } else if (action.status === 'EXECUTED') {
    colorClasses = 'bg-green-50 text-green-900 border border-green-300';
  } else if (action.status === 'BLOCKED' || action.status === 'FAILED') {
    colorClasses = 'bg-red-50 text-red-900 border border-red-300';
  }

  return (
    <div className="flex items-center h-full">
      <span className={`px-2 py-0.5 rounded text-xs font-medium truncate ${colorClasses}`}>
        {humanizeStatus(action.type)} &mdash; {humanizeStatus(action.status)}
      </span>
    </div>
  );
});
ProposedActionRenderer.displayName = 'ProposedActionRenderer';

// --- Component Props ---
export interface WorklistProps {
  height?: number | string;
  compact?: boolean;
}

export const Worklist: React.FC<WorklistProps> = ({ height = 440 }) => {
  const { data: snapshot, isLoading: loadingSnapshot, error: snapshotError, refetch: refetchSnapshot } =
    useSnapshot();
  const { data: actions = [], isLoading: loadingActions, error: actionsError, refetch: refetchActions } =
    useActions();

  const { selectedActionId, selectedInvoiceId, setSelectedActionId, setSelectedInvoiceId, clearSelection } =
    useSelectedAction();

  const gridApiRef = useRef<GridApi<WorklistRow> | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const [gridReady, setGridReady] = useState(false);

  // Pure join selector
  const rows = useMemo(() => {
    return selectWorklistRows(snapshot, actions);
  }, [snapshot, actions]);

  // Find currently selected row
  const selectedRow = useMemo(() => {
    if (selectedActionId) {
      return rows.find((r) => r.action?.id === selectedActionId);
    }
    if (selectedInvoiceId) {
      return rows.find((r) => r.id === selectedInvoiceId);
    }
    return undefined;
  }, [rows, selectedActionId, selectedInvoiceId]);

  // Synchronize selection into AG Grid when URL query params change
  useEffect(() => {
    const api = gridApiRef.current;
    if (!api || !gridReady) return;

    api.forEachNode((node: IRowNode<WorklistRow>) => {
      const isSelected =
        Boolean(selectedActionId && node.data?.action?.id === selectedActionId) ||
        Boolean(selectedInvoiceId && node.data?.id === selectedInvoiceId);

      if (node.isSelected() !== isSelected) {
        node.setSelected(isSelected);
      }
    });
  }, [selectedActionId, selectedInvoiceId, gridReady, rows]);

  // Live SSE listener: Flash cells on update while keeping selection & scroll
  useEffect(() => {
    const unsubscribe = mockEventBus.subscribe((event) => {
      if (event.type === 'action.updated' || event.type === 'invoice.updated') {
        const api = gridApiRef.current;
        if (!api) return;

        const updatedId =
          event.type === 'invoice.updated'
            ? event.payload.id
            : event.payload.invoiceId;

        const node = api.getRowNode(updatedId);
        if (node) {
          const prefersReducedMotion =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

          if (!prefersReducedMotion) {
            api.flashCells({
              rowNodes: [node],
              flashDuration: 500,
              fadeDuration: 500,
            });
          }
        }
      }
    });

    return unsubscribe;
  }, []);

  // AG Grid Column Definitions
  const columnDefs = useMemo<ColDef<WorklistRow>[]>(() => {
    return [
      {
        field: 'invoice.number',
        headerName: 'Invoice #',
        pinned: 'left',
        minWidth: 130,
        width: 140,
        sortable: true,
        filter: 'agTextColumnFilter',
        cellRenderer: InvoiceNumberRenderer,
      },
      {
        field: 'payer.name',
        headerName: 'Payer',
        minWidth: 160,
        flex: 1.2,
        sortable: true,
        filter: 'agTextColumnFilter',
        valueGetter: (params) => params.data?.payer?.name ?? params.data?.invoice.payerId ?? '',
      },
      {
        field: 'invoice.amount',
        headerName: 'Amount',
        minWidth: 120,
        width: 130,
        sortable: true,
        headerClass: 'ag-right-aligned-header',
        cellClass: 'text-right tabular font-medium text-ink flex items-center justify-end',
        valueFormatter: (params) => formatUsd(params.data?.invoice.amount ?? 0),
      },
      {
        field: 'invoice.dueDate',
        headerName: 'Due Date',
        minWidth: 110,
        width: 120,
        sortable: true,
        cellClass: 'tabular text-muted flex items-center',
        valueFormatter: (params) => formatDateShort(params.data?.invoice.dueDate ?? ''),
      },
      {
        field: 'daysOverdue',
        headerName: 'Days Overdue',
        minWidth: 125,
        width: 130,
        sortable: true,
        cellRenderer: DaysOverdueRenderer,
      },
      {
        field: 'invoice.status',
        headerName: 'Status',
        minWidth: 130,
        width: 140,
        sortable: true,
        filter: 'agTextColumnFilter',
        cellRenderer: InvoiceStatusRenderer,
      },
      {
        headerName: 'Payer Risk',
        minWidth: 140,
        width: 150,
        sortable: false,
        cellRenderer: PayerRiskRenderer,
      },
      {
        headerName: 'Proposed Action',
        minWidth: 220,
        flex: 1.5,
        sortable: false,
        cellRenderer: ProposedActionRenderer,
      },
    ];
  }, []);

  const onGridReady = useCallback((params: GridReadyEvent<WorklistRow>) => {
    gridApiRef.current = params.api;
    setGridReady(true);
  }, []);

  const handleRowSelect = useCallback(
    (row: WorklistRow, eventTarget?: HTMLElement | null) => {
      if (eventTarget) {
        lastFocusedElementRef.current = eventTarget;
      }
      if (row.action) {
        setSelectedActionId(row.action.id);
      } else {
        setSelectedInvoiceId(row.id);
      }
    },
    [setSelectedActionId, setSelectedInvoiceId],
  );

  const onRowClicked = useCallback(
    (event: RowClickedEvent<WorklistRow>) => {
      if (event.data) {
        handleRowSelect(event.data, event.event?.target as HTMLElement);
      }
    },
    [handleRowSelect],
  );

  // Keyboard navigation: Enter on a row selects it
  const onCellKeyDown = useCallback(
    (event: CellKeyDownEvent<WorklistRow>) => {
      const keyboardEvent = event.event as KeyboardEvent | undefined;
      if (keyboardEvent?.key === 'Enter' && event.data) {
        handleRowSelect(event.data, keyboardEvent.target as HTMLElement);
      }
    },
    [handleRowSelect],
  );

  const handleCloseDrawer = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const rowClassRules = useMemo<RowClassRules<WorklistRow>>(() => {
    return {
      'cursor-pointer': () => true,
    };
  }, []);

  // Loading skeleton state
  if (loadingSnapshot || loadingActions) {
    return (
      <div
        data-testid={TEST_IDS.worklist}
        className="bg-surface border border-border rounded p-6 space-y-4 animate-pulse"
        style={{ height }}
      >
        <div className="h-6 w-48 bg-slate-200 rounded" />
        <div className="space-y-3 pt-4">
          <div className="h-8 bg-slate-100 rounded" />
          <div className="h-8 bg-slate-100 rounded" />
          <div className="h-8 bg-slate-100 rounded" />
          <div className="h-8 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  // Error state with retry
  if (snapshotError || actionsError) {
    return (
      <div
        data-testid={TEST_IDS.worklist}
        className="bg-red-50 border border-red-200 rounded p-6 text-center space-y-3"
        style={{ height }}
      >
        <div className="text-sm font-semibold text-status-red">Failed to load receivables worklist</div>
        <p className="text-xs text-muted">
          {(snapshotError as Error)?.message || (actionsError as Error)?.message || 'Network error'}
        </p>
        <button
          type="button"
          onClick={() => {
            refetchSnapshot();
            refetchActions();
          }}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-white border border-red-300 text-status-red hover:bg-red-50 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (rows.length === 0) {
    return (
      <div
        data-testid={TEST_IDS.worklist}
        className="bg-surface border border-border rounded p-12 text-center space-y-2 flex flex-col items-center justify-center"
        style={{ height }}
      >
        <div className="text-base font-semibold text-ink">No overdue invoices</div>
        <p className="text-xs text-muted max-w-sm">
          All client receivables are up to date and reconciled with the ledger.
        </p>
      </div>
    );
  }

  return (
    <div
      id="worklist"
      tabIndex={-1}
      data-testid={TEST_IDS.worklist}
      className="bg-surface border border-border rounded overflow-hidden flex flex-col focus:outline-none focus:ring-2 focus:ring-accent"
      style={{ height }}
    >
      <div className="ag-theme-quartz w-full flex-1">
        <AgGridReact<WorklistRow>
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          rowSelection={{ mode: 'singleRow', enableClickSelection: true }}
          animateRows={false}
          rowBuffer={10}
          onGridReady={onGridReady}
          onRowClicked={onRowClicked}
          onCellKeyDown={onCellKeyDown}
          rowClassRules={rowClassRules}
          suppressCellFocus={false}
          headerHeight={38}
          rowHeight={42}
        />
      </div>

      {/* Action Review Drawer */}
      <ActionDrawer
        isOpen={Boolean(selectedRow)}
        onClose={handleCloseDrawer}
        action={selectedRow?.action}
        invoice={selectedRow?.invoice}
        payer={selectedRow?.payer}
        reserve={snapshot?.business.reserveThreshold}
        lastFocusedElement={lastFocusedElementRef.current}
      />
    </div>
  );
};

