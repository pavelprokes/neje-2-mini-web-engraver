'use client';

import { useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { createLocalStore } from '@/lib/storage';

export interface Tab {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

const selectedTab = createLocalStore<string>('neje.tab.v1', '', (v) => (typeof v === 'string' ? v : undefined));

/** Selects a tab from outside, e.g. "How to fix it" next to a connection error. */
export const selectTab = (id: string) => selectedTab.set(id);

/**
 * WAI-ARIA tabs (automatic activation): arrow keys move between tabs, Home/End jump to the ends,
 * only the active tab is in the tab order. The last tab used is remembered.
 */
export function Tabs({ label, tabs }: { readonly label: string; readonly tabs: readonly Tab[] }) {
  const base = useId();
  const stored = useSyncExternalStore(selectedTab.subscribe, selectedTab.getSnapshot, selectedTab.getServerSnapshot);
  const active = tabs.find((t) => t.id === stored) ?? tabs[0]!;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(active);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const index = (next + tabs.length) % tabs.length;
    selectedTab.set(tabs[index]!.id);
    buttons.current[index]?.focus();
  };

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab, i) => {
          const selected = tab === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectedTab.set(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {/* every panel stays mounted (hidden when inactive) so typed input survives tab switches */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          tabIndex={0}
          hidden={tab !== active}
          className="tabpanel"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
