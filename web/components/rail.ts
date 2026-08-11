'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Nav-rail collapse.
 *
 * The choice lives in localStorage and is projected onto `<html data-rail>`,
 * which is the single hook app/shell.css reads. The CSS styles ONLY
 * `[data-rail="collapsed"]`, so a missing/failed attribute leaves the rail
 * exactly as it renders today — the degradation the shell needs, since the
 * pre-paint bootstrap below is emitted by AppShell rather than <head>.
 *
 * Read through `useSyncExternalStore`, not an effect: localStorage is an
 * external store, and reading it in an effect means a second render on every
 * mount (and trips `react-hooks/set-state-in-effect`, an error in this repo).
 * Mirrors components/theme.ts — change them together.
 */
export const RAIL_KEY = 'pm:rail';

/**
 * Runs inline, ahead of the `.sidebar` markup, so a visitor who collapsed the
 * rail never sees it paint wide and then snap shut. Kept as a string because it
 * must execute during HTML parsing, before hydration. Mirrors `read()` below.
 *
 * This belongs in <head> next to THEME_BOOTSTRAP; app/layout.tsx is outside the
 * shell's ownership, so AppShell emits it as the first child of `.app` instead —
 * still ahead of the rail in document order, one paint later than <head> would be.
 */
export const RAIL_BOOTSTRAP = `(function(){try{
document.documentElement.dataset.rail=localStorage.getItem('${RAIL_KEY}')==='collapsed'?'collapsed':'expanded';
}catch(e){document.documentElement.dataset.rail='expanded'}})()`;

function read(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function apply(collapsed: boolean): void {
  document.documentElement.dataset.rail = collapsed ? 'collapsed' : 'expanded';
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab collapsed or expanded the rail.
  const onStorage = () => {
    apply(read());
    notify();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** A primitive snapshot, as useSyncExternalStore requires. */
function getSnapshot(): 'collapsed' | 'expanded' {
  return read() ? 'collapsed' : 'expanded';
}

/** The server cannot know the choice; the bootstrap corrects the DOM before paint. */
function getServerSnapshot(): 'collapsed' | 'expanded' {
  return 'expanded';
}

export function useRail(): { collapsed: boolean; setCollapsed: (next: boolean) => void; toggle: () => void } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const collapsed = state === 'collapsed';

  const setCollapsed = useCallback((next: boolean) => {
    try {
      if (next) window.localStorage.setItem(RAIL_KEY, 'collapsed');
      else window.localStorage.removeItem(RAIL_KEY);
    } catch {
      // Storage unavailable — the rail still collapses for this session.
    }
    apply(next);
    notify();
  }, []);

  const toggle = useCallback(() => setCollapsed(!read()), [setCollapsed]);

  return { collapsed, setCollapsed, toggle };
}
