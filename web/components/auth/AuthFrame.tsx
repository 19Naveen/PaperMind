import type { ReactNode } from 'react';
import { IconCheck, IconDoc, IconRefresh, IconSparkle, IconUser } from '@/lib/icons';

/**
 * The reference auth shell: a dark brand panel (`.login-brand`) with an indigo
 * grid/radial atmosphere, and a centered form card (`.login-side > .login-card`).
 * Collapses to a single centered column on narrow viewports.
 */
export function AuthFrame({ pitch, children }: { pitch: string; children: ReactNode }) {
  return (
    <main className="login">
      <aside className="login-brand">
        <div className="brand">
          <span className="brand-mark"><IconDoc className="ic sm" /></span>
          <span className="brand-name">PaperMind</span>
        </div>
        <div className="lb-hero">
          <h1>{pitch}</h1>
          <p>Document intelligence you can reuse — every extracted fact cites its source.</p>
        </div>
        <div className="lb-points">
          <div className="lb-point">
            <IconSparkle className="ic" />
            <div>
              <b>Author a Pack once</b>
              <p>Describe the workflow; the studio drafts a spec you approve before anything runs.</p>
            </div>
          </div>
          <div className="lb-point">
            <IconCheck className="ic" />
            <div>
              <b>Evidence on every fact</b>
              <p>Each extracted value is checked against a cited source span — no citation, no result.</p>
            </div>
          </div>
          <div className="lb-point">
            <IconRefresh className="ic" />
            <div>
              <b>Repeatable, versioned runs</b>
              <p>The same Pack runs identically against any document set; versions never mutate in place.</p>
            </div>
          </div>
        </div>
        <div className="lb-demo" aria-hidden="true">
          <div className="ld-hd">
            <span>Dev demo</span>
            <span className="pill warn">Development only</span>
          </div>
          <div className="ld-row"><IconUser className="ic sm" /> Email <span className="pill outl">ada@papermind.io</span></div>
          <div className="ld-row"><IconDoc className="ic sm" /> Password <span className="pill outl">papermind123</span></div>
        </div>
      </aside>
      <div className="login-side">
        <div className="login-card">{children}</div>
      </div>
    </main>
  );
}
