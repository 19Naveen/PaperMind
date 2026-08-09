'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type { PackSpec } from '@/lib/api';
import { specToGraph } from '@/lib/types';
import { approveAndInstallAction, createStudioSessionAction } from '@/lib/session';
import { ActionButton, CardKicker, EmptyState, PageHeader, Seg, Tag } from '@/components/ui';
import { GraphCanvas } from '@/components/GraphCanvas';

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
  const [view, setView] = useState<'diagram' | 'ports' | 'ledger'>('diagram');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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
  const graph = useMemo(() => (draft ? specToGraph(draft) : { nodes: [], edges: [] }), [draft]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;

  return (
    <main className="flex h-full min-h-0 flex-col bg-ground text-ink">
      <PageHeader
        eyebrow={`Editing pack · ${workspaceName}`}
        title={packName || `Author a Pack for ${workspaceName}`}
        actions={
          <>
            <Seg
              options={[
                { value: 'diagram', label: 'Workflow' },
                { value: 'ports', label: 'Reads & writes' },
                { value: 'ledger', label: 'Steps' },
              ]}
              value={view}
              onChange={setView}
            />
            <Tag variant="neutral">{draft ? 'Draft ready' : 'Conversation mode'}</Tag>
            <ActionButton
              variant="primary"
              disabled={!draft || !packName.trim() || approving}
              onClick={approve}
            >
              {approving ? 'Publishing…' : 'Publish'}
            </ActionButton>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        <section className="flex w-[360px] shrink-0 flex-col border-r-2 border-rule bg-surface">
          <div className="border-b border-rule px-[18px] py-3">
            <p className="eyebrow">Build conversation</p>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-[18px] py-4">
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
                <p className="mt-1 whitespace-pre-line text-left text-[13px] leading-relaxed text-ink-2">
                  {line.content}
                </p>
              </article>
            ))}
          </div>
          <form
            className="border-t-2 border-rule p-[14px]"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-label="Describe the review workflow"
              placeholder="e.g. Review supplier invoices: extract the invoice number, vendor name, amount, and payment terms, and verify each against the source document."
              className="min-h-[84px] w-full resize-none border border-rule bg-raised p-2.5 text-[13px] outline-none focus:border-accent"
            />
            <ActionButton type="submit" variant="primary" disabled={!input.trim() || streaming} className="mt-2">
              {streaming ? 'Working…' : 'Draft'}
            </ActionButton>
          </form>
        </section>

        <section className="flex min-w-[520px] flex-1 flex-col bg-ground">
          {view === 'diagram' && (
            <GraphCanvas
              nodes={graph.nodes}
              edges={graph.edges}
              onChange={() => {}}
              onSelectNode={setSelectedNodeId}
              readOnly
            />
          )}
          {view === 'ports' && (
            <div className="overflow-auto p-6">
              <p className="eyebrow mb-4">What each step reads and writes</p>
              <div className="grid border-l border-t-2 border-rule sm:grid-cols-2 xl:grid-cols-3">
                {graph.nodes.map((node, index) => (
                  <article key={node.id} className="border-b border-r border-rule bg-ground p-4">
                    <p className="eyebrow text-accent">{String(index + 1).padStart(2, '0')} · {node.kind.replace('_', ' ')}</p>
                    <h2 className="display mt-1 text-[16px]">{node.label}</h2>
                    <p className="mt-3 font-data text-[11px] text-ink-2">{node.detail ?? 'Defined by the Pack spec'}</p>
                  </article>
                ))}
              </div>
            </div>
          )}
          {view === 'ledger' && (
            <div className="overflow-auto p-6">
              <p className="eyebrow mb-4">Execution order</p>
              <ol className="border-t-2 border-rule">
                {graph.nodes.map((node, index) => (
                  <li key={node.id} className="grid grid-cols-[56px_1fr] gap-4 border-b border-rule py-4">
                    <span className="display text-[26px] leading-none text-accent">{String(index + 1).padStart(2, '0')}</span>
                    <span><strong className="display block text-[17px]">{node.label}</strong><span className="text-[12px] text-ink-2">{node.detail ?? node.kind.replace('_', ' ')}</span></span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-rule px-4 py-2">
            <span className="eyebrow">Workflow · {graph.nodes.length} nodes</span>
            <span className="eyebrow text-accent">Live draft from conversation</span>
          </div>
        </section>

        <aside className="w-[312px] shrink-0 overflow-y-auto border-l-2 border-rule bg-surface">
          <div className="border-b border-rule px-4 py-3"><p className="eyebrow text-accent">Inspector</p></div>
          <div className="space-y-5 p-4">
            {!draft ? (
              <p className="text-[12.5px] leading-relaxed text-ink-2">Fields, document types and rules land here as the studio drafts them.</p>
            ) : selectedNode ? (
              <section>
                <CardKicker>{selectedNode.kind.replace('_', ' ')}</CardKicker>
                <h2 className="display mt-1 text-[18px]">{selectedNode.label}</h2>
                <p className="mt-3 border-l-[3px] border-rule bg-raised p-3 text-[12.5px] leading-relaxed text-ink-2">{selectedNode.detail ?? 'Defined by the current Pack draft.'}</p>
              </section>
            ) : (
              <>
                <section>
                  <CardKicker>Pack contents</CardKicker>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">Select a node to inspect it. The frozen Pack will contain the document types, fields and rules shown on the canvas.</p>
                </section>
                <dl className="grid grid-cols-3 border-l border-t border-rule text-center">
                  <div className="border-b border-r border-rule p-2"><dt className="eyebrow">Docs</dt><dd className="display mt-1 text-[20px]">{draft.document_types.length}</dd></div>
                  <div className="border-b border-r border-rule p-2"><dt className="eyebrow">Fields</dt><dd className="display mt-1 text-[20px]">{draft.fields.length}</dd></div>
                  <div className="border-b border-r border-rule p-2"><dt className="eyebrow">Rules</dt><dd className="display mt-1 text-[20px]">{draft.rules.length}</dd></div>
                </dl>
              </>
            )}
            <label htmlFor="pack-name" className="block text-[11.5px] font-medium text-ink-2">Pack name</label>
            <input id="pack-name" value={packName} onChange={(event) => setPackName(event.target.value)} className="-mt-4 w-full border border-rule bg-raised px-2 py-1.5 font-data text-[12px] text-ink outline-none focus:border-accent" />
            {error && <p className="text-[12px] text-missing">{error}</p>}
            <p className="text-[10.5px] leading-relaxed text-ink-3">Publishing approves and installs version 1. Frozen versions are superseded, never edited in place.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
