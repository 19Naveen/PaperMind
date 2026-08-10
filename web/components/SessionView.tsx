'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ChatMessage, Fact, FactState, RunOut, RunStatus, WorkspaceSessionOut } from '@/lib/api';
import { correctFactAction, deleteSessionAction, startRunAction, updateSessionAction, uploadDocumentAction } from '@/lib/session';
import { ActionButton, EmptyState, Input, Pill, Progress, Tag, type PillTone } from '@/components/ui';
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconClose,
  IconDoc,
  IconGrid,
  IconLayers,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkle,
} from '@/lib/icons';

/** The engine's fixed execution order — mirrors backend/app/runtime.py STAGES. */
const RUN_STAGES = ['classify', 'retrieve', 'extract', 'verify', 'cross-validate', 'report'] as const;

const STATUS_TONE: Record<RunStatus, PillTone> = {
  pending: 'neutral',
  running: 'running',
  complete: 'verified',
  failed: 'missing',
};

type Surface = 'checklist' | 'grid' | 'diff' | 'explorer';

const SURFACE_TABS: { id: Surface; label: string; icon: ReactNode }[] = [
  { id: 'checklist', label: 'Checklist', icon: <IconCheck className="ic sm" /> },
  { id: 'grid', label: 'Grid', icon: <IconGrid className="ic sm" /> },
  { id: 'diff', label: 'Diff', icon: <IconLayers className="ic sm" /> },
  { id: 'explorer', label: 'Explorer', icon: <IconSearch className="ic sm" /> },
];

/** Padlock — used on the locked/roadmap surfaces. Not in icons.tsx; inline keeps globals/ui untouched. */
function IconLock({ className = 'ic' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function utcHHMM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** State pill — verified/missing via the Pill primitive; unsupported needs `.pill.warn`, which the
 * primitive does not expose, so it is rendered directly with the reference class. */
function StatePill({ state }: { state: FactState }) {
  if (state === 'verified') return <Pill tone="verified" dot>Verified</Pill>;
  if (state === 'missing') return <Pill tone="missing" dot>Missing</Pill>;
  return (
    <span className="pill warn">
      <span className="dot" />
      Unsupported
    </span>
  );
}

function stateIcon(state: FactState) {
  if (state === 'verified') return <IconCheck className="ic sm" />;
  if (state === 'unsupported') return <IconAlert className="ic sm" />;
  return <IconClose className="ic sm" />;
}

/** One fact as a `.chk` row. Corrections append via `correctFactAction` and stay logged-only. */
function FactRow({ fact, runId, workspaceId }: { fact: Fact; runId: string; workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(fact.value ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const correctable = fact.state !== 'verified';
  const citation = fact.citations[0];

  async function submit() {
    if (!value.trim() || saving) return;
    setSaving(true);
    await correctFactAction(workspaceId, runId, fact.id, value.trim(), note.trim() || undefined);
    setSaving(false);
    setSaved(true);
    setOpen(false);
  }

  return (
    <div className={`chk st-${fact.state}`}>
      <div className="chk-ic">{stateIcon(fact.state)}</div>
      <div>
        <div className="chk-line1">
          <span className="chk-name">{fact.field}</span>
        </div>
        <div className="chk-value">{fact.value ?? '—'}</div>
        {citation && citation.quote && (
          <blockquote className="ev">
            “{citation.quote}”
            <cite>
              {citation.document_name} · page {citation.page}
            </cite>
          </blockquote>
        )}
      </div>
      <div className="chk-side">
        <StatePill state={fact.state} />
        {correctable && !saved && (
          <ActionButton size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? 'Close' : 'Correct'}
          </ActionButton>
        )}
        {saved && <span className="chk-note">Logged</span>}
      </div>
      {correctable && open && !saved && (
        <div className="chk-form">
          <Input value={value} onChange={setValue} placeholder="Corrected value" size="sm" />
          <Input value={note} onChange={setNote} placeholder="Note (optional)" size="sm" />
          <div className="row">
            <ActionButton size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </ActionButton>
            <ActionButton size="sm" variant="primary" onClick={() => void submit()} disabled={saving || !value.trim()}>
              {saving ? 'Saving…' : 'Save correction'}
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

interface SessionViewProps {
  workspaceId: string;
  workspaceName: string;
  session: WorkspaceSessionOut;
  run: RunOut | null;
}

export function SessionView({ workspaceId, workspaceName, session, run }: SessionViewProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(session.messages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [reply, setReply] = useState('');
  const [liveSession, setLiveSession] = useState(session);
  const [liveRun, setLiveRun] = useState(run);
  const [uploaded, setUploaded] = useState<{ id: string; name: string }[]>([]);
  const [starting, setStarting] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [surface, setSurface] = useState<Surface>('checklist');
  const replyRef = useRef('');

  const status: RunStatus =
    liveRun?.status ?? (liveSession.status === 'complete' ? 'complete' : 'pending');
  const running = status === 'pending' || status === 'running';

  // Documents visible in the rail: those already classified on the run plus any
  // uploaded this visit that the run has not seen yet.
  const railDocs = [
    ...(liveRun?.documents.map((d) => ({ id: d.id, name: d.name })) ?? []),
    ...uploaded.filter((u) => !liveRun?.documents.some((d) => d.id === u.id)),
  ];
  const hasDocs = railDocs.length > 0;

  // Poll the run route while the engine works (CLAUDE.md §4.2 wants TanStack Query for
  // this; it is not installed, so the poll goes through a route handler instead).
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/workspace/${workspaceId}/sessions/${session.id}/run`);
        if (!res.ok) return;
        const body = (await res.json()) as { session: WorkspaceSessionOut | null; run: RunOut | null };
        if (body.session) setLiveSession(body.session);
        if (body.run) setLiveRun(body.run);
      } catch {
        // transient poll failure — the next tick retries
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [workspaceId, session.id, running]);

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
    router.refresh();
  }

  async function onUpload(formData: FormData) {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return;
    const doc = await uploadDocumentAction(formData);
    setUploaded((current) => [...current, { id: doc.id, name: doc.name }]);
  }

  async function start() {
    if (starting) return;
    const ids = railDocs.map((d) => d.id);
    if (ids.length === 0) return;
    setStarting(true);
    await startRunAction(workspaceId, session.id, ids);
    router.refresh();
  }

  async function saveTitle() {
    const next = title.trim();
    if (!next) return;
    await updateSessionAction(workspaceId, session.id, { title: next });
    setIsRenaming(false);
    router.refresh();
  }

  // Pipeline progress — bar fills to the reached stage, full when the run is terminal.
  const activeIndex = liveRun?.stage
    ? RUN_STAGES.indexOf(liveRun.stage as (typeof RUN_STAGES)[number])
    : -1;
  const finished = status === 'complete' || status === 'failed';
  const progressPct = finished ? 100 : activeIndex >= 0 ? Math.round(((activeIndex + 1) / RUN_STAGES.length) * 100) : 0;
  const pipeTime = liveRun && utcHHMM(liveRun.started_at) ? `${utcHHMM(liveRun.started_at)} UTC` : '—';

  const statusLabel = status === 'running'
    ? liveRun?.stage ? titleCase(liveRun.stage) : 'Running'
    : status === 'complete' ? 'Complete'
    : status === 'failed' ? 'Failed'
    : 'Pending';

  const stamp = liveRun
    ? `Pack ${liveRun.pack_name} v${liveRun.pack_version}${utcHHMM(liveRun.started_at) ? ` · ${utcHHMM(liveRun.started_at)} UTC` : ''}`
    : 'No run yet';

  const renderedMessages = [...messages, ...(streaming ? [{ role: 'assistant' as const, content: reply }] : [])];

  // Checklist summary counts — counted from real run facts by state.
  const facts = liveRun?.facts ?? [];
  const counts = {
    total: facts.length,
    verified: facts.filter((f) => f.state === 'verified').length,
    unsupported: facts.filter((f) => f.state === 'unsupported').length,
    missing: facts.filter((f) => f.state === 'missing').length,
  };

  const showResults = liveRun && status === 'complete';

  return (
    <section className="view full active">
      <div className="sess-head page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="eyebrow">{workspaceName} · Session</p>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
            {isRenaming ? (
              <>
                <label className="sr-only" htmlFor="session-title-edit">Session title</label>
                <input
                  id="session-title-edit"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="input"
                  style={{ width: 'min(70vw, 360px)', height: 38 }}
                />
                <ActionButton size="sm" variant="primary" onClick={() => void saveTitle()} disabled={!title.trim()}>
                  Save
                </ActionButton>
              </>
            ) : (
              <>
                {title}
                <Pill tone={STATUS_TONE[status]} dot={running}>{statusLabel}</Pill>
              </>
            )}
          </h1>
          <p className="page-sub" style={{ marginTop: 6 }}>
            <span className="stamp">{stamp}</span>
          </p>
        </div>
        <div className="page-actions">
          <ActionButton size="sm" variant="ghost" onClick={() => setIsRenaming((value) => !value)}>
            {isRenaming ? 'Cancel' : 'Rename'}
          </ActionButton>
          <ActionButton size="sm" variant="danger" onClick={() => setIsDeleteOpen(true)}>
            Delete
          </ActionButton>
        </div>
      </div>

      <div className="sess-body">
        <aside className="sess-rail" aria-label="Run state">
          {/* Pipeline */}
          <div className="card">
            <div className="card-hd">
              <h3>Pipeline</h3>
              <span className="mono muted">{pipeTime}</span>
            </div>
            <Progress value={progressPct} />
            <ol className="stages">
              {RUN_STAGES.map((stage, index) => {
                const done = finished || (activeIndex >= 0 && index < activeIndex);
                const isRunning = status === 'running' && index === activeIndex;
                return (
                  <li key={stage} className={`stage${done ? ' done' : ''}${isRunning ? ' running' : ''}`}>
                    <span className="st-ic">
                      {done ? <IconCheck className="ic sm" /> : isRunning ? <span className="spin-ic" /> : index + 1}
                    </span>
                    <span className="st-name">{stage}</span>
                    <span className="st-t">{done ? 'done' : isRunning ? 'running…' : '—'}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Documents */}
          <div className="card">
            <div className="card-hd">
              <h3>Documents</h3>
              <Tag variant="outline">{railDocs.length}</Tag>
            </div>
            {railDocs.length > 0 ? (
              <ul className="doc-list">
                {railDocs.map((doc) => (
                  <li key={doc.id} className="doc-row">
                    <IconDoc className="ic" />
                    <span className="doc-name">{doc.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fineprint" style={{ padding: '4px 16px 10px' }}>
                No documents uploaded.
              </p>
            )}
            <form action={onUpload} style={{ padding: '0 12px 4px' }}>
              {/* Hand-rolled: a <label> must wrap the hidden file input so a click opens the
                  file picker. ActionButton renders a <button>, which cannot wrap-and-forward
                  to an <input type="file">, so this stays a `.btn` label rather than the
                  primitive. Report: ui.tsx has no upload/file-trigger primitive for this. */}
              <label className="btn secondary wfull" style={{ cursor: 'pointer' }}>
                <IconPlus className="ic sm" />
                Add documents
                <input
                  name="file"
                  type="file"
                  accept=".pdf,.txt"
                  className="sr-only"
                  required
                  onChange={(event) => event.target.form?.requestSubmit()}
                />
              </label>
            </form>
            {/* The session's only run trigger. It previously sat in the page header;
                moved here, beside the documents its `hasDocs`/disabled condition
                depends on. */}
            <div style={{ padding: '0 12px 12px' }}>
              <ActionButton
                size="md"
                variant={!liveRun ? 'primary' : 'secondary'}
                icon={!liveRun ? <IconPlay className="ic sm" /> : <IconRefresh className="ic sm" />}
                onClick={() => void start()}
                disabled={starting || running || !hasDocs}
                className="wfull"
              >
                {starting ? 'Starting…' : running ? 'Run in progress' : liveRun ? 'Re-run' : 'Start run'}
              </ActionButton>
            </div>
          </div>

          {/* Ask about this run */}
          <div className="card">
            <div className="card-hd">
              <h3>Ask about this run</h3>
              <IconSparkle className="ic sm text-ink-3" />
            </div>
            <div className="ask-log">
              {renderedMessages.length === 0 ? (
                <p className="fineprint">
                  Ask where a result came from — answers cite the source span. The run itself never changes.
                </p>
              ) : (
                renderedMessages.map((message, index) => (
                  <div key={index} className={`msg${message.role === 'user' ? ' me' : ''}`}>
                    {message.role === 'assistant' && (
                      <span className="msg-av">
                        <IconSparkle className="ic sm" />
                      </span>
                    )}
                    <div className="msg-bubble" style={{ whiteSpace: 'pre-line' }}>{message.content}</div>
                  </div>
                ))
              )}
            </div>
            <form
              className="ask-form"
              onSubmit={(event) => {
                event.preventDefault();
                void send(input);
              }}
            >
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="e.g. where does the cap come from?"
                aria-label="Ask about this run"
              />
              {/* Hand-rolled: `.iconbtn` is a distinct circular icon-only control, not part of
                  the `.btn` family ActionButton wraps — no icon-only-button primitive exists
                  in ui.tsx to convert this to. Report: candidate for an IconButton primitive. */}
              <button className="iconbtn acc" type="submit" aria-label="Ask" disabled={!input.trim() || streaming}>
                <IconArrowRight className="ic sm" />
              </button>
            </form>
          </div>
        </aside>

        <section className="sess-content">
          <div className="seg" role="tablist" aria-label="Result surfaces" style={{ alignSelf: 'flex-start' }}>
            {SURFACE_TABS.map((tab) => (
              <button key={tab.id} type="button" aria-pressed={surface === tab.id} onClick={() => setSurface(tab.id)}>
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {surface === 'checklist' && (
            <>
              {!liveRun ? (
                <EmptyState
                  icon={<IconPlay className="ic lg" />}
                  title="No run yet"
                  body="Add documents and start the run from the Documents panel. The Pack executes its six stages — classify, retrieve, extract, verify, cross-validate, report — and the extracted facts appear here with their citations."
                />
              ) : running ? (
                <EmptyState
                  icon={<IconRefresh className="ic lg" />}
                  title={`${liveRun.stage ? titleCase(liveRun.stage) : 'Queued'}…`}
                  body="The engine is working through the Pack's stages. This page updates itself; the results land here when the run completes."
                />
              ) : status === 'failed' ? (
                <EmptyState
                  icon={<IconAlert className="ic lg" />}
                  title="The run did not complete"
                  body="Check the uploaded documents, then start the run again from the Documents panel."
                />
              ) : showResults ? (
                <>
                  {/* Summary strip */}
                  <div className="card summary" role="group" aria-label="Run summary">
                    <div className="sum-cell">
                      <div className="v">{counts.total}</div>
                      <div className="l">Checks</div>
                    </div>
                    <div className="sum-cell ok">
                      <div className="v">{counts.verified}</div>
                      <div className="l">Verified</div>
                    </div>
                    <div className="sum-cell warn">
                      <div className="v">{counts.unsupported}</div>
                      <div className="l">Unsupported</div>
                    </div>
                    <div className="sum-cell dgr">
                      <div className="v">{counts.missing}</div>
                      <div className="l">Missing</div>
                    </div>
                  </div>

                  {/* Checklist results, grouped by case */}
                  <div className="card">
                    <div className="card-hd">
                      <h3>Checklist results</h3>
                    </div>
                    {liveRun.cases.length === 0 && facts.length === 0 ? (
                      <p className="fineprint" style={{ padding: '12px 16px' }}>
                        This run extracted no fields — check the Pack’s spec and the documents.
                      </p>
                    ) : (
                      liveRun.cases.map((c) => {
                        const caseFacts = facts.filter((fact) => fact.case_id === c.id);
                        return (
                          <div key={c.id}>
                            <div className="grp">
                              <span className="grp-name">{c.subject}</span>
                              <span className="grp-meta">{caseFacts.length} field{caseFacts.length === 1 ? '' : 's'}</span>
                            </div>
                            {caseFacts.length === 0 ? (
                              <p className="fineprint" style={{ padding: '4px 16px 10px' }}>
                                No facts for this case.
                              </p>
                            ) : (
                              caseFacts.map((fact) => (
                                <FactRow key={fact.id} fact={fact} runId={liveRun.id} workspaceId={workspaceId} />
                              ))
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Correction ledger — honest empty: corrections are persisted but not yet listed back. */}
                  <div className="card">
                    <div className="card-hd">
                      <h3>Correction ledger</h3>
                      <span className="muted text-xs">Logged, never silently applied</span>
                    </div>
                    <p className="fineprint" style={{ padding: '14px 16px', margin: 0 }}>
                      Corrections are logged as they’re made; a read-back view is coming. Each correction feeds the next Pack draft.
                    </p>
                  </div>
                </>
              ) : null}
            </>
          )}

          {surface === 'grid' && (
            <EmptyState
              icon={<IconLock className="ic lg" />}
              title="Grid is on the roadmap"
              body="Grid (field comparison across documents) is on the roadmap; it needs per-document values the run doesn’t expose yet."
            />
          )}

          {surface === 'diff' && (
            <EmptyState
              icon={<IconLock className="ic lg" />}
              title="Diff is on the roadmap"
              body="Document diff is on the roadmap; it needs versioned document storage."
            />
          )}

          {surface === 'explorer' && (
            <EmptyState
              icon={<IconLock className="ic lg" />}
              title="Explorer is a Phase 2 destination"
              body="Explorer is a Phase 2 destination — ships when a real Pack needs fact-relationship traversal."
            />
          )}
        </section>
      </div>

      {isDeleteOpen && (
        <div
          className="overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsDeleteOpen(false);
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
            aria-describedby="delete-session-copy"
            className="modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setIsDeleteOpen(false);
            }}
          >
            <div className="modal-hd">
              <p className="eyebrow text-missing">Destructive action</p>
              <h2 id="delete-session-title">Delete this session?</h2>
            </div>
            <div className="modal-bd">
              <p id="delete-session-copy" className="cbd">This removes “{title}” and its workspace history. This cannot be undone.</p>
            </div>
            <div className="modal-ft">
              <ActionButton variant="secondary" onClick={() => setIsDeleteOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton variant="danger" onClick={() => void deleteSessionAction(workspaceId, session.id)}>
                Delete session
              </ActionButton>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
