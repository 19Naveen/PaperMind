import type { ReactNode } from 'react';

export function AuthFrame({ eyebrow, pitch, children }: { eyebrow: string; pitch: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen grid-cols-1 bg-surface [@media(min-width:981px)]:grid-cols-[minmax(430px,1.08fr)_minmax(420px,0.92fr)]">
      <aside className="hidden flex-col justify-between bg-[#111116] p-12 text-white [@media(min-width:981px)]:flex">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(145deg,#7373ee,#4d4dc6)] text-[15px] font-semibold text-white shadow-[0_5px_16px_rgba(72,72,197,0.28)]">P</span>
            <div className="min-w-0">
              <p className="text-[19px] font-semibold leading-none tracking-[-0.025em]">PaperMind</p>
              <p className="mt-2 font-data text-[9.5px] uppercase tracking-[0.18em] text-white/45">{eyebrow}</p>
            </div>
          </div>
          <p className="mt-[10vh] max-w-[540px] text-[clamp(34px,4vw,52px)] font-semibold leading-[1.06] tracking-[-0.055em] text-white">{pitch}</p>
          <div className="mt-12 max-w-[420px] space-y-5 text-white/70">
            <p className="text-[13px] leading-relaxed">Build a review workflow once, then run it against any document set with the same rules and a citation behind every fact.</p>
            <div className="grid gap-3 text-[12px]">
              <p><b className="text-white">Author once</b><br />Conversational drafting, human review, then a frozen spec.</p>
              <p><b className="text-white">Evidence first</b><br />No citation, no result. Gaps are flagged, never guessed.</p>
              <p><b className="text-white">Version everything</b><br />Every run records the exact Pack version that produced it.</p>
            </div>
          </div>
        </div>
      </aside>
      <div className="grid place-items-center overflow-auto bg-[linear-gradient(180deg,#ffffff,#fbfbfc)] p-8">
        <div className="w-full max-w-[390px]">{children}</div>
      </div>
    </main>
  );
}
