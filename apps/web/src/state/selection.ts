import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

/**
 * Hook to manage selected action state synchronized with the `?action=` URL query parameter.
 * Keeps dashboard, worklist, and drawer in sync across reloads.
 */
export function useSelectedAction() {
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedActionId = searchParams.get('action');

  const setSelectedActionId = useCallback(
    (actionId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (actionId) {
            next.set('action', actionId);
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

  const clearSelection = useCallback(() => {
    setSelectedActionId(null);
  }, [setSelectedActionId]);

  return {
    selectedActionId,
    setSelectedActionId,
    clearSelection,
  };
}

