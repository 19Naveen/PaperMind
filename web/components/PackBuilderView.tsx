'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { PackSpec, StudioDraftRevisionOut, WorkflowSpecV1 } from '@/lib/api';
import { specToGraph, workflowToGraph, type WorkflowGraphEdge, type WorkflowGraphNode } from '@/lib/types';
import {
  approveAndInstallAction,
  approveNewVersionAction,
  createStudioSessionAction,
  listStudioRevisionsAction,
  studioPreviewAction,
  submitReviewAction,
} from '@/lib/session';
import type { StudioPreviewOut } from '@/lib/api';
import { ActionButton, CardKicker, EmptyState, Input, Seg, Tag } from '@/components/ui';
import { GraphCanvas } from '@/components/GraphCanvas';
import { IconSparkle } from '@/lib/icons';

interface ChatLine {
  role: 'user' | 'assistant';
  content: string;
}

type StudioView = 'diagram' | 'ports' | 'ledger' | 'changes' | 'validation' | 'test';

/** Best-effort projection of the canonical workflow back to the legacy PackSpec shape —
 * enough to drive the inspector counts and the legacy publish gate. Mirrors the backend's
 * project_legacy. */
function workflowToSpec(workflow: WorkflowSpecV1): PackSpec {
  const fields = workflow.nodes
    .filter((n) => n.kind === 'extract_field')
    .map((n) => ({
      name: String(n.config.field ?? ''),
      description: String(n.config.description ?? ''),
      type: String(n.config.type ?? ''),
    }));
  const rules = workflow.nodes
    .filter((n) => n.kind === 'evaluate_rule')
    .map((n) => ({
      id: String(n.config.rule_id ?? ''),
      description: String(n.config.description ?? ''),
    }));
  return {
    name: workflow.name,
    document_types: workflow.document_types ?? [],
    fields,
    rules,
  };
}

// ---------------------------------------------------------------------------
// Read-only workflow diagram. GraphCanvas renders the three legacy node kinds only;
// the canonical workflow's six node kinds need their own lightweight canvas.
// ---------------------------------------------------------------------------

type WorkflowNodeData = { kind: string; label: string; detail?: string };
type WorkflowRFNode = Node<WorkflowNodeData>;

function WorkflowNodeShell({ data, selected }: NodeProps<WorkflowRFNode>) {
  return (
    <div
      className={`min-w-40 max-w-56 border border-rule bg-surface px-3 py-2 text-base text-ink shadow-sm ${
        selected ? 'ring-2 ring-accent' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <p className="text-2xs uppercase tracking-widest text-accent">{data.kind.replace(/_/g, ' ')}</p>
      <p className="mt-1 block text-base leading-tight">{data.label}</p>
      {data.detail && <p className="mt-1 text-sm leading-snug text-ink-2">{data.detail}</p>}
    </div>
  );
}

const workflowNodeTypes = { workflow: WorkflowNodeShell };

function WorkflowDiagram({
  nodes,
  edges,
  onSelectNode,
}: {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  onSelectNode?: (id: string | null) => void;
}) {
  const rfNodes: WorkflowRFNode[] = nodes.map((n) => ({
    id: n.id,
    type: 'workflow',
    position: { x: n.x, y: n.y },
    data: { kind: n.kind, label: n.label, detail: n.detail },
  }));
  const rfEdges: Edge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }));
  return (
    <ReactFlowProvider>
      <div className="pm-graph relative min-w-0 flex-1 bg-ground">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={workflowNodeTypes}
          onNodeClick={(_, n) => onSelectNode?.(String(n.id))}
          onPaneClick={() => onSelectNode?.(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          fitView
          defaultEdgeOptions={{
            style: { stroke: 'var(--color-ink-2)', strokeWidth: 1.5 },
            labelStyle: { fill: 'var(--color-ink-2)', fontSize: 'var(--t-2xs)' },
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="color-mix(in srgb, var(--color-accent) 18%, transparent)"
            gap={28}
            size={1}
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}

/** The Pack Studio: a conversational authoring session with the draft spec on the
 * right, and an explicit Approve gate. Without `packId` it freezes a new Pack and
 * installs it into the workspace; with `packId` it approves a NEW version of an
 * existing Pack (append-only editing), or routes the draft through governance review. */
export function PackBuilderView({
  workspaceId,
  workspaceName,
  packId,
  packName: existingPackName,
  basePackVersionId,
}: {
  workspaceId?: string;
  workspaceName?: string;
  packId?: string;
  packName?: string;
  basePackVersionId?: string;
}) {
  const editing = Boolean(packId);
  const storageKey = editing ? `pm:studio:edit:${packId}` : `pm:studio:${workspaceId}`;
  const router = useRouter();
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState<PackSpec | null>(null);
  const [revision, setRevision] = useState<StudioDraftRevisionOut | null>(null);
  const [packName, setPackName] = useState(existingPackName ?? '');
  const [approving, setApproving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<StudioView>('diagram');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [testDocIds, setTestDocIds] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<StudioPreviewOut | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const draftRef = useRef<PackSpec | null>(null);
  const revisionRef = useRef<StudioDraftRevisionOut | null>(null);

  async function hydrate(sessionId: string) {
    try {
      const revisions = await listStudioRevisionsAction(sessionId);
      if (revisions.length === 0) return;
      const latest = revisions[0];
      revisionRef.current = latest;
      setRevision(latest);
      if (!draftRef.current) {
        const spec = workflowToSpec(latest.workflow);
        draftRef.current = spec;
        setDraft(spec);
        setPackName((prev) => prev || spec.name || '');
      }
    } catch {
      // Stale or approved session — ignore; a fresh one is created on next send.
    }
  }

  // Reconnect to a studio session from this pack/workspace, if one exists — the draft
  // survives a reload even though the chat transcript is not replayed.
  useEffect(() => {
    const cached = window.sessionStorage.getItem(storageKey);
    if (cached) {
      sessionIdRef.current = cached;
      // Hydration setState happens after an await; the compiler is conservative here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void hydrate(cached);
    }
  }, [storageKey]);

  function ensureSession(): string | null {
    return sessionIdRef.current;
  }

  async function ensureSessionAsync(): Promise<string> {
    if (sessionIdRef.current) return sessionIdRef.current;
    const id = await createStudioSessionAction({
      title: editing ? existingPackName ?? 'Edit pack' : `Pack for ${workspaceName}`,
      workspaceId,
      packId,
      basePackVersionId,
    });
    sessionIdRef.current = id;
    window.sessionStorage.setItem(storageKey, id);
    void hydrate(id);
    return id;
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    let sessionId = ensureSession();
    if (!sessionId) {
      try {
        await ensureSessionAsync();
      } catch {
        setError('Could not start the studio session.');
        return;
      }
      sessionId = ensureSession();
    }
    if (!sessionId) return;
    setLines((current) => [...current, { role: 'user', content }]);
    setInput('');
    setStreaming(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/marketplace/${packId}/edit/chat` : `/workspace/${workspaceId}/pack/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, text: content }),
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
            const payload = JSON.parse(line.slice(6)) as {
              type: string;
              text?: string;
              spec?: PackSpec;
              revision?: StudioDraftRevisionOut;
            };
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
            } else if (payload.type === 'revision' && payload.revision) {
              revisionRef.current = payload.revision;
              setRevision(payload.revision);
              setPackName((prev) => prev || payload.revision!.workflow.name || '');
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
    if (!sid || approving) return;
    const rev = revisionRef.current;
    if (rev && !rev.validation.ok) {
      setError('Fix the validation errors before approving.');
      return;
    }
    if (editing) {
      if (!packId) return;
      setApproving(true);
      setError(null);
      startTransition(() => {
        approveNewVersionAction(packId, sid, `/marketplace/${packId}`).catch((err: unknown) => {
          setApproving(false);
          setError(err instanceof Error ? err.message : 'Could not approve the Pack.');
        });
      });
      return;
    }
    const name = packName.trim();
    if (!workspaceId || !name) return;
    setApproving(true);
    setError(null);
    startTransition(() => {
      approveAndInstallAction(workspaceId, sid, name).catch((err: unknown) => {
        setApproving(false);
        setError(err instanceof Error ? err.message : 'Could not approve the Pack.');
      });
    });
  }

  function submitForReview() {
    const sid = ensureSession();
    const rev = revisionRef.current;
    if (!editing || !packId || !sid || !rev || !rev.validation.ok || submitting) return;
    setSubmitting(true);
    setError(null);
    startTransition(() => {
      void submitReviewAction(packId, rev.id)
        .then((outcome) => {
          if (outcome.ok) {
            router.push(`/marketplace/${packId}`);
          } else {
            setSubmitting(false);
            setError(outcome.message);
          }
        })
        .catch((err: unknown) => {
          setSubmitting(false);
          setError(err instanceof Error ? err.message : 'Could not submit for review.');
        });
    });
  }

  async function runPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ids = testDocIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0 || testing) return;
    let sid = ensureSession();
    if (!sid) {
      try {
        await ensureSessionAsync();
      } catch {
        setTestError('Could not start the studio session.');
        return;
      }
      sid = ensureSession();
    }
    if (!sid) return;
    setTesting(true);
    setTestError(null);
    try {
      const outcome = await studioPreviewAction(sid, ids);
      if (outcome.ok) {
        setPreviewResult(outcome.data);
      } else {
        setPreviewResult(null);
        setTestError(outcome.message);
      }
    } catch (err) {
      setPreviewResult(null);
      setTestError(err instanceof Error ? err.message : 'Preview failed.');
    } finally {
      setTesting(false);
    }
  }

  const pending = streaming ? [...lines, { role: 'assistant' as const, content: '…' }] : lines;
  const workflowGraph = useMemo(
    () => (revision?.workflow ? workflowToGraph(revision.workflow) : null),
    [revision],
  );
  const legacyGraph = useMemo(
    () => (draft ? specToGraph(draft) : { nodes: [], edges: [] }),
    [draft],
  );
  const graph = useMemo(() => {
    if (workflowGraph) {
      return {
        nodes: workflowGraph.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, detail: n.detail })),
        edges: workflowGraph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label })),
      };
    }
    return {
      nodes: legacyGraph.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, detail: n.detail })),
      edges: legacyGraph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    };
  }, [workflowGraph, legacyGraph]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const invalid = Boolean(revision && !revision.validation.ok);
  // Mirrors the refs: every place that writes draftRef/revisionRef also sets the state.
  const hasDraft = Boolean(draft || revision);

  return (
    <section className="view full" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', background: 'var(--bg)' }}>
      <div className="pane-head" style={{ flex: 'none', minHeight: 0, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div className="flex justify-start">
          <Link href={editing && packId ? `/marketplace/${packId}` : `/workspace/${workspaceId ?? ''}`} className="btn ghost sm">
            ← Back to {editing ? 'pack page' : workspaceName ?? 'workspace'}
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">{editing ? 'Edit published pack' : `Editing pack · ${workspaceName}`}</p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="page-title">{packName || (editing ? `Edit ${existingPackName}` : `Author a Pack for ${workspaceName}`)}</h1>
              <Tag variant={invalid ? 'danger' : 'neutral'}>
                {invalid ? 'Needs validation' : hasDraft ? 'Draft ready' : 'Conversation mode'}
              </Tag>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editing && revision && revision.validation.ok && (
              <ActionButton variant="outline" size="sm" disabled={submitting} onClick={submitForReview}>
                {submitting ? 'Submitting…' : 'Submit for review'}
              </ActionButton>
            )}
            <ActionButton
              variant="primary"
              size="sm"
              disabled={!hasDraft || (!editing && !packName.trim()) || approving || invalid}
              onClick={approve}
            >
              {approving ? (editing ? 'Approving…' : 'Publishing…') : editing ? 'Approve new version' : 'Publish'}
            </ActionButton>
          </div>
        </div>
        <div>
          <Seg
            options={[
              { value: 'diagram', label: 'Diagram' },
              { value: 'ports', label: 'Ports' },
              { value: 'ledger', label: 'Ledger' },
              { value: 'changes', label: 'Changes' },
              { value: 'validation', label: 'Validation' },
              { value: 'test', label: 'Test' },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </div>
      <div className="studio">
        <section className="st-pane pane-chat" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="pane-head">
            <h2>Build conversation</h2>
          </div>
          <div className="chat-scroll">
            {pending.length === 0 && (
              <EmptyState
                title="Describe the review you need"
                body="Tell the studio what documents you review and which fields must be extracted and verified — it drafts a Pack spec you can refine, then approve."
                icon={<IconSparkle width={20} height={20} />}
              />
            )}
            {pending.map((line, index) => (
              <div key={index} className={`msg${line.role === 'user' ? ' me' : ''}`}>
                {line.role === 'assistant' && (
                  <span className="msg-av">
                    <IconSparkle className="ic sm" />
                  </span>
                )}
                <div className="msg-bubble" style={{ whiteSpace: 'pre-line' }}>{line.content}</div>
              </div>
            ))}
          </div>
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="e.g. Review supplier invoices: extract the invoice number, vendor name, amount, and payment terms, and verify each against the source document."
              className="input"
            />
            <ActionButton type="submit" variant="primary" disabled={!input.trim() || streaming} className="mt-2">
              {streaming ? 'Working…' : 'Draft'}
            </ActionButton>
          </form>
        </section>

        <section className="st-pane pane-canvas" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {view === 'diagram' &&
            (workflowGraph ? (
              <WorkflowDiagram nodes={workflowGraph.nodes} edges={workflowGraph.edges} onSelectNode={setSelectedNodeId} />
            ) : (
              <GraphCanvas
                nodes={legacyGraph.nodes}
                edges={legacyGraph.edges}
                onChange={() => {}}
                onSelectNode={setSelectedNodeId}
                readOnly
              />
            ))}
          {view === 'ports' && (
            <div className="overflow-auto">
              {graph.nodes.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No ports yet"
                    body="Describe the review in the conversation — each document type, field and rule becomes a port here, showing what it reads and writes."
                  />
                </div>
              ) : (
                <div className="spec-list">
                  <p className="eyebrow">Data ports · what each step reads and writes</p>
                  {graph.nodes.map((node, index) => (
                    <div key={node.id} className="spec-row">
                      <span className="rid">{String(index + 1).padStart(2, '0')}</span>
                      <div className="min-w-0 flex-1">
                        <b>{node.label}</b>
                        <p>{node.detail ?? `Defined by the Pack spec · ${node.kind.replace('_', ' ')}`}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {view === 'ledger' && (
            <div className="overflow-auto p-6">
              <p className="eyebrow mb-4">Ledger · execution order</p>
              {graph.nodes.length === 0 ? (
                <EmptyState
                  title="Nothing to run yet"
                  body="Describe the review in the conversation — the execution order appears here once the workflow has steps."
                />
              ) : (
                <ol className="border-t-2 border-rule">
                  {graph.nodes.map((node, index) => (
                    <li key={node.id} className="flex gap-4 border-b border-rule py-4">
                      <span className="w-14 flex-none text-2xl leading-none text-accent">{String(index + 1).padStart(2, '0')}</span>
                      <span>
                        <strong className="block text-lg">{node.label}</strong>
                        <span className="text-sm text-ink-2">{node.detail ?? node.kind.replace('_', ' ')}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          {view === 'changes' && (
            <div className="overflow-auto">
              {!revision || revision.diff.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No changes yet"
                    body="This is the first revision of the session — there is no parent to diff against yet. Each accepted turn records its diff here."
                  />
                </div>
              ) : (
                <div className="diff-list">
                  <p className="eyebrow">Changes · this revision vs its parent</p>
                  {revision.diff.map((entry, index) => (
                    <div key={index} className="diff-row">
                      <span className={`diff-ic ${entry.op === 'add' ? 'add' : entry.op === 'remove' ? 'rem' : 'mod'}`}>
                        {entry.op === 'add' ? '+' : entry.op === 'remove' ? '−' : '~'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <b className="font-data">{entry.path}</b>
                        {entry.op === 'replace' && (
                          <p>
                            <span className="line-through">{JSON.stringify(entry.prev)}</span>
                            {' → '}
                            <span>{JSON.stringify(entry.next)}</span>
                          </p>
                        )}
                      </div>
                      <span className="rid">{entry.op}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {view === 'validation' && (
            <div className="overflow-auto p-6">
              <p className="eyebrow mb-4">Validation · is this draft runnable?</p>
              {!revision ? (
                <EmptyState
                  title="No draft revision yet"
                  body="Describe a review in the conversation — each accepted turn becomes a validated revision."
                />
              ) : revision.validation.ok ? (
                <div className="border border-rule bg-surface p-4">
                  <Tag variant="accent">Valid</Tag>
                  <p className="mt-2 text-base leading-relaxed text-ink-2">
                    This revision passes workflow validation and can be approved or submitted for review.
                  </p>
                </div>
              ) : (
                <div className="border border-rule bg-surface p-4">
                  <Tag variant="danger">
                    {revision.validation.errors.length} error{revision.validation.errors.length === 1 ? '' : 's'}
                  </Tag>
                  <ul className="mt-3 space-y-2">
                    {revision.validation.errors.map((err, index) => (
                      <li key={index} className="border-l-4 border-missing-line bg-missing-soft px-3 py-2 text-sm">
                        <span className="font-data font-medium text-missing">{err.code}</span>
                        {err.path && <span className="ml-2 font-data text-xs text-ink-2">@{err.path}</span>}
                        <p className="leading-relaxed text-ink-2">{err.message}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm text-missing">
                    Approval and review submission are disabled until these are resolved.
                  </p>
                </div>
              )}
            </div>
          )}
          {view === 'test' && (
            <div className="overflow-auto p-6">
              <p className="eyebrow mb-1">Test · dry-run the draft against documents</p>
              <p className="mb-4 text-sm leading-relaxed text-ink-2">
                Run the current draft against uploaded documents to see what it would extract and verify before
                freezing a version.
              </p>
              {!revision && !draft ? (
                <EmptyState
                  title="Nothing to test yet"
                  body="Draft a review in the conversation first — the preview runs the session's current draft."
                />
              ) : (
                <>
                  <form className="flex flex-wrap items-end gap-2" onSubmit={runPreview}>
                    <Input
                      label="Document IDs"
                      value={testDocIds}
                      onChange={setTestDocIds}
                      placeholder="Paste one or more document UUIDs, comma or space separated"
                      className="min-w-64 flex-1"
                    />
                    <ActionButton type="submit" variant="primary" disabled={!testDocIds.trim() || testing}>
                      {testing ? 'Running preview…' : 'Run preview'}
                    </ActionButton>
                  </form>
                  {testError && <p className="mt-3 text-sm leading-relaxed text-missing">{testError}</p>}
                  {previewResult && (
                    <div className="mt-4">
                      <p className="eyebrow mb-2">Extracted facts</p>
                      {previewResult.facts.length === 0 ? (
                        <p className="text-sm text-ink-2">
                          The preview produced no facts for those documents.
                        </p>
                      ) : (
                        <ul className="divide-y divide-rule border-t-2 border-rule">
                          {previewResult.facts.map((fact, index) => (
                            <li key={index} className="py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-data text-sm text-ink">{fact.field}</span>
                                <Tag
                                  variant={
                                    fact.state === 'verified' ? 'accent' : fact.state === 'missing' ? 'danger' : 'warn'
                                  }
                                >
                                  {fact.state}
                                </Tag>
                              </div>
                              {fact.value !== null && <p className="mt-1 text-sm text-ink-2">{fact.value}</p>}
                              {fact.citations.length > 0 && (
                                <p className="mt-1 truncate text-xs text-ink-3" title={fact.citations[0].quote}>
                                  “{fact.citations[0].quote}”
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <div className="flex items-center justify-between border-t border-rule px-4 py-2">
            <span className="eyebrow">Workflow · {graph.nodes.length} nodes</span>
            <span className="eyebrow text-accent">
              {workflowGraph ? `Revision ${revision?.revision_no ?? '—'}` : 'Live draft from conversation'}
            </span>
          </div>
        </section>

        <aside className="st-pane pane-insp">
          <div className="pane-head">
            <h2>Inspector</h2>
          </div>
          <div className="insp-scroll">
            {!hasDraft ? (
              <p className="text-sm leading-relaxed text-ink-2">Fields, document types and rules land here as the studio drafts them.</p>
            ) : selectedNode ? (
              <section className="card insp-card">
                <Tag variant="accent">{selectedNode.kind.replace('_', ' ')}</Tag>
                <h3>{selectedNode.label}</h3>
                <p className="desc">{selectedNode.detail ?? 'Defined by the current Pack draft.'}</p>
              </section>
            ) : (
              <>
                <section>
                  <CardKicker>Pack contents</CardKicker>
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">Select a node to inspect it. The frozen Pack will contain the document types, fields and rules shown on the canvas.</p>
                </section>
                <dl className="grid grid-cols-3 border-l border-t border-rule text-center">
                  <div className="border-b border-r border-rule p-2"><dt className="eyebrow">Docs</dt><dd className="mt-1 text-xl">{draft?.document_types.length ?? 0}</dd></div>
                  <div className="border-b border-r border-rule p-2"><dt className="eyebrow">Fields</dt><dd className="mt-1 text-xl">{draft?.fields.length ?? 0}</dd></div>
                  <div className="border-b border-r border-rule p-2"><dt className="eyebrow">Rules</dt><dd className="mt-1 text-xl">{draft?.rules.length ?? 0}</dd></div>
                </dl>
              </>
            )}
            <Input id="pack-name" label="Pack name" value={packName} onChange={setPackName} />
            {error && <p className="text-sm text-missing">{error}</p>}
            <p className="text-2xs leading-relaxed text-ink-3">
              {editing
                ? 'Approving freezes a new version. Existing versions stay frozen; workspaces run the new one on their next run.'
                : 'Publishing approves and installs version 1. Frozen versions are superseded, never edited in place.'}
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
