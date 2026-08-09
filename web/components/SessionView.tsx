'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ChatMessage, Fact, RunOut, RunStatus, WorkspaceSessionOut } from '@/lib/api';
import { correctFactAction, deleteSessionAction, startRunAction, updateSessionAction, uploadDocumentAction } from '@/lib/session';
import {
  ActionButton,
  Card,
  CardBody,
  CardKicker,
  CardTitle,
  Divider,
  PageHeader,
  Pill,
  Tag,
  type PillTone,
} from '@/components/ui';

/** The engine's fixed execution order — mirrors backend/app/runtime.py STAGES. */
const RUN_STAGES = ['classify', 'retrieve', 'extract', 'verify', 'cross-validate', 'report'] as const;

const STATUS_TONE: Record<RunStatus, PillTone> = {
  pending: 'neutral',
  running: 'running',
  complete: 'verified',
  failed: 'missing',
};

const FACT_TONE: Record<Fact['state'], PillTone> = {
  verified: 'verified',
  unsupported: 'missing',
  missing: 'neutral',
};

/** A run's stage timeline: done before the current stage, active at it, pending after. */
function StageTimeline({ run }: { run: RunOut }) {
  const activeIndex = run.stage ? RUN_STAGES.indexOf(run.stage as (typeof RUN_STAGES)[number]) : -1;
  const finished = run.status === 'complete' || run.status === 'failed';
  return (
    <ol className="divide-y divide-rule">
      {RUN_STAGES.map((stage, index) => {
        const done = finished || (activeIndex >= 0 && index < activeIndex);
        const active = run.status === 'running' && index === activeIndex;
        return (
          <li key={stage} className="grid grid-cols-[30px_1fr_auto] items-center gap-2 py-2 text-[12px]">
            <span className={`font-data ${done ? 'text-verified' : active ? 'text-running' : 'text-ink-3'}`}>
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className={done || active ? 'text-ink' : 'text-ink-3'}>{stage}</span>
            <span className={`font-data text-[10px] ${done ? 'text-verified' : active ? 'text-running' : 'text-ink-3'}`}>
              {done ? 'done' : active ? 'running…' : '—'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FactRow({ fact, runId, workspaceId }: { fact: Fact; runId: string; workspaceId: string }) {
  const [value, setValue] = useState(fact.value ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const correctable = fact.state !== 'verified';

  async function submit() {
    if (!value.trim() || saving) return;
    setSaving(true);
    await correctFactAction(workspaceId, runId, fact.id, value.trim(), note.trim() || undefined);
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="border-b border-rule py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-data text-[12px] font-medium text-ink">{fact.field}</span>
        <Pill tone={FACT_TONE[fact.state]}>{fact.state}</Pill>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{fact.value ?? '—'}</p>
      {fact.citations.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {fact.citations.map((citation, i) => (
            <blockquote key={i} className="border-l-2 border-rule pl-3">
              <p className="text-[12px] leading-relaxed text-ink-2">“{citation.quote}”</p>
              <p className="mt-0.5 font-data text-[10px] text-ink-3">
                {citation.document_name} · page {citation.page}
              </p>
            </blockquote>
          ))}
        </div>
      )}
      {correctable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={`Corrected value for ${fact.field}`}
            placeholder="Your corrected value"
            className="min-w-0 flex-1 border border-rule bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Optional note for the correction"
            placeholder="Note (optional)"
            className="w-40 border border-rule bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <ActionButton size="sm" variant={saved ? 'secondary' : 'primary'} onClick={submit} disabled={saving || saved}>
            {saved ? 'Recorded' : 'Propose correction'}
          </ActionButton>
        </div>
      )}
      {saved && (
        <p className="mt-1.5 text-[11.5px] text-ink-3" role="status">
          Correction recorded — it applies on the next run.
        </p>
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
  const [subject, setSubject] = useState(session.subject ?? '');
  const [subjectDirty, setSubjectDirty] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [chatDone, setChatDone] = useState(false);
  const replyRef = useRef('');
  const deleteDialogRef = useRef<HTMLElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  // Move focus into the delete dialog and return it to the Delete trigger on
  // close — a confirmation is a trap, not a tab-stop.
  useEffect(() => {
    if (!isDeleteOpen) return;
    deleteCancelRef.current?.focus();
    const trigger = deleteTriggerRef.current;
    return () => trigger?.focus();
  }, [isDeleteOpen]);

  const status: RunStatus =
    liveRun?.status ?? (liveSession.status === 'complete' ? 'complete' : 'pending');
  const running = status === 'pending' || status === 'running';

  // Poll the run route while the engine works (CLAUDE.md §4.2 wants TanStack Query for
  // this; it is not installed, so the poll goes through a route handler instead).
  // Backs off 2s → 8s as the run drags on, skips requests while the tab is hidden,
  // and refetches immediately when it becomes visible again.
  useEffect(() => {
    if (!running) return;
    let delay = 2000;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (stopped) return;
      if (document.visibilityState !== 'hidden') {
        try {
          const res = await fetch(`/workspace/${workspaceId}/sessions/${session.id}/run`);
          if (!res.ok) return;
          const body = (await res.json()) as { session: WorkspaceSessionOut | null; run: RunOut | null };
          if (body.session) setLiveSession(body.session);
          if (body.run) setLiveRun(body.run);
        } catch {
          // transient poll failure — the next tick retries
        }
      }
      delay = Math.min(delay * 1.5, 8000);
      if (document.visibilityState === 'hidden') delay = Math.max(delay, 8000);
      timer = setTimeout(tick, delay);
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return;
      if (timer) clearTimeout(timer);
      delay = 2000;
      void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [workspaceId, session.id, running]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    setMessages((current) => [...current, { role: 'user', content }]);
    setInput('');
    setStreaming(true);
    setChatDone(false);
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
    setChatDone(true);
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
    setStarting(true);
    await startRunAction(workspaceId, session.id, uploaded.map((d) => d.id));
    router.refresh();
  }

  async function saveSubject() {
    await updateSessionAction(workspaceId, session.id, { subject: subject.trim() || undefined });
    setSubjectDirty(false);
    router.refresh();
  }

  async function saveTitle() {
    const next = title.trim();
    if (!next) return;
    await updateSessionAction(workspaceId, session.id, { title: next });
    setIsRenaming(false);
    router.refresh();
  }

  const renderedMessages = [...messages, ...(streaming ? [{ role: 'assistant' as const, content: reply }] : [])];

  return (
    <main className="flex min-h-full flex-col bg-ground text-ink">
      <PageHeader
        eyebrow={`Session in ${workspaceName}`}
        title={isRenaming ? (
          <span className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="session-title-edit">Session title</label>
            <input id="session-title-edit" value={title} onChange={(event) => setTitle(event.target.value)} className="w-[min(72vw,360px)] border border-rule bg-surface px-2 py-1 font-sans text-[14px] font-normal text-ink outline-none focus:border-accent" />
            <ActionButton size="sm" variant="primary" onClick={() => void saveTitle()} disabled={!title.trim()}>Save</ActionButton>
          </span>
        ) : title}
        actions={
          <>
            <Tag variant="neutral">{liveRun ? `Pack ${liveRun.pack_name} v${liveRun.pack_version}` : 'Pack pending'}</Tag>
            <ActionButton size="sm" variant="secondary" onClick={() => setIsRenaming((value) => !value)}>{isRenaming ? 'Cancel' : 'Rename'}</ActionButton>
            <ActionButton ref={deleteTriggerRef} size="sm" variant="danger" onClick={() => setIsDeleteOpen(true)}>Delete</ActionButton>
          </>
        }
      />
      <div className="grid min-h-0 flex-1 lg:grid-cols-[452px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b-2 border-rule bg-surface lg:border-b-0 lg:border-r-2">
          <div className="flex items-center justify-between border-b border-rule px-5 py-3">
            <p className="eyebrow text-accent">Session state</p>
            <Pill tone={STATUS_TONE[status]} dot={running}>
              {status}
            </Pill>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            <section className="border-b border-rule py-4">
              <p className="eyebrow">Subject</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setSubjectDirty(true);
                  }}
                  aria-label="Session subject"
                  placeholder="What is this session reviewing?"
                  className="min-w-0 flex-1 border border-rule bg-raised px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
                />
                <ActionButton size="sm" onClick={saveSubject} disabled={!subjectDirty}>
                  Save
                </ActionButton>
              </div>
            </section>

            <section className="border-b border-rule py-4">
              <p className="eyebrow">Uploaded files</p>
              <div aria-live="polite">
              {uploaded.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {uploaded.map((file) => (
                    <div key={file.id} className="flex justify-between gap-3 font-data text-[11px]">
                      <span className="truncate">{file.name}</span>
                      <span className="text-ink-3">queued for run</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-ink-2">No documents uploaded.</p>
              )}
              </div>
              <form action={onUpload} className="mt-2 flex gap-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 border border-dashed border-rule px-2 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-ink">
                  Upload PDF or text
                  <input name="file" type="file" accept=".pdf,.txt" className="sr-only" required onChange={(e) => e.target.form?.requestSubmit()} />
                </label>
              </form>
              <button
                onClick={start}
                disabled={starting || running || uploaded.length === 0}
                className="mt-2 w-full border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {starting ? 'Starting…' : running ? 'Run in progress' : 'Start run'}
              </button>
            </section>

            {liveRun && (running || status === 'complete' || status === 'failed') && (
              <section className="border-b border-rule py-4">
                <p className="eyebrow text-accent">Pack execution</p>
                <div className="mt-2">
                  <StageTimeline run={liveRun} />
                </div>
              </section>
            )}

            <section aria-busy={streaming}>
              {renderedMessages.map((message, index) => (
                <article key={index} className={`border-b border-rule py-4 ${message.role === 'user' ? 'text-right' : ''}`}>
                  <p className={`eyebrow ${message.role === 'assistant' ? 'text-accent' : ''}`}>
                    {message.role === 'user' ? 'You' : 'PaperMind'}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{message.content}</p>
                </article>
              ))}
              <span className="sr-only" role="status">
                {streaming ? 'PaperMind is working…' : chatDone ? 'PaperMind finished responding.' : ''}
              </span>
            </section>
          </div>
          <form
            className="border-t-2 border-rule p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-label="Message PaperMind"
              placeholder="Ask about this session…"
              className="min-h-[68px] w-full resize-none border border-rule bg-raised p-2.5 text-[13px] outline-none focus:border-accent"
            />
            <ActionButton type="submit" variant="primary" disabled={!input.trim() || streaming} className="mt-2">
              {streaming ? 'Working…' : 'Send'}
            </ActionButton>
          </form>
        </aside>

        <section className="min-w-0 overflow-auto p-5 sm:p-7">
          {!liveRun ? (
            <div className="mx-auto mt-16 max-w-md border border-dashed border-rule bg-surface p-8 text-center">
              <p className="eyebrow text-accent">No run yet</p>
              <h2 className="display mt-2 text-[23px] font-extrabold">This session has not run</h2>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                Upload the documents to review, then start the run. The Pack executes its six
                stages — classify, retrieve, extract, verify, cross-validate, report — against
                them and the extracted facts appear here with their citations.
              </p>
            </div>
          ) : running ? (
            <div className="mx-auto mt-16 max-w-md border border-dashed border-rule bg-surface p-8 text-center">
              <p className="eyebrow text-running">Running</p>
              <h2 className="display mt-2 text-[23px] font-extrabold">{liveRun.stage ?? 'Queued'}…</h2>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                The engine is working through the Pack’s stages. This page updates itself;
                the results land here when the run completes.
              </p>
            </div>
          ) : status === 'failed' ? (
            <div className="mx-auto mt-16 max-w-md border border-dashed border-missing bg-missing-soft p-8 text-center">
              <p className="eyebrow text-missing">Failed</p>
              <h2 className="display mt-2 text-[23px] font-extrabold">The run did not complete</h2>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                Check the uploaded documents and start the run again.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <p className="eyebrow mr-auto">Extraction report</p>
                {liveRun.facts.length === 0 && <Tag variant="neutral">no facts extracted</Tag>}
              </div>
              <div className="mt-3 grid gap-3">
                {liveRun.cases.map((c) => {
                  const facts = liveRun.facts.filter((fact) => fact.case_id === c.id);
                  return (
                    <Card key={c.id} pad={false}>
                      <div className="border-b border-rule px-4 py-3">
                        <CardKicker>Case</CardKicker>
                        <CardTitle className="mt-0.5 text-[16px]">{c.subject}</CardTitle>
                      </div>
                      <div className="px-4 pb-1">
                        {facts.length === 0 ? (
                          <p className="py-3 text-[12px] text-ink-2">No facts for this case.</p>
                        ) : (
                          facts.map((fact) => (
                            <FactRow key={fact.id} fact={fact} runId={liveRun.id} workspaceId={workspaceId} />
                          ))
                        )}
                      </div>
                    </Card>
                  );
                })}
                {liveRun.facts.length === 0 && (
                  <p className="py-3 text-[12px] text-ink-2">
                    This run extracted no fields — check the Pack’s spec and the documents.
                  </p>
                )}
              </div>
              <Divider className="mt-8" />
              <section className="mt-4">
                <CardKicker>Why this run is comparable</CardKicker>
                <CardBody className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-2">
                  Every session executes the same Pack version — identical nodes, prompts,
                  assets and report template — pinned at the moment the run started.
                  Verified facts carry citations into the source text, so a fabricated
                  quote lands as unsupported, not verified.
                </CardBody>
              </section>
            </>
          )}
        </section>
      </div>
      {isDeleteOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsDeleteOpen(false); }}>
          <section
            ref={deleteDialogRef}
            tabIndex={-1}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
            aria-describedby="delete-session-copy"
            className="w-full max-w-md border-2 border-rule bg-ground p-5 shadow-lg"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setIsDeleteOpen(false);
              if (event.key === 'Tab' && deleteDialogRef.current) {
                const buttons = deleteDialogRef.current.querySelectorAll<HTMLButtonElement>('button');
                if (buttons.length === 0) return;
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <p className="eyebrow text-missing">Destructive action</p>
            <h2 id="delete-session-title" className="display mt-1 text-[21px]">Delete this session?</h2>
            <p id="delete-session-copy" className="mt-3 text-[13px] leading-relaxed text-ink-2">This removes “{title}” and its workspace history. This cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <ActionButton ref={deleteCancelRef} variant="secondary" onClick={() => setIsDeleteOpen(false)}>Cancel</ActionButton>
              <ActionButton variant="danger" onClick={() => void deleteSessionAction(workspaceId, session.id)}>Delete session</ActionButton>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
