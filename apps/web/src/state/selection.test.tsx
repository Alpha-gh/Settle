import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import { useSelectedAction } from './selection';

describe('useSelectedAction', () => {
  it('reads selected action from search params', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={['/?action=act_001']}>
        {children}
      </MemoryRouter>
    );

    const { result } = renderHook(() => useSelectedAction(), { wrapper });
    expect(result.current.selectedActionId).toBe('act_001');
  });

  it('updates search params when setSelectedActionId is called', () => {
    const locationRef: { current: Location | null } = { current: null };
    const LocationWatcher = () => {
      locationRef.current = useLocation();
      return null;
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={['/']}>
        <LocationWatcher />
        {children}
      </MemoryRouter>
    );

    const { result } = renderHook(() => useSelectedAction(), { wrapper });
    expect(result.current.selectedActionId).toBeNull();

    act(() => {
      result.current.setSelectedActionId('act_002');
    });

    expect(result.current.selectedActionId).toBe('act_002');
    expect(locationRef.current?.search).toBe('?action=act_002');

    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedActionId).toBeNull();
    expect(locationRef.current?.search).toBe('');
  });
});
