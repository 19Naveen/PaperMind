'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Theme selection.
 *
 * `light` / `dark` pin the theme; `system` follows the OS and keeps following it
 * while the page is open. The resolved value is written to `<html data-theme>`,
 * which is the single hook the token layer in app/globals.css reads — there is
 * no `prefers-color-scheme` block in the CSS, so the dark palette is defined
 * exactly once.
 *
 * Read through `useSyncExternalStore` rather than an effect: the choice lives in
 * localStorage and the OS preference lives in `matchMedia` — both are external
 * stores, and reading them in an effect would mean a second render on every
 * mount (and trips `react-hooks/set-state-in-effect`).
 */
export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_KEY = 'pm:theme';

/**
 * Runs in <head> before first paint so a dark-mode visitor never sees a white
 * flash. Kept as a string (not a module) because it must execute inline, ahead
 * of hydration. Mirrors `resolve()` below — change both together.
 */
export const THEME_BOOTSTRAP = `(function(){try{
var c=localStorage.getItem('${THEME_KEY}');
if(c!=='light'&&c!=='dark')c=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
document.documentElement.dataset.theme=c;
}catch(e){document.documentElement.dataset.theme='light'}})()`;

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readChoice(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    return 'system';
  }
}

function resolve(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') return prefersDark() ? 'dark' : 'light';
  return choice;
}

function apply(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = resolve(choice);
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  // While the choice is `system`, an OS switch must repaint immediately.
  const onSystem = () => {
    if (readChoice() === 'system') apply('system');
    notify();
  };
  mq.addEventListener('change', onSystem);
  // Another tab changed the preference.
  window.addEventListener('storage', onSystem);
  return () => {
    listeners.delete(onChange);
    mq.removeEventListener('change', onSystem);
    window.removeEventListener('storage', onSystem);
  };
}

/** A primitive snapshot, as useSyncExternalStore requires: "choice|resolved". */
function getSnapshot(): string {
  const choice = readChoice();
  return `${choice}|${resolve(choice)}`;
}

/** The server cannot know either value; the bootstrap script corrects it before paint. */
function getServerSnapshot(): string {
  return 'system|light';
}

export function useTheme(): { choice: ThemeChoice; resolved: 'light' | 'dark'; setChoice: (c: ThemeChoice) => void } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [choice, resolved] = snapshot.split('|') as [ThemeChoice, 'light' | 'dark'];

  const setChoice = useCallback((next: ThemeChoice) => {
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage unavailable — the theme still applies for this session.
    }
    apply(next);
    notify();
  }, []);

  return { choice, resolved, setChoice };
}
