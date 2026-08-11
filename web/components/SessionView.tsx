'use client';

/**
 * The Session surface — the run/review screen.
 *
 * The job this screen serves is triage-and-verify, in that order: find the checks that
 * need a human decision, read each one against the sentence that supports it (or against
 * the stated absence of one), correct what is wrong, and leave an audit trail. Everything
 * on the page is ordered by that job — the exceptions list is the page, the case inputs
 * and provenance are context beside it, and chat is a utility at the bottom of the aside.
 *
 * Honesty rules observed here, all verified against the backend:
 *   · `run.stage` is only ever set to "classify" (app/services/runtime.py sets it once,
 *     then app/services/workflow_runtime.py — which now executes the run — never advances
 *     it). A six-stage progress ladder would sit on "classify" for the whole run, so there
 *     is no stage ladder and no percentage bar. The engine reports completion, not progress.
 *   · A citation's `quote` IS the span that verification matched; there is no sub-span
 *     offset. Field-fact quotes come from `_locate_quote` (verbatim match), rule-fact
 *     quotes can be a 200-char chunk excerpt (`_attach_rule_evidence`). Only the former
 *     is highlighted, and the provenance line says which kind it is in words.
 *   · `RunOut` carries no `error`, so a failed run cannot explain itself here.
 *   · `POST /runs/{id}/corrections` exists; no read-back endpoint does. The ledger says so.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ChatMessage,
  Citation,
  Fact,
  FactState,
  PackSpec,
  RunOut,
  RunStatus,
  WorkspaceSessionOut,
} from '@/lib/api';
import {
  correctFactAction,
  deleteSessionAction,
  startRunAction,
  updateSessionAction,
  uploadDocumentAction,
} from '@/lib/session';
import {
  ActionButton,
  Button,
  EmptyState,
  FileButton,
  IconButton,
  Kv,
  Pill,
  Stamp,
  Tag,
  type PillTone,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconClose,
  IconDoc,
  IconMore,
  IconPencil,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSparkle,
} from '@/lib/icons';

// ---------------------------------------------------------------------------
// State vocabulary. Status is carried by an icon, a word and a colour — never
// by colour alone.
// ---------------------------------------------------------------------------

const STATE_META: Record<FactState, { label: string; tone: PillTone; icon: ReactNode }> = {
  verified: { label: 'Verified', tone: 'verified', icon: <IconCheck className="ic sm" /> },
  unsupported: { label: 'Unsupported', tone: 'unsupported', icon: <IconAlert className="ic sm" /> },
  missing: { label: 'Missing', tone: 'missing', icon: <IconClose className="ic sm" /> },
};

const STATUS_TONE: Record<RunStatus, PillTone> = {
  pending: 'neutral',
  running: 'running',
  complete: 'verified',
  failed: 'missing',
};

const STATUS_LABEL: Record<RunStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
};

/** Overflow menu — one control for the session's own lifecycle actions, consolidating what
 * were two header buttons and matching the pattern the workspace screen is adopting.
 *
 * The trigger is a local `.iconbtn` rather than the shared `IconButton`: a menu trigger has
 * to carry `aria-haspopup`/`aria-expanded` and a ref for focus return, and the primitive
 * exposes none of the three. Reported as a primitive gap rather than worked around silently.
 */
function ActionMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    }
    function onDown(event: MouseEvent) {
      if (event.target instanceof Node && !wrap.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="rev-menu" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="iconbtn"
        aria-label="Session actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconMore className="ic" />
      </button>
      {open && (
        <div className="rev-menu-pop" role="menu" aria-label="Session actions">
          <button ref={firstItem} type="button" role="menuitem" className="acc-item" onClick={() => run(onRename)}>
            Rename session
          </button>
          <div className="acc-sep" />
          <button type="button" role="menuitem" className="acc-item dgr" onClick={() => run(onDelete)}>
            Delete session
          </button>
        </div>
      )}
    </div>
  );
}

/** `liability_cap` → `Liability cap`. The raw key stays visible beside it. */
function fieldLabel(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isRuleFact(fact: Fact): boolean {
  return fact.field.startsWith('rule:');
}

function ruleId(fact: Fact): string {
  return fact.field.slice('rule:'.length);
}

/** How the backend's rule interpreter (`_evaluate_rule`) maps onto plain language. */
function ruleVerdict(state: FactState): string {
  if (state === 'verified') return 'Satisfied by the extracted fields.';
  if (state === 'unsupported') return 'Not satisfied by the extracted fields.';
  return 'Could not be evaluated — a field it depends on was not found.';
}

function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return minutes > 0 ? `${minutes}m ${total % 60}s` : `${total}s`;
}

// ---------------------------------------------------------------------------
// SIGNATURE: the evidence block.
//
// One quoted sentence, the highlight, and a machine-readable provenance line.
// The quote is rendered without added punctuation so it can be copied verbatim
// into a report; the decorative quotation glyph lives in CSS.
// ---------------------------------------------------------------------------

/** What kind of thing the quote is. Only one of the three is a verification claim, and the
 * provenance line says which in words — a highlight on its own is just colour. */
type QuoteKind = 'located' | 'retrieved' | 'excerpt';

const QUOTE_KIND_LABEL: Record<QuoteKind, string> = {
  located: 'located verbatim',
  retrieved: 'retrieved passage · not verified',
  excerpt: 'source excerpt',
};

function Evidence({ citation, kind }: { citation: Citation; kind: QuoteKind }) {
  return (
    <blockquote className="ev rev-ev">
      <p className="rev-quote">
        {kind === 'located' ? <mark className="rev-mark">{citation.quote}</mark> : citation.quote}
      </p>
      {/* Separators are drawn by CSS on each following item, so a wrapped provenance line
          can never end with a dangling "·". */}
      <cite>
        <span className="rev-cite-doc">{citation.document_name}</span>
        <span>page {citation.page}</span>
        <span>
          chars {citation.char_start}–{citation.char_end}
        </span>
        <span>{QUOTE_KIND_LABEL[kind]}</span>
      </cite>
    </blockquote>
  );
}

/** What the state means, said out loud. For anything short of verified the gap IS the
 * finding, and an empty space would read as "nothing to show you".
 *
 * Rules and fields fail for different reasons and get different words: a field is retrieved
 * and extracted from a document, a rule is evaluated against fields that were already
 * extracted. Nothing is "retrieved" for a rule, so the field copy would be a lie. */
function StateNote({
  state,
  hasEvidence,
  rule,
}: {
  state: FactState;
  hasEvidence: boolean;
  rule: boolean;
}) {
  if (rule) {
    if (state === 'verified') {
      // Not a broken guarantee: `_attach_rule_evidence` only carries a citation when one
      // field or document plainly satisfies the rule, so an empty citation list is by design.
      return (
        <div className="rev-noev">
          <b>Satisfied, with no citation carried over</b>
          <p>
            A passing rule inherits the citation of the field or document that satisfied it. This
            one inherited none, so it rests on the field results in this case rather than on a
            sentence of its own.
          </p>
        </div>
      );
    }
    if (state === 'unsupported') {
      return (
        <div className="rev-noev">
          <b>The rule does not hold</b>
          <p>
            It was evaluated against the fields this run extracted, and they do not satisfy it.
            The gap is in those fields — work them first; the rule follows.
          </p>
        </div>
      );
    }
    return (
      <div className="rev-noev">
        <b>The rule could not be evaluated</b>
        <p>
          A field this rule depends on was not found in the case, so there was nothing to test.
          Resolve that field and the rule is evaluated again on the next run.
        </p>
      </div>
    );
  }
  if (state === 'verified') {
    // Only reachable when the citation list is empty, which contradicts the platform's own
    // rule. Say so rather than presenting an unbacked value as confirmed.
    return (
      <div className="rev-noev is-broken">
        <b>Verified with no citation on record</b>
        <p>
          That breaks the platform&rsquo;s own rule — no citation, no result. Treat this value as
          unconfirmed and check it against the document before you rely on it.
        </p>
      </div>
    );
  }
  if (state === 'unsupported') {
    return (
      <div className="rev-noev">
        <b>No supporting sentence was located</b>
        <p>
          A value was proposed, but no passage in the attached documents matches it word for word,
          so verification failed.{' '}
          {hasEvidence
            ? 'The passage the engine retrieved is below — read it before you accept the value.'
            : 'Confirm it against the source yourself, or log a correction.'}
        </p>
      </div>
    );
  }
  return (
    <div className="rev-noev">
      <b>Nothing was extracted</b>
      <p>
        Retrieval found no passage for this field in the attached documents.{' '}
        {hasEvidence
          ? 'What it did retrieve is below; none of it carries the field.'
          : 'Either the case is genuinely missing it, or the Pack’s description of the field needs to be sharper.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One check.
// ---------------------------------------------------------------------------

/** A correction the reviewer logged in this view. `id` is local: the API returns a
 * `CorrectionOut`, but `correctFactAction` (lib/session.ts, not editable here) discards it. */
interface LoggedCorrection {
  id: number;
  factId: string;
  field: string;
  from: string | null;
  to: string;
  note: string;
  at: number;
}

function CheckRow({
  fact,
  runId,
  workspaceId,
  description,
  corrections,
  onLogged,
}: {
  fact: Fact;
  runId: string;
  workspaceId: string;
  description?: string;
  corrections: LoggedCorrection[];
  onLogged: (correction: Omit<LoggedCorrection, 'id'>) => void;
}) {
  const rule = isRuleFact(fact);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(fact.value ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = STATE_META[fact.state];
  const ids = useId();

  async function submit() {
    const next = value.trim();
    if (!next || saving) return;
    setSaving(true);
    setError(null);
    try {
      await correctFactAction(workspaceId, runId, fact.id, next, note.trim() || undefined);
      onLogged({
        factId: fact.id,
        field: fact.field,
        from: fact.value,
        to: next,
        note: note.trim(),
        at: Date.now(),
      });
      setNote('');
      setOpen(false);
    } catch {
      setError('That correction was not accepted. Try again in a moment.');
    }
    setSaving(false);
  }

  return (
    <article className={`rev-chk is-${fact.state}`}>
      <span className="rev-state">
        {meta.icon}
        {meta.label}
      </span>

      {/* A rule's identity is its sentence ("Termination notice must be at least 30 days"),
          not its id — so the frozen spec's text becomes the heading when it resolves, with
          the id kept beside it for the audit trail. A field keeps name-then-description. */}
      <div className="rev-chk-id">
        <h4>{rule ? (description ?? `Rule ${ruleId(fact)}`) : fieldLabel(fact.field)}</h4>
        <span className="rev-key">{fact.field}</span>
      </div>

      {/* The primary verb on this screen. It reads as a control — bordered, full height —
          because overriding a finding is the reviewer's job, not a footnote. */}
      <div className="rev-chk-act">
        <ActionButton
          size="sm"
          variant="secondary"
          onClick={() => setOpen((o) => !o)}
          icon={open ? <IconClose className="ic sm" /> : <IconPencil className="ic sm" />}
        >
          {open ? 'Close' : 'Correct'}
        </ActionButton>
      </div>

      <div className="rev-chk-main">
        {!rule && description && <p className="rev-chk-desc">{description}</p>}

        {rule ? (
          <p className="rev-verdict">{ruleVerdict(fact.state)}</p>
        ) : (
          <dl className="rev-val">
            <dt>Extracted value</dt>
            <dd className={fact.value ? 'rev-val-set' : 'rev-val-none'}>
              {fact.value ?? 'No value extracted'}
            </dd>
          </dl>
        )}

        {/* The state note explains the state; the evidence blocks report the citations. A
            verified field fact's quote is the span the runtime matched verbatim, so it is
            the only one that gets the highlight. */}
        {(fact.state !== 'verified' || fact.citations.length === 0) && (
          <StateNote state={fact.state} hasEvidence={fact.citations.length > 0} rule={rule} />
        )}
        {fact.citations.map((citation, index) => (
          <Evidence
            key={`${citation.chunk_id}-${index}`}
            citation={citation}
            kind={rule ? 'excerpt' : fact.state === 'verified' ? 'located' : 'retrieved'}
          />
        ))}

        {corrections.length > 0 && (
          <ul className="rev-chk-log">
            {corrections.map((correction) => (
              <li key={correction.id}>
                <span className="rev-log-mark">Correction logged</span>
                <span className="rev-log-val">{correction.to}</span>
                <time dateTime={new Date(correction.at).toISOString()}>
                  {formatDateTime(correction.at)}
                </time>
              </li>
            ))}
          </ul>
        )}

        {open && (
          <form
            className="rev-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p className="rev-form-note">
              Corrections are appended to the audit trail. The run keeps the result the engine
              produced — nothing here is overwritten.
            </p>
            <div className="rev-form-grid">
              <label className="rev-lbl" htmlFor={`${ids}-value`}>
                Corrected value
              </label>
              <input
                id={`${ids}-value`}
                className="input sm"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={fact.value ?? 'The value you would record'}
              />
              <label className="rev-lbl" htmlFor={`${ids}-note`}>
                Why (optional)
              </label>
              <input
                id={`${ids}-note`}
                className="input sm"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. cap is on page 4, not page 2"
              />
            </div>
            {error && (
              <p className="rev-err" role="alert">
                {error}
              </p>
            )}
            <div className="rev-form-act">
              <ActionButton size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Discard
              </ActionButton>
              <ActionButton size="sm" variant="primary" type="submit" disabled={saving || !value.trim()}>
                {saving ? 'Logging…' : 'Log correction'}
              </ActionButton>
            </div>
          </form>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Filter — a real tablist: roving tabindex, aria-selected, arrow/Home/End keys,
// and the count inside each accessible name.
// ---------------------------------------------------------------------------

type Filter = 'attention' | 'verified' | 'all';

function FilterTabs({
  value,
  onChange,
  counts,
  panelId,
  idBase,
}: {
  value: Filter;
  onChange: (next: Filter) => void;
  counts: Record<Filter, number>;
  panelId: string;
  idBase: string;
}) {
  const tabs: { id: Filter; label: string }[] = [
    { id: 'attention', label: 'Needs attention' },
    { id: 'verified', label: 'Verified' },
    { id: 'all', label: 'All checks' },
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className="rev-tabs" role="tablist" aria-label="Filter checks by state">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="tab"
          id={`${idBase}-${tab.id}`}
          aria-selected={value === tab.id}
          aria-controls={panelId}
          tabIndex={value === tab.id ? 0 : -1}
          className="rev-tab"
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.label}
          <span className="rev-tab-n">{counts[tab.id]}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SessionViewProps {
  workspaceId: string;
  workspaceName: string;
  /** The workspace's installed Pack. `null` is the one condition that makes a run
   * impossible (the API answers PACK_NOT_INSTALLED), so the control says so up front
   * instead of failing on click. */
  installedPack: { name: string; version: number | null } | null;
  session: WorkspaceSessionOut;
  run: RunOut | null;
  /** The frozen spec of the exact pack version this run executed — field descriptions and
   * rule text. `null` when it could not be resolved; never a newer version's spec. */
  spec: PackSpec | null;
}

export function SessionView({
  workspaceId,
  workspaceName,
  installedPack,
  session,
  run,
  spec,
}: SessionViewProps) {
  const router = useRouter();
  // The poll's view of the session/run, when it has one. Both are DERIVED rather than
  // mirrored into state with an effect: a newer server prop (a fresh run, a route refresh)
  // must win over a stale poll result, and syncing props into state in an effect costs a
  // cascading render for no benefit.
  const [polledSession, setPolledSession] = useState<WorkspaceSessionOut | null>(null);
  const [polledRun, setPolledRun] = useState<RunOut | null>(null);
  const liveSession = polledSession?.id === session.id ? polledSession : session;
  const liveRun = polledRun !== null && (run === null || polledRun.id === run.id) ? polledRun : run;
  const [uploaded, setUploaded] = useState<{ id: string; name: string }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [title, setTitle] = useState(session.title);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [corrections, setCorrections] = useState<LoggedCorrection[]>([]);
  const [nowMs, setNowMs] = useState<number | null>(null);

  // chat (a utility on this page, not the point of it)
  const [messages, setMessages] = useState<ChatMessage[]>(session.messages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [reply, setReply] = useState('');
  const replyRef = useRef('');
  const correctionSeq = useRef(0);
  const deleteRef = useRef<HTMLElement>(null);

  const ids = useId();
  const panelId = `${ids}-checks`;

  const status: RunStatus = liveRun?.status ?? (liveSession.status === 'complete' ? 'complete' : 'pending');
  const running = liveRun !== null && (status === 'pending' || status === 'running');

  const runDocs = liveRun?.documents ?? [];
  const pendingDocs = uploaded.filter((u) => !runDocs.some((d) => d.id === u.id));
  const startableDocIds = liveRun ? runDocs.map((d) => d.id) : pendingDocs.map((d) => d.id);

  // Poll while the engine works. TanStack Query is not a dependency of this project, so
  // the poll goes through the session's own route handler.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/workspace/${workspaceId}/sessions/${session.id}/run`);
        if (!res.ok) return;
        const body = (await res.json()) as { session: WorkspaceSessionOut | null; run: RunOut | null };
        if (body.session) setPolledSession(body.session);
        if (body.run) {
          setPolledRun(body.run);
          // Terminal: pull the server data again so the pinned pack spec (field
          // descriptions, rule text) arrives with the results.
          if (body.run.status === 'complete' || body.run.status === 'failed') router.refresh();
        }
      } catch {
        // transient poll failure — the next tick retries
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [workspaceId, session.id, running, router]);

  // Elapsed time ticks only while running, and only after mount — a clock read during the
  // render pass would not survive hydration, so the first value arrives on a timer callback.
  useEffect(() => {
    if (!running) return;
    const tick = () => setNowMs(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [running]);

  // The dialog is opened from a menu item that unmounts on click, so focus has to be moved
  // into the dialog explicitly and handed back to the menu trigger when it closes —
  // otherwise a keyboard user is left on <body>. Escape closes from anywhere.
  useEffect(() => {
    if (!isDeleteOpen) return;
    deleteRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setIsDeleteOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.querySelector<HTMLButtonElement>('.rev-menu > .iconbtn')?.focus();
    };
  }, [isDeleteOpen]);

  const facts = useMemo(() => liveRun?.facts ?? [], [liveRun]);
  const counts = useMemo(() => {
    const fieldFacts = facts.filter((f) => !isRuleFact(f));
    const ruleFacts = facts.filter(isRuleFact);
    return {
      all: facts.length,
      verified: facts.filter((f) => f.state === 'verified').length,
      attention: facts.filter((f) => f.state !== 'verified').length,
      fields: fieldFacts.length,
      fieldsVerified: fieldFacts.filter((f) => f.state === 'verified').length,
      fieldsUnsupported: fieldFacts.filter((f) => f.state === 'unsupported').length,
      fieldsMissing: fieldFacts.filter((f) => f.state === 'missing').length,
      rules: ruleFacts.length,
      rulesFailed: ruleFacts.filter((f) => f.state !== 'verified').length,
    };
  }, [facts]);

  // The default answers "what needs me?" when anything does, and does not open on an
  // empty list when nothing does.
  const activeFilter: Filter = filter ?? (counts.attention > 0 ? 'attention' : 'all');

  const specFields = useMemo(() => {
    const map = new Map<string, string>();
    for (const field of spec?.fields ?? []) map.set(field.name, field.description);
    return map;
  }, [spec]);
  const specRules = useMemo(() => {
    const map = new Map<string, string>();
    for (const rule of spec?.rules ?? []) map.set(rule.id, rule.description);
    return map;
  }, [spec]);

  function describe(fact: Fact): string | undefined {
    if (isRuleFact(fact)) return specRules.get(ruleId(fact));
    return specFields.get(fact.field) || undefined;
  }

  function keep(fact: Fact): boolean {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'verified') return fact.state === 'verified';
    return fact.state !== 'verified';
  }

  // Group by the run's own cases, and never silently drop a fact whose case is not listed.
  const caseIds = new Set(liveRun?.cases.map((c) => c.id) ?? []);
  const groups = [
    ...(liveRun?.cases ?? []).map((c) => ({
      id: c.id,
      subject: c.subject,
      docs: runDocs.filter((d) => d.case_id === c.id),
      facts: facts.filter((f) => f.case_id === c.id),
    })),
    ...(facts.some((f) => !caseIds.has(f.case_id))
      ? [
          {
            id: 'unlinked',
            subject: 'Not linked to a case',
            docs: runDocs.filter((d) => !caseIds.has(d.case_id)),
            facts: facts.filter((f) => !caseIds.has(f.case_id)),
          },
        ]
      : []),
  ];

  const visibleCount = facts.filter(keep).length;

  const correctionsFor = (factId: string) => corrections.filter((c) => c.factId === factId);

  function logCorrection(entry: Omit<LoggedCorrection, 'id'>) {
    correctionSeq.current += 1;
    setCorrections((current) => [{ id: correctionSeq.current, ...entry }, ...current]);
  }

  async function onFiles(files: FileList) {
    setUploadError(null);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set('file', file);
      try {
        const doc = await uploadDocumentAction(form);
        setUploaded((current) => [...current, { id: doc.id, name: doc.name }]);
      } catch {
        setUploadError(`${file.name} could not be read. Upload a PDF or a text file.`);
      }
    }
  }

  const blockedReason = !installedPack
    ? 'This workspace has no Pack installed, so there is nothing to run.'
    : startableDocIds.length === 0
      ? 'Add at least one document to run.'
      : running
        ? 'A run is already in progress.'
        : null;

  async function start() {
    if (starting || blockedReason) return;
    setStarting(true);
    setRunError(null);
    try {
      await startRunAction(workspaceId, session.id, startableDocIds);
      router.refresh();
    } catch {
      setRunError('The run could not be started. Check that the workspace Pack is installed and its documents are readable.');
    }
    setStarting(false);
  }

  async function saveTitle() {
    const next = title.trim();
    if (!next) return;
    await updateSessionAction(workspaceId, session.id, { title: next });
    setIsRenaming(false);
    router.refresh();
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    setMessages((current) => [...current, { role: 'user', content }]);
    setInput('');
    setStreaming(true);
    setReply('');
    replyRef.current = '';
    try {
      const res = await fetch(`/workspace/${workspaceId}/sessions/${session.id}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: content }),
      });
      if (!res.ok || !res.body) throw new Error('chat request failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = JSON.parse(line.slice(6)) as { type: string; text?: string };
            if (payload.type === 'token' && typeof payload.text === 'string') {
              replyRef.current += payload.text;
              setReply(replyRef.current);
            }
          }
        }
      }
    } catch {
      replyRef.current = 'I could not answer that right now. Try again in a moment.';
      setReply(replyRef.current);
    }
    setStreaming(false);
    setMessages((current) => [...current, { role: 'assistant', content: replyRef.current }]);
  }

  const renderedMessages = [
    ...messages,
    ...(streaming ? [{ role: 'assistant' as const, content: reply }] : []),
  ];

  const runControl = (
    <ActionButton
      size="md"
      variant={liveRun ? 'secondary' : 'primary'}
      icon={liveRun ? <IconRefresh className="ic sm" /> : <IconPlay className="ic sm" />}
      onClick={() => void start()}
      disabled={starting || blockedReason !== null}
    >
      {starting ? 'Starting…' : running ? 'Run in progress' : liveRun ? 'Run again' : 'Start run'}
    </ActionButton>
  );

  return (
    <div className="rev">
      <header className="rev-head">
        <div className="rev-head-id">
          <p className="eyebrow">{workspaceName} · Session</p>
          {isRenaming ? (
            <div className="rev-rename">
              <label className="sr-only" htmlFor={`${ids}-title`}>
                Session title
              </label>
              <input
                id={`${ids}-title`}
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <ActionButton size="sm" variant="primary" onClick={() => void saveTitle()} disabled={!title.trim()}>
                Save
              </ActionButton>
              <ActionButton size="sm" variant="ghost" onClick={() => setIsRenaming(false)}>
                Cancel
              </ActionButton>
            </div>
          ) : (
            <h1 className="page-title rev-title">
              {title}
              {liveRun ? (
                <Pill tone={STATUS_TONE[status]} dot={running}>
                  {STATUS_LABEL[status]}
                </Pill>
              ) : (
                <Pill tone="neutral">Not run</Pill>
              )}
            </h1>
          )}
          <div className="rev-prov">
            {liveRun ? (
              <>
                <Stamp>
                  Pack {liveRun.pack_name} v{liveRun.pack_version}
                </Stamp>
                {/* Singapore time, 24-hour, DD/MM/YYYY — the house standard, and stated so
                    nobody reads a local clock as UTC. */}
                <Stamp>Run {formatDateTime(liveRun.started_at)} SGT</Stamp>
                <Stamp>Run id {liveRun.id.slice(0, 8)}</Stamp>
              </>
            ) : installedPack ? (
              <Stamp>
                Pack {installedPack.name}
                {installedPack.version !== null ? ` v${installedPack.version}` : ''}
              </Stamp>
            ) : (
              <Stamp>No Pack installed</Stamp>
            )}
            {liveSession.subject && <Stamp>Subject {liveSession.subject}</Stamp>}
          </div>
        </div>

        <div className="rev-head-act">
          {runControl}
          <ActionMenu onRename={() => setIsRenaming(true)} onDelete={() => setIsDeleteOpen(true)} />
        </div>

        {(blockedReason || runError) && (
          <p className={`rev-head-hint${runError ? ' is-err' : ''}`} role={runError ? 'alert' : undefined}>
            {runError ?? blockedReason}
            {!runError && !installedPack && (
              <>
                {' '}
                <Button href={`/workspace/${workspaceId}/pack`} variant="ghost" size="sm">
                  Open Pack
                </Button>
              </>
            )}
          </p>
        )}
      </header>

      <div className="rev-body">
        <main className="rev-main">
          {!liveRun && (
            <EmptyState
              icon={<IconPlay className="ic lg" />}
              title="Nothing has been run for this case yet"
              body="Add the case's documents, then start the run. Every field and rule the Pack defines comes back here in one of three states — verified, unsupported, missing — each with the sentence in the source that supports it."
              action={
                <FileButton
                  variant="secondary"
                  icon={<IconPlus className="ic sm" />}
                  accept=".pdf,.txt"
                  multiple
                  onFiles={(files) => void onFiles(files)}
                >
                  Add documents
                </FileButton>
              }
            />
          )}

          {running && (
            <section className="card rev-live" aria-live="polite">
              <span className="rev-live-ic">
                <span className="spin-ic" />
              </span>
              <div>
                <h3>Running the Pack over {runDocs.length || startableDocIds.length} document{(runDocs.length || startableDocIds.length) === 1 ? '' : 's'}</h3>
                <p>
                  The engine reports completion, not per-stage progress, so there is no progress bar
                  to trust here. Results land in this list the moment the run finishes; this page
                  refreshes itself every two seconds.
                </p>
                <p className="rev-live-meta">
                  <Stamp>Started {formatDateTime(liveRun.started_at)}</Stamp>
                  <Stamp>
                    Elapsed {nowMs === null ? '—' : elapsedLabel(nowMs - new Date(liveRun.started_at).getTime())}
                  </Stamp>
                </p>
              </div>
            </section>
          )}

          {status === 'failed' && (
            <section className="card rev-failed">
              <span className="rev-live-ic is-err">
                <IconAlert className="ic lg" />
              </span>
              <div>
                <h3>The run did not finish</h3>
                <p>
                  The run record does not carry a reason — the API&rsquo;s run shape has no error
                  field — so there is nothing more this screen can tell you. Check that every
                  document opens and is text-bearing, then run again. Nothing was written to the
                  case.
                </p>
              </div>
            </section>
          )}

          {liveRun && status === 'complete' && (
            <section className="card rev-review" aria-labelledby={`${ids}-review`}>
              <div className="card-hd">
                <p className="chd-title" id={`${ids}-review`}>
                  Review
                  <span className="chd-count">
                    {counts.all} check{counts.all === 1 ? '' : 's'}
                  </span>
                </p>
                {/* No provenance stamp here: the sticky page header carries the pack version
                    and run time at every scroll position. */}
              </div>

              <div className="rev-triage">
                <p className="rev-triage-line">
                  {counts.attention === 0 ? (
                    <>
                      <b className="is-ok">Nothing needs a decision.</b> All {counts.fields} field
                      check{counts.fields === 1 ? '' : 's'}
                      {counts.rules > 0 && ` and all ${counts.rules} cross-document rule${counts.rules === 1 ? '' : 's'}`}{' '}
                      matched their sources.
                    </>
                  ) : (
                    <>
                      <b>
                        {counts.attention} of {counts.all} checks need a decision
                      </b>{' '}
                      — {counts.fieldsUnsupported} unsupported, {counts.fieldsMissing} missing across{' '}
                      {counts.fields} field check{counts.fields === 1 ? '' : 's'}
                      {counts.rules > 0 && (
                        <>
                          , plus {counts.rulesFailed} of {counts.rules} cross-document rule
                          {counts.rules === 1 ? '' : 's'} unsatisfied
                        </>
                      )}
                      .
                    </>
                  )}
                </p>

                {counts.fields > 0 && (
                  <div className="rev-meter" aria-hidden="true">
                    {counts.fieldsVerified > 0 && (
                      <i className="is-verified" style={{ flexGrow: counts.fieldsVerified }} />
                    )}
                    {counts.fieldsUnsupported > 0 && (
                      <i className="is-unsupported" style={{ flexGrow: counts.fieldsUnsupported }} />
                    )}
                    {counts.fieldsMissing > 0 && (
                      <i className="is-missing" style={{ flexGrow: counts.fieldsMissing }} />
                    )}
                  </div>
                )}

                <FilterTabs
                  value={activeFilter}
                  onChange={setFilter}
                  counts={{ attention: counts.attention, verified: counts.verified, all: counts.all }}
                  panelId={panelId}
                  idBase={`${ids}-tab`}
                />
              </div>

              <div id={panelId} role="tabpanel" aria-labelledby={`${ids}-tab-${activeFilter}`}>
                {counts.all === 0 ? (
                  <p className="rev-note">
                    This run produced no checks at all. The frozen Pack version it ran defines no
                    fields — open the Pack and add the fields this case should be checked against.
                  </p>
                ) : visibleCount === 0 ? (
                  <p className="rev-note">
                    {activeFilter === 'attention'
                      ? 'Nothing in this run needs a decision. Switch to All checks to read the verified results and their evidence.'
                      : 'No checks are verified in this run. Switch to Needs attention to work through the gaps.'}
                  </p>
                ) : (
                  groups.map((group) => {
                    const fieldRows = group.facts.filter((f) => !isRuleFact(f)).filter(keep);
                    const ruleRows = group.facts.filter(isRuleFact).filter(keep);
                    const shown = fieldRows.length + ruleRows.length;
                    if (shown === 0) return null;
                    return (
                      <div key={group.id} className="rev-case">
                        <div className="rev-case-hd">
                          <h3>{group.subject}</h3>
                          <span className="rev-case-meta">
                            {group.docs.length} document{group.docs.length === 1 ? '' : 's'} ·{' '}
                            {shown === group.facts.length
                              ? `${group.facts.length} check${group.facts.length === 1 ? '' : 's'}`
                              : `${shown} of ${group.facts.length} checks shown`}
                          </span>
                        </div>

                        {fieldRows.length > 0 && (
                          <>
                            <p className="rev-grp">Field checks</p>
                            {fieldRows.map((fact) => (
                              <CheckRow
                                key={fact.id}
                                fact={fact}
                                runId={liveRun.id}
                                workspaceId={workspaceId}
                                description={describe(fact)}
                                corrections={correctionsFor(fact.id)}
                                onLogged={logCorrection}
                              />
                            ))}
                          </>
                        )}

                        {ruleRows.length > 0 && (
                          <>
                            <p className="rev-grp">Cross-document rules</p>
                            {ruleRows.map((fact) => (
                              <CheckRow
                                key={fact.id}
                                fact={fact}
                                runId={liveRun.id}
                                workspaceId={workspaceId}
                                description={describe(fact)}
                                corrections={correctionsFor(fact.id)}
                                onLogged={logCorrection}
                              />
                            ))}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {spec === null && liveRun && (
                <p className="rev-foot-note">
                  The frozen spec for Pack v{liveRun.pack_version} could not be loaded, so field
                  descriptions and rule text are not shown. The results themselves are unaffected.
                </p>
              )}
            </section>
          )}

          {liveRun && status === 'complete' && (
            <section className="card rev-ledger" aria-labelledby={`${ids}-ledger`}>
              <div className="card-hd">
                <p className="chd-title" id={`${ids}-ledger`}>
                  Correction ledger
                  <span className="chd-count">{corrections.length}</span>
                </p>
                <Tag variant="outline">Append-only</Tag>
              </div>
              {corrections.length === 0 ? (
                <p className="rev-note">
                  Empty until you correct something. Every correction is appended here with the
                  value it replaced, the reason you gave, and a timestamp — and the run keeps the
                  result the engine produced. Corrections feed the next proposed Pack version;
                  they never rewrite this one.
                </p>
              ) : (
                <ul className="rev-ledger-list">
                  {corrections.map((correction) => (
                    <li key={correction.id} className="rev-ledger-row">
                      <span className="rev-key">{correction.field}</span>
                      <span className="rev-ledger-change">
                        <s>{correction.from ?? 'no value'}</s>
                        <span className="sr-only">corrected to</span>
                        <IconArrowRight className="ic sm" />
                        <b>{correction.to}</b>
                      </span>
                      <time dateTime={new Date(correction.at).toISOString()}>
                        {formatDateTime(correction.at)}
                      </time>
                      {correction.note && <p>{correction.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {corrections.length > 0 && (
                <p className="rev-foot-note">
                  These are the corrections logged in this view. The API accepts corrections but
                  exposes no endpoint to read them back, so reloading this page will empty the list
                  — the records themselves are kept server-side.
                </p>
              )}
            </section>
          )}
        </main>

        <aside className="rev-side" aria-label="Case context">
          <section className="card">
            <div className="card-hd">
              <p className="chd-title">
                <IconDoc className="ic sm" />
                Documents
                <span className="chd-count">{runDocs.length + pendingDocs.length}</span>
              </p>
            </div>
            {runDocs.length === 0 && pendingDocs.length === 0 ? (
              <p className="rev-note">
                No documents yet. Add the files this case is made of — the Pack classifies each one
                before it extracts anything.
              </p>
            ) : (
              <ul className="rev-docs">
                {runDocs.map((doc) => (
                  <li key={doc.id}>
                    <IconDoc className="ic" />
                    <span className="rev-doc-name">{doc.name}</span>
                    {doc.doc_type ? (
                      <Tag variant="accent">{doc.doc_type}</Tag>
                    ) : (
                      <Tag variant="outline">unclassified</Tag>
                    )}
                  </li>
                ))}
                {pendingDocs.map((doc) => (
                  <li key={doc.id}>
                    <IconDoc className="ic" />
                    <span className="rev-doc-name">{doc.name}</span>
                    <Tag variant="warn">not in a run</Tag>
                  </li>
                ))}
              </ul>
            )}
            <div className="rev-side-act">
              <FileButton
                variant="secondary"
                size="sm"
                icon={<IconPlus className="ic sm" />}
                accept=".pdf,.txt"
                multiple
                onFiles={(files) => void onFiles(files)}
                className="wfull"
              >
                Add documents
              </FileButton>
              {uploadError && (
                <p className="rev-err" role="alert">
                  {uploadError}
                </p>
              )}
              {pendingDocs.length > 0 && (
                <p className="rev-fine">
                  Uploaded files attach to the case when a run starts. Leave this page before
                  starting one and you will need to add them again.
                </p>
              )}
            </div>
          </section>

          {liveRun && (
            <section className="card rev-kv">
              <div className="card-hd">
                <p className="chd-title">Run provenance</p>
              </div>
              <div className="rev-kv-body">
                <Kv k="Pack" v={liveRun.pack_name} />
                <Kv k="Version" v={<span className="mono">v{liveRun.pack_version}</span>} />
                <Kv k="Run id" v={<span className="mono">{liveRun.id.slice(0, 8)}</span>} />
                <Kv k="Started" v={formatDateTime(liveRun.started_at)} />
                <Kv k="Status" v={STATUS_LABEL[status]} />
                <Kv k="Field checks" v={counts.fields} />
                <Kv k="Cross-document rules" v={counts.rules} />
              </div>
              <p className="rev-foot-note">
                Runs pin the exact Pack version that produced them. Re-running after the Pack is
                revised creates a new run against the new version; this one never changes. All times
                on this page are Singapore time (SGT), 24-hour.
              </p>
            </section>
          )}

          <details className="card rev-disc">
            <summary>
              <IconSparkle className="ic sm" />
              Ask about this case
              <span className="rev-disc-n">{messages.length}</span>
            </summary>
            <div className="rev-disc-body">
              <p className="rev-fine">
                {status === 'complete'
                  ? 'Answers are drawn from this run’s documents and cite what they use. Asking never changes the run or its results.'
                  : 'Answers are only grounded in source documents once a run has completed. Until then the assistant will say so rather than guess.'}
              </p>
              {renderedMessages.length > 0 && (
                <div className="rev-chat">
                  {renderedMessages.map((message, index) => (
                    <div key={index} className={`msg${message.role === 'user' ? ' me' : ''}`}>
                      {message.role === 'assistant' && (
                        <span className="msg-av">
                          <IconSparkle className="ic sm" />
                        </span>
                      )}
                      <div className="msg-bubble rev-bubble">{message.content}</div>
                    </div>
                  ))}
                </div>
              )}
              <form
                className="rev-ask"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(input);
                }}
              >
                <label className="sr-only" htmlFor={`${ids}-ask`}>
                  Ask about this case
                </label>
                <input
                  id={`${ids}-ask`}
                  className="input sm"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="e.g. where does the liability cap come from?"
                />
                <IconButton
                  type="submit"
                  variant="accent"
                  label="Send question"
                  icon={<IconArrowRight className="ic sm" />}
                  disabled={!input.trim() || streaming}
                />
              </form>
            </div>
          </details>

          <details className="card rev-disc">
            <summary>
              Other result surfaces
              <span className="rev-disc-n">roadmap</span>
            </summary>
            <div className="rev-disc-body">
              <p className="rev-fine">
                Checklist — this screen — is the surface that exists. The rest are named
                destinations, not hidden tabs:
              </p>
              <ul className="rev-roadmap">
                <li>
                  <b>Grid</b> — the same fields compared across many cases. Needs per-document
                  values a single run does not expose.
                </li>
                <li>
                  <b>Rollup</b> — findings aggregated over a portfolio. Needs a cross-run query the
                  API does not offer.
                </li>
                <li>
                  <b>Diff</b> — two versions of one document compared. Needs versioned document
                  storage.
                </li>
                <li>
                  <b>Explorer</b> — traversal of verified facts. Phase 2, gated on a real Pack that
                  needs it.
                </li>
              </ul>
            </div>
          </details>
        </aside>
      </div>

      {isDeleteOpen && (
        <div
          className="overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsDeleteOpen(false);
          }}
        >
          <section
            ref={deleteRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${ids}-del`}
            aria-describedby={`${ids}-del-copy`}
            className="modal"
          >
            <div className="modal-hd">
              <p className="eyebrow text-missing">Destructive action</p>
              <h2 id={`${ids}-del`}>Delete this session?</h2>
            </div>
            <div className="modal-bd">
              <p id={`${ids}-del-copy`} className="cbd">
                This removes “{title}”, its run, and the corrections logged against it. The
                documents themselves stay in the workspace. This cannot be undone.
              </p>
            </div>
            <div className="modal-ft">
              <ActionButton variant="secondary" onClick={() => setIsDeleteOpen(false)}>
                Keep session
              </ActionButton>
              <ActionButton variant="danger" onClick={() => void deleteSessionAction(workspaceId, session.id)}>
                Delete session
              </ActionButton>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
