'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import type { PackSpec } from '@/lib/api';
import { approveAndInstallAction, createStudioSessionAction } from '@/lib/session';
import { ActionButton, Card, CardKicker, EmptyState, PageHeader, Tag } from '@/components/ui';

interface ChatLine {
  role: 'user' | 'assistant';
  content: string;
}

const SESSION_KEY = (workspaceId: string) => `pm:studio:${workspaceId}`;

/** The Pack Studio: a conversational authoring session with the draft spec on the
 * right, and an explicit Approve gate that freezes a version and installs it. */
export function PackBuilderView({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState<PackSpec | null>(null);
  const [packName, setPackName] = useState('');
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const draftRef = useRef<PackSpec | null>(null);

  // Reconnect to a studio session from this workspace, if one exists — the draft
  // survives a reload even though the chat transcript is not replayed.
  useEffect(() => {
    const cached = window.sessionStorage.getItem(SESSION_KEY(workspaceId));
    if (cached) sessionIdRef.current = cached;
  }, [workspaceId]);

  function ensureSession(): string | null {
    if (sessionIdRef.current) return sessionIdRef.current;
    return null;
  }

  async function ensureSessionAsync(): Promise<string> {
    if (sessionIdRef.current) return sessionIdRef.current;
    const id = await createStudioSessionAction(`Pack for ${workspaceName}`);
    sessionIdRef.current = id;
    window.sessionStorage.setItem(SESSION_KEY(workspaceId), id);
    return id;
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    const sessionId = ensureSession();
    if (!sessionId) {
      try {
        await ensureSessionAsync();
      } catch {
        setError('Could not start the studio session.');
        return;
      }
    }
    const sid = ensureSession();
    if (!sid) return;
    setLines((current) => [...current, { role: 'user', content }]);
    setInput('');
    setStreaming(true);
    setError(null);
    try {
      const res = await fetch(`/workspace/${workspaceId}/pack/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, text: content }),
      });
      if (!res.ok || !res.body) throw new Error('studio request failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistant = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = JSON.parse(line.slice(6)) as { type: string; text?: string; spec?: PackSpec };
            if (payload.type === 'token' && typeof payload.text === 'string') {
              assistant += payload.text;
              setLines((current) => {
                const next = [...current];
                next[next.length - 1] = { role: 'assistant', content: assistant };
                return next;
              });
            } else if (payload.type === 'draft_spec' && payload.spec) {
              draftRef.current = payload.spec;
              setDraft(payload.spec);
              setPackName(payload.spec.name || '');
            }
          }
        }
      }
      setLines((current) => {
        const next = [...current];
        next[next.length - 1] = { role: 'assistant', content: assistant || 'I could not draft that right now.' };
        return next;
      });
    } catch {
      setLines((current) => [...current, { role: 'assistant', content: 'I could not draft that right now.' }]);
    }
    setStreaming(false);
  }

  function approve() {
    const sid = ensureSession();
    const name = packName.trim();
    if (!sid || !draftRef.current || !name || approving) return;
    setApproving(true);
    setError(null);
    startTransition(() => {
      approveAndInstallAction(workspaceId, sid, name).catch((err: unknown) => {
        setApproving(false);
        setError(err instanceof Error ? err.message : 'Could not approve the Pack.');
      });
    });
  }

  const pending = streaming ? [...lines, { role: 'assistant' as const, content: '…' }] : lines;

  return (
    <main className="min-h-full bg-ground text-ink">
      <PageHeader
        eyebrow="Pack Studio"
        title={`Author a Pack for ${workspaceName}`}
        actions={<Tag variant="neutral">{draft ? 'Draft ready' : 'Conversation mode'}</Tag>}
      />
      <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-h-0 flex-col border-t-2 border-rule">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {pending.length === 0 && (
              <EmptyState
                title="Describe the review you need"
                body="Tell the studio what documents you review and which fields must be extracted and verified — it drafts a Pack spec you can refine, then approve."
              />
            )}
            {pending.map((line, index) => (
              <article key={index} className={`max-w-2xl ${line.role === 'user' ? 'ml-auto text-right' : ''}`}>
                <p className={`eyebrow ${line.role === 'assistant' ? 'text-accent' : ''}`}>
                  {line.role === 'user' ? 'You' : 'Pack Studio'}
                </p>
                <p className="mt-1 whitespace-pre-line rounded-none border border-rule bg-surface px-3 py-2 text-left text-[13px] leading-relaxed text-ink-2">
                  {line.content}
                </p>
              </article>
            ))}
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
              placeholder="e.g. Review supplier invoices: extract the invoice number, vendor name, amount, and payment terms, and verify each against the source document."
              className="min-h-[84px] w-full resize-none border border-rule bg-raised p-2.5 text-[13px] outline-none focus:border-accent"
            />
            <ActionButton type="submit" variant="primary" disabled={!input.trim() || streaming} className="mt-2">
              {streaming ? 'Working…' : 'Draft'}
            </ActionButton>
          </form>
        </section>

        <aside className="border-t-2 border-rule bg-surface lg:border-l-2 lg:border-t-0">
          <div className="border-b border-rule px-5 py-3">
            <p className="eyebrow text-accent">Draft spec</p>
          </div>
          <div className="space-y-4 px-5 py-4">
            {!draft ? (
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                Fields, document types and rules land here as the studio drafts them.
              </p>
            ) : (
              <>
                <section>
                  <CardKicker>Document types</CardKicker>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {draft.document_types.length > 0 ? (
                      draft.document_types.map((type) => <Tag key={type}>{type}</Tag>)
                    ) : (
                      <Tag variant="outline">none</Tag>
                    )}
                  </div>
                </section>
                <section>
                  <CardKicker>Fields to extract</CardKicker>
                  <div className="mt-2 divide-y divide-rule border-y border-rule">
                    {draft.fields.map((field) => (
                      <div key={field.name} className="py-2">
                        <p className="font-data text-[12px] font-medium text-ink">{field.name}</p>
                        <p className="text-[11.5px] leading-relaxed text-ink-2">{field.description}</p>
                        <p className="font-data text-[10px] uppercase tracking-[.08em] text-ink-3">{field.type}</p>
                      </div>
                    ))}
                    {draft.fields.length === 0 && <p className="py-2 text-[12px] text-ink-2">No fields yet.</p>}
                  </div>
                </section>
                <section>
                  <CardKicker>Rules</CardKicker>
                  <ul className="mt-2 space-y-1.5">
                    {draft.rules.map((rule) => (
                      <li key={rule.id} className="text-[12px] leading-relaxed text-ink-2">
                        {rule.description}
                      </li>
                    ))}
                    {draft.rules.length === 0 && <li className="text-[12px] text-ink-2">No rules yet.</li>}
                  </ul>
                </section>
                <Card className="border border-rule p-3">
                  <label htmlFor="pack-name" className="block text-[11.5px] font-medium text-ink-2">
                    Pack name
                  </label>
                  <input
                    id="pack-name"
                    value={packName}
                    onChange={(event) => setPackName(event.target.value)}
                    className="mt-1 w-full border border-rule bg-surface px-2 py-1.5 font-data text-[12px] text-ink outline-none focus:border-accent"
                  />
                </Card>
                {error && <p className="text-[12px] text-missing">{error}</p>}
                <ActionButton
                  variant="primary"
                  className="w-full"
                  disabled={!draft || !packName.trim() || approving}
                  onClick={approve}
                >
                  {approving ? 'Approving…' : 'Approve & install'}
                </ActionButton>
                <p className="text-[10.5px] leading-relaxed text-ink-3">
                  Approving freezes this spec as version 1 — it cannot be edited, only
                  superseded — and installs it for this workspace.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
