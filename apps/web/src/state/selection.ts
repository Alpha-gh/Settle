import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

/**
 * Hook to manage selected action and invoice state synchronized with the URL search parameters:
 * - `?action=<id>`: when an invoice has a proposed or executed recovery action
 * - `?invoice=<id>`: when an invoice has no action (read-only drawer)
 * Keeps dashboard, worklist, and drawer in sync across reloads and tab navigation.
 */
export function useSelectedAction() {
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedActionId = searchParams.get('action');
  const selectedInvoiceId = searchParams.get('invoice');

  const setSelectedActionId = useCallback(
    (actionId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (actionId) {
            next.set('action', actionId);
            next.delete('invoice');
          } else {
            next.delete('action');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setSelectedInvoiceId = useCallback(
    (invoiceId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (invoiceId) {
            next.set('invoice', invoiceId);
            next.delete('action');
          } else {
            next.delete('invoice');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearSelection = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('action');
        next.delete('invoice');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return {
    selectedActionId,
    selectedInvoiceId,
    setSelectedActionId,
    setSelectedInvoiceId,
    clearSelection,
  };
}
