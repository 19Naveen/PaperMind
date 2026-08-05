import type { ReactNode } from 'react';

/**
 * The sign-in frame — an instrument card, not a marketing fold. Left panel
 * carries the brand mark and the operational pitch; the right panel hosts the
 * form. Drops to a single, centered column on mobile.
 */
export function AuthFrame({ eyebrow, pitch, children }: { eyebrow: string; pitch: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ground px-4 py-10">
      <div className="w-full max-w-[900px] overflow-hidden rounded-[10px] border border-rule bg-surface shadow-sm">
        <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <aside className="hidden flex-col justify-between border-r border-rule bg-raised p-8 md:flex">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-rule bg-surface font-data text-[13px] font-bold text-accent">
                  P
                </span>
                <div className="min-w-0">
                  <p className="display text-[15px] leading-none text-ink">PaperMind</p>
                  <p className="mt-1 font-data text-[9.5px] uppercase tracking-[0.18em] text-ink-3">{eyebrow}</p>
                </div>
              </div>
              <p className="display mt-12 max-w-[220px] text-[22px] leading-snug text-ink">{pitch}</p>
            </div>

            <div className="space-y-1.5 border-t border-rule pt-4">
              <p className="font-data text-[10px] uppercase tracking-[0.14em] text-ink-3">Operational note</p>
              <p className="font-data text-[10px] leading-relaxed text-ink-3">
                local draft — no real credentials
                <br />
                sign-in is mocked until the service lands
              </p>
            </div>
          </aside>

          <div className="p-6 sm:p-8">{children}</div>
        </div>
      </div>
    </main>
  );
}