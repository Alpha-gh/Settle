import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { TEST_IDS } from '../testids';
import { useSse } from '../api/sse';
import { DevErrorOverlay } from './DevErrorOverlay';
import { Copilot } from './Copilot';
import { DemoControls } from './DemoControls';

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
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans">
      {/* Skip to main content link for keyboard accessibility */}
      <a
        href="#main-content"
        data-testid="skip-to-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded focus:font-medium focus:shadow-md focus:outline-none"
      >
        Skip to content
      </a>

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

          {/* Copilot Slide-over Toggle */}
          <button
            type="button"
            data-testid={TEST_IDS.copilotToggle}
            onClick={() => setIsCopilotOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-accent bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors"
            aria-label="Open Settle Co-pilot"
          >
            <svg
              className="w-4 h-4 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <span>Co-pilot</span>
          </button>
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
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
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
                {import.meta.env.VITE_USE_MOCKS === 'true' ? 'MSW Mock' : 'Live API'}
              </span>
            </div>
          </div>
        </aside>

        {/* Primary Content Outlet */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-8 outline-none">
          <Outlet />
        </main>
      </div>

      {/* Copilot Drawer */}
      <Copilot isOpen={isCopilotOpen} onClose={() => setIsCopilotOpen(false)} />

      {/* Demo Controls Panel (active when ?demo=1 or settle:demo=1 in sessionStorage) */}
      <DemoControls />
    </div>
  );
};

