import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { TEST_IDS } from '../testids';
import { useSse } from '../api/sse';
import { DevErrorOverlay } from './DevErrorOverlay';

interface NavItem {
  label: string;
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/' },
  { label: 'Receivables', path: '/receivables' },
  { label: 'Audit Log', path: '/audit' },
  { label: 'Policy Rules', path: '/policy' },
];

export const AppShell: React.FC = () => {
  const { connectionState } = useSse();

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans">
      {/* Dev schema validation error overlay */}
      <DevErrorOverlay />

      {/* Top Header Bar */}
      <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-6 sticky top-0 z-30">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-ink">Settle</span>
            <span className="text-xs uppercase font-medium text-muted tracking-wider px-1.5 py-0.5 bg-slate-100 rounded border border-border">
              Sys 4
            </span>
          </div>
          <span className="text-sm font-medium text-muted border-l border-border pl-6">
            Northwind Studio
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Permanent Sandbox Badge per Rule 1 */}
          <div
            data-testid={TEST_IDS.sandboxBadge}
            className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-900 border border-amber-300 rounded text-xs font-semibold uppercase tracking-wider"
          >
            <span className="w-2 h-2 rounded-full bg-amber-600 inline-block" />
            Sandbox - no real funds
          </div>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Navigation Sidebar */}
        <aside className="w-64 bg-surface border-r border-border flex flex-col justify-between p-4">
          <nav className="space-y-1">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider px-3 mb-2">
              Workspace
            </div>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-sm font-medium rounded transition-colors ${
                    isActive
                      ? 'bg-slate-100 text-accent font-semibold border-l-2 border-accent'
                      : 'text-muted hover:text-ink hover:bg-slate-50'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Connection status indicator */}
          <div className="pt-4 border-t border-border px-3">
            <div
              data-testid={TEST_IDS.connectionStatus}
              className="flex items-center gap-2 text-xs text-muted"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionState === 'connected'
                    ? 'bg-green-600'
                    : connectionState === 'connecting'
                    ? 'bg-amber-600 animate-pulse'
                    : 'bg-red-600'
                }`}
              />
              <span className="capitalize">{connectionState}</span>
              <span className="text-[10px] text-muted ml-auto font-mono">
                {import.meta.env.VITE_API_BASE ? 'Live API' : 'MSW Mock'}
              </span>
            </div>
          </div>
        </aside>

        {/* Primary Content Outlet */}
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

