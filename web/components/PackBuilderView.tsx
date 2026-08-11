'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeProps,
} from '@xyflow/react';
// base.css, NOT style.css. style.css carries xyflow's default light THEME, and a
// component `import` lands unlayered — which per the cascade-layers spec beats
// every `.pm-graph` rule in globals.css §12 regardless of specificity, pinning the
// canvas to light colours. base.css is structure only; all colour routes through
// the `--xy-*` custom properties set in app/studio.css §7.
import '@xyflow/react/dist/base.css';
import type {
  Edge as WfEdge,
  Node as WfNode,
  PackSpec,
  StudioDraftRevisionOut,
  StudioPreviewOut,
  ValidationIssue,
  WorkflowSpecV1,
} from '@/lib/api';
import { specToGraph } from '@/lib/types';
import {
  approveAndInstallAction,
  approveNewVersionAction,
  createStudioSessionAction,
  listStudioRevisionsAction,
  studioPreviewAction,
  submitReviewAction,
} from '@/lib/session';
import { formatDateTime, humanise } from '@/lib/format';
import { ActionButton, Button, EmptyState, IconButton, Input, Kv, Stat, Tag } from '@/components/ui';
import { GraphCanvas } from '@/components/GraphCanvas';
import {
  IconAlert,
  IconArrowLeft,
  IconClose,
  IconFile,
  IconLayers,
  IconPlay,
  IconRefresh,
  IconRows,
  IconSparkle,
} from '@/lib/icons';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type LineState = 'wait' | 'ok' | 'error';

interface ChatLine {
  role: 'user' | 'assistant';
  content: string;
  state?: LineState;
  code?: string;
  issues?: ValidationIssue[];
}

type StudioTab = 'diagram' | 'spec' | 'changes' | 'test';
type StudioPane = 'chat' | 'canvas' | 'insp';

const TABS: { value: StudioTab; label: string }[] = [
  { value: 'diagram', label: 'Diagram' },
  { value: 'spec', label: 'Spec' },
  { value: 'changes', label: 'Changes' },
  { value: 'test', label: 'Test' },
];

/** Openers, not data: clicking one fills the composer so the author can edit it before
 * sending. Nothing is drafted until they send it. */
const QUICK_PROMPTS = [
  {
    label: 'Supplier invoices',
    prompt:
      'Review supplier invoices: extract the invoice number, vendor name, total amount and payment terms, and verify each value against the source document.',
  },
  {
    label: 'KYC case file',
    prompt:
      'Check a KYC case file for a passport, proof of address and bank statement. Extract the holder name, address and account number, and flag anything missing or inconsistent between documents.',
  },
  {
    label: 'Contract clauses',
    prompt:
      'Review vendor contracts for the termination notice period, governing law, liability cap and renewal terms. Every extracted clause must be verified against a cited passage.',
  },
];

const PANES: { value: StudioPane; label: string; cls: string }[] = [
  { value: 'chat', label: 'Conversation', cls: 'stu-sw--chat' },
  { value: 'canvas', label: 'Workflow', cls: '' },
  { value: 'insp', label: 'Inspector', cls: '' },
];

const KIND_LABEL: Record<string, string> = {
  classify_documents: 'Classify',
  retrieve_evidence: 'Retrieve',
  extract_field: 'Extract',
  verify_field: 'Verify',
  evaluate_rule: 'Rule',
  render_checklist: 'Report',
  document_type: 'Source',
  field: 'Field',
  rule: 'Rule',
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? humanise(kind);
}

/** Execution stage per node kind — the order the runtime walks the pipeline in, and the
 * order the diagram and the Spec reading both present. */
const STAGE: Record<string, number> = {
  classify_documents: 0,
  retrieve_evidence: 1,
  extract_field: 2,
  verify_field: 3,
  evaluate_rule: 4,
  render_checklist: 5,
};

/** Top-to-bottom pipeline layout: one horizontal band per execution stage, wrapping at
 * four nodes so a Pack with twenty fields stays narrow enough to read rather than
 * stretching into a 5000px ribbon. Bands are centred so the graph reads as a funnel. */
const LANE_W = 228;
const LANE_H = 112;
const BAND_GAP = 48;
const PER_ROW = 4;

function layoutSteps(ordered: WfNode[]): Map<string, { x: number; y: number }> {
  const bands = new Map<number, WfNode[]>();
  for (const n of ordered) {
    const stage = STAGE[n.kind] ?? 9;
    const band = bands.get(stage);
    if (band) band.push(n);
    else bands.set(stage, [n]);
  }
  const stages = [...bands.keys()].sort((a, b) => a - b);
  const widest = Math.max(1, ...stages.map((s) => Math.min(bands.get(s)!.length, PER_ROW)));
  const totalW = widest * LANE_W;
  const pos = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (const stage of stages) {
    const ns = bands.get(stage)!;
    const rows = Math.ceil(ns.length / PER_ROW);
    ns.forEach((n, i) => {
      const row = Math.floor(i / PER_ROW);
      const inRow = Math.min(ns.length - row * PER_ROW, PER_ROW);
      const offset = (totalW - inRow * LANE_W) / 2;
      pos.set(n.id, { x: offset + (i % PER_ROW) * LANE_W, y: y + row * LANE_H });
    });
    y += rows * LANE_H + BAND_GAP;
  }
  return pos;
}

/** One step on the canvas / in the spec reading. `raw` is present only for canonical
 * workflow nodes — the legacy projection has no workflow node behind it. */
interface Step {
  id: string;
  kind: string;
  title: string;
  machine?: string;
  detail?: string;
  x: number;
  y: number;
  raw?: WfNode;
}

function cfgStr(cfg: Record<string, unknown>, key: string): string | undefined {
  const v = cfg[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** Human title + machine identifier + one line of detail, per node kind. Mirrors the
 * config keys the backend contract allows (workflow_contract._CONFIG_KEYS). */
function describeNode(node: WfNode): { title: string; machine?: string; detail?: string } {
  const cfg = node.config ?? {};
  switch (node.kind) {
    case 'classify_documents': {
      // Only the contract's own key. Saying "no document types configured" when the key is
      // merely spelled differently would be the UI asserting something it cannot know —
      // the inspector's Configuration section shows whatever keys the node actually has.
      const types = Array.isArray(cfg.document_types) ? cfg.document_types.map(String) : [];
      return {
        title: 'Classify documents',
        detail: types.length ? types.map(humanise).join(', ') : undefined,
      };
    }
    case 'retrieve_evidence':
      return {
        title: 'Retrieve evidence',
        detail: typeof cfg.k === 'number' ? `Top ${cfg.k} passages per field` : undefined,
      };
    case 'extract_field': {
      const field = cfgStr(cfg, 'field');
      return {
        title: field ? `Extract ${humanise(field)}` : 'Extract field',
        machine: field,
        detail: cfgStr(cfg, 'description') ?? cfgStr(cfg, 'type'),
      };
    }
    case 'verify_field': {
      const field = cfgStr(cfg, 'field');
      // No detail: this kind carries no descriptive config, and the detail slot elsewhere
      // shows configured values. Filling it with prose would read as spec content.
      return { title: field ? `Verify ${humanise(field)}` : 'Verify field', machine: field };
    }
    case 'evaluate_rule': {
      const ruleId = cfgStr(cfg, 'rule_id');
      return {
        title: ruleId ? humanise(ruleId) : 'Rule',
        machine: ruleId,
        detail: cfgStr(cfg, 'description'),
      };
    }
    case 'render_checklist':
      return {
        title: 'Render checklist',
        detail: cfg.include_citations === false ? 'Without citations' : 'With citations',
      };
    default:
      return { title: humanise(node.kind), machine: node.id };
  }
}

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
  return { name: workflow.name, document_types: workflow.document_types ?? [], fields, rules };
}

async function readApiError(res: Response): Promise<{ code: string; message: string }> {
  const fallback = `The studio request failed (HTTP ${res.status}).`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return { code: body.error?.code ?? `HTTP_${res.status}`, message: body.error?.message ?? fallback };
  } catch {
    return { code: `HTTP_${res.status}`, message: fallback };
  }
}

// ---------------------------------------------------------------------------
// Read-only workflow diagram
// ---------------------------------------------------------------------------

type WfNodeData = { kind: string; title: string; machine?: string; detail?: string };
type WfRFNode = RFNode<WfNodeData>;

function WorkflowNodeShell({ data, selected }: NodeProps<WfRFNode>) {
  return (
    <div className={`wf-node${selected ? ' is-sel' : ''}`} data-kind={data.kind}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <span className="k">{kindLabel(data.kind)}</span>
      <span className="l">{data.title}</span>
      {(data.machine ?? data.detail) && (
        <span className="d" title={data.machine ?? data.detail}>
          {data.machine ? <span className="mono">{data.machine}</span> : data.detail}
        </span>
      )}
    </div>
  );
}

const workflowNodeTypes = { workflow: WorkflowNodeShell };

function WorkflowDiagram({
  steps,
  edges,
  selectedId,
  onSelectNode,
}: {
  steps: Step[];
  edges: { id: string; source: string; target: string; label?: string }[];
  selectedId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const rfNodes: WfRFNode[] = steps.map((s) => ({
    id: s.id,
    type: 'workflow',
    position: { x: s.x, y: s.y },
    selected: s.id === selectedId,
    data: { kind: s.kind, title: s.title, machine: s.machine, detail: s.detail },
  }));
  const rfEdges: RFEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
  }));
  return (
    <ReactFlowProvider>
      <div className="pm-graph relative min-w-0 flex-1">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={workflowNodeTypes}
          onNodeClick={(_, n) => onSelectNode(String(n.id))}
          onPaneClick={() => onSelectNode(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          fitView
          // Never shrink past legibility: below ~0.6 the labels stop being readable, so
          // the view clamps and the author pans instead of squinting at a thumbnail.
          fitViewOptions={{ padding: 0.08, minZoom: 0.62 }}
          minZoom={0.3}
          maxZoom={1.75}
        >
          <Background variant={BackgroundVariant.Dots} gap={26} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}

// ---------------------------------------------------------------------------
// Pack Studio
// ---------------------------------------------------------------------------

/** The Pack Studio: a conversational authoring session with the draft workflow beside
 * it and an explicit approve gate. Without `packId` it freezes a new Pack and installs
 * it into the workspace; with `packId` it opens the Pack's latest frozen version as
 * draft revision 1 and approves a NEW version (append-only editing), or routes the
 * revision through governance review. */
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
  const linesKey = `${storageKey}:lines`;
  const router = useRouter();

  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [booting, setBooting] = useState(false);
  const [draft, setDraft] = useState<PackSpec | null>(null);
  const [revision, setRevision] = useState<StudioDraftRevisionOut | null>(null);
  const [packName, setPackName] = useState(existingPackName ?? '');
  const [approving, setApproving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [turnIssues, setTurnIssues] = useState<ValidationIssue[]>([]);
  const [tab, setTab] = useState<StudioTab>('diagram');
  const [pane, setPane] = useState<StudioPane>('canvas');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [testDocIds, setTestDocIds] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<{ code: string; message: string } | null>(null);
  const [previewResult, setPreviewResult] = useState<StudioPreviewOut | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const revisionRef = useRef<StudioDraftRevisionOut | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);

  // ---------------------------------------------------------------- session

  function forgetSession() {
    sessionIdRef.current = null;
    try {
      window.sessionStorage.removeItem(storageKey);
      window.sessionStorage.removeItem(linesKey);
    } catch {
      // private-mode storage: the in-memory ref is already cleared, which is what matters.
    }
  }

  async function hydrate(sessionId: string): Promise<boolean> {
    try {
      const revisions = await listStudioRevisionsAction(sessionId);
      const latest = revisions[0] ?? null; // newest first
      if (latest) {
        revisionRef.current = latest;
        setRevision(latest);
        const spec = workflowToSpec(latest.workflow);
        setDraft(spec);
        setPackName((prev) => (prev.trim() ? prev : spec.name || ''));
      }
      return true;
    } catch {
      return false;
    }
  }

  async function ensureSessionAsync(): Promise<string> {
    if (sessionIdRef.current) return sessionIdRef.current;
    const id = await createStudioSessionAction({
      title: editing ? existingPackName ?? 'Edit pack' : `Pack for ${workspaceName ?? 'workspace'}`,
      workspaceId,
      packId,
      basePackVersionId,
    });
    sessionIdRef.current = id;
    try {
      window.sessionStorage.setItem(storageKey, id);
    } catch {
      // non-fatal: the session simply will not survive a reload.
    }
    return id;
  }

  // Reconnect to this pack/workspace's studio session, and — when editing a published
  // Pack — OPEN one eagerly. The old build waited for the first message, so "Edit pack"
  // landed on an empty canvas even though the Pack's frozen spec was available: the
  // seeded session (pack_id + base_pack_version_id) is what turns it into revision 1.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      let cached: string | null = null;
      try {
        cached = window.sessionStorage.getItem(storageKey);
        const cachedLines = window.sessionStorage.getItem(linesKey);
        if (cachedLines) setLines(JSON.parse(cachedLines) as ChatLine[]);
      } catch {
        cached = null;
      }

      if (cached) {
        sessionIdRef.current = cached;
        if (await hydrate(cached)) return;
        if (cancelled) return;
        // The cached id is dead (approved, expired, or the API is unreachable). The old
        // build kept handing it to every send, so the studio 404'd forever.
        forgetSession();
        setLines([]);
        setNotice('The previous draft session could not be reopened, so it was discarded. A new one starts with your next message.');
      }
      if (cancelled || !(editing && packId && basePackVersionId)) return;

      setBooting(true);
      try {
        const id = await ensureSessionAsync();
        if (cancelled) return;
        const ok = await hydrate(id);
        if (!ok && !cancelled) {
          setNotice('Opened an editing session but could not read its draft. Reload to try again.');
        }
      } catch {
        if (!cancelled) {
          setNotice('Could not open an editing session for this Pack. Reload to try again.');
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
    // `ensureSessionAsync` / `forgetSession` / `hydrate` are re-created every render but
    // close over nothing beyond these props, so listing them would re-boot the session on
    // every keystroke. Boot must happen once per storage key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, linesKey, editing, packId, basePackVersionId]);

  // The transcript is client-side state — the API has no "list turns" surface wired to a
  // server action — so persist it beside the session id and it survives a reload.
  useEffect(() => {
    if (lines.length === 0) return;
    try {
      window.sessionStorage.setItem(linesKey, JSON.stringify(lines));
    } catch {
      // storage full / disabled: the transcript just will not survive a reload.
    }
  }, [lines, linesKey]);

  useEffect(() => {
    if (lines.length === 0) return;
    chatEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [lines]);

  // ---------------------------------------------------------------- drafting

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    setNotice(null);
    setTurnIssues([]);

    let sessionId = sessionIdRef.current;
    if (!sessionId) {
      try {
        sessionId = await ensureSessionAsync();
      } catch {
        setNotice('Could not start a studio session. Check your connection and try again.');
        return;
      }
    }

    setInput('');
    setStreaming(true);
    setLines((current) => [...current, { role: 'user', content }, { role: 'assistant', content: '', state: 'wait' }]);

    const patchLast = (patch: Partial<ChatLine>) =>
      setLines((current) => current.map((l, i) => (i === current.length - 1 ? { ...l, ...patch } : l)));

    let status = '';
    let outcome: Partial<ChatLine> | null = null;

    try {
      const res = await fetch(editing ? `/marketplace/${packId}/edit/chat` : `/workspace/${workspaceId}/pack/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, text: content }),
      });

      if (!res.ok) {
        const detail = await readApiError(res);
        if (detail.code === 'STUDIO_SESSION_NOT_FOUND') {
          forgetSession();
          patchLast({
            content: `${detail.message} The session was discarded — send your message again to start a fresh one.`,
            state: 'error',
            code: detail.code,
          });
        } else {
          patchLast({ content: detail.message, state: 'error', code: detail.code });
        }
        return;
      }
      if (!res.body) throw new Error('studio response carried no stream');

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
            let payload: {
              type?: string;
              text?: string;
              spec?: PackSpec;
              revision?: StudioDraftRevisionOut;
              code?: string;
              details?: { errors?: ValidationIssue[] };
            };
            try {
              payload = JSON.parse(line.slice(6));
            } catch {
              // One malformed frame used to throw out of the whole read loop and
              // report a connection failure. Skip it and keep reading.
              continue;
            }

            if (payload.type === 'token' && typeof payload.text === 'string') {
              status += payload.text;
              patchLast({ content: status, state: 'wait' });
            } else if (payload.type === 'draft_spec' && payload.spec) {
              const spec = payload.spec;
              setDraft(spec);
              // Only fill an empty name. The old build overwrote whatever the author
              // had typed on every turn, and `|| ''` could blank it outright.
              setPackName((prev) => (prev.trim() ? prev : spec.name || ''));
            } else if (payload.type === 'revision' && payload.revision) {
              const rev = payload.revision;
              revisionRef.current = rev;
              setRevision(rev);
              setSelectedNodeId(null);
              const n = rev.workflow.nodes.length;
              const e = rev.workflow.edges.length;
              const errs = rev.validation.errors.length;
              outcome = {
                content:
                  `Revision ${rev.revision_no} drafted — ${n} node${n === 1 ? '' : 's'}, ${e} edge${e === 1 ? '' : 's'}. ` +
                  (rev.validation.ok
                    ? 'It passes workflow validation and can be approved.'
                    : `It fails validation with ${errs} error${errs === 1 ? '' : 's'} — see the banner above.`),
                state: rev.validation.ok ? 'ok' : 'error',
                issues: rev.validation.ok ? undefined : rev.validation.errors,
              };
              if (!rev.validation.ok) setTurnIssues(rev.validation.errors);
            } else if (payload.type === 'error') {
              const issues = payload.details?.errors ?? [];
              const code = payload.code ?? 'STUDIO_TURN_FAILED';
              outcome = {
                content:
                  code === 'INVALID_WORKFLOW'
                    ? 'That draft was rejected by workflow validation, so your previous draft is unchanged. Adjust the request and try again.'
                    : 'The studio could not turn that into a draft. Try describing the documents, the fields to extract, and the checks to run.',
                state: 'error',
                code,
                issues: issues.length ? issues : undefined,
              };
              setTurnIssues(issues);
            }
          }
        }
      }

      patchLast(
        outcome ?? {
          content: status || 'The studio returned nothing for that turn. Try rephrasing the request.',
          state: status ? 'ok' : 'error',
        },
      );
    } catch {
      patchLast({
        content: 'The connection to the studio dropped before a draft came back. Nothing was changed — send it again.',
        state: 'error',
      });
    } finally {
      setStreaming(false);
    }
  }

  // ---------------------------------------------------------------- gates

  const hasDraft = Boolean(draft || revision);
  const invalid = Boolean(revision && !revision.validation.ok);

  /** Why approve/submit cannot run right now, in the author's words. Rendered next to
   * the buttons AND used as their tooltip — a greyed control that says nothing is a bug. */
  function blockedReason(): string | null {
    if (streaming) return 'Waiting for the current turn to finish.';
    if (booting) return 'Opening the editing session…';
    if (!hasDraft) return 'Describe the review in the conversation to produce a draft.';
    if (invalid) return 'This revision fails workflow validation.';
    if (!editing && !packName.trim()) return 'Give the Pack a name in the inspector.';
    if (!editing && !workspaceId) return 'This session is not attached to a workspace.';
    return null;
  }
  const blocked = blockedReason();
  const canSubmit = editing && Boolean(revision) && !invalid && !streaming && !approving && !submitting;

  function approve() {
    if (approving || submitting) return;
    const reason = blockedReason();
    if (reason) {
      setNotice(reason);
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) {
      setNotice('There is no studio session to approve yet.');
      return;
    }
    setNotice(null);
    setApproving(true);
    if (editing && packId) {
      startTransition(() => {
        approveNewVersionAction(packId, sid, `/marketplace/${packId}`).catch((err: unknown) => {
          setApproving(false);
          setNotice(err instanceof Error ? err.message : 'Could not approve the Pack.');
        });
      });
      return;
    }
    if (!workspaceId) {
      setApproving(false);
      return;
    }
    const name = packName.trim();
    startTransition(() => {
      approveAndInstallAction(workspaceId, sid, name).catch((err: unknown) => {
        setApproving(false);
        setNotice(err instanceof Error ? err.message : 'Could not publish the Pack.');
      });
    });
  }

  function submitForReview() {
    if (submitting || approving) return;
    const rev = revisionRef.current;
    if (!editing || !packId || !rev) {
      setNotice('There is no draft revision to submit yet.');
      return;
    }
    if (!rev.validation.ok) {
      setNotice('This revision fails workflow validation. Fix the errors in the banner before submitting it for review.');
      return;
    }
    setNotice(null);
    setSubmitting(true);
    startTransition(() => {
      void submitReviewAction(packId, rev.id)
        .then((outcome) => {
          if (outcome.ok) {
            router.push(`/marketplace/${packId}`);
          } else {
            setSubmitting(false);
            setNotice(outcome.message);
          }
        })
        .catch((err: unknown) => {
          setSubmitting(false);
          setNotice(err instanceof Error ? err.message : 'Could not submit for review.');
        });
    });
  }

  async function runPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ids = testDocIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0 || testing) return;
    const sid = sessionIdRef.current;
    if (!sid) {
      setTestError({ code: 'NO_SESSION', message: 'There is no studio session yet — draft the review in the conversation first.' });
      return;
    }
    setTesting(true);
    setTestError(null);
    try {
      const outcome = await studioPreviewAction(sid, ids);
      if (outcome.ok) {
        setPreviewResult(outcome.data);
      } else {
        setPreviewResult(null);
        setTestError({ code: outcome.code, message: outcome.message });
      }
    } catch (err) {
      setPreviewResult(null);
      setTestError({ code: 'PREVIEW_FAILED', message: err instanceof Error ? err.message : 'Preview failed.' });
    } finally {
      setTesting(false);
    }
  }

  // ---------------------------------------------------------------- projection

  const workflow = revision?.workflow ?? null;

  const steps = useMemo<Step[]>(() => {
    if (workflow) {
      const ordered = [...workflow.nodes].sort((a, b) => (STAGE[a.kind] ?? 9) - (STAGE[b.kind] ?? 9));
      const pos = layoutSteps(ordered);
      return ordered.map((n) => {
        const at = pos.get(n.id) ?? { x: 0, y: 0 };
        return { id: n.id, kind: n.kind, raw: n, x: at.x, y: at.y, ...describeNode(n) };
      });
    }
    if (!draft) return [];
    return specToGraph(draft).nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.kind === 'rule' ? n.label : humanise(n.label),
      machine: n.kind === 'rule' ? undefined : n.label,
      detail: n.detail,
      x: n.position.x,
      y: n.position.y,
    }));
  }, [workflow, draft]);

  const stepEdges = useMemo(() => {
    if (workflow) {
      return workflow.edges.map((e: WfEdge) => ({
        id: `${e.from.node_id}:${e.from.port}->${e.to.node_id}:${e.to.port}`,
        source: e.from.node_id,
        target: e.to.node_id,
        label: e.when ? `${e.from.port} → ${e.to.port} (when)` : `${e.from.port} → ${e.to.port}`,
        raw: e,
      }));
    }
    if (!draft) return [];
    return specToGraph(draft).edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: undefined, raw: undefined }));
  }, [workflow, draft]);

  const titleById = useMemo(() => new Map(steps.map((s) => [s.id, s.title])), [steps]);
  const selectedStep = steps.find((s) => s.id === selectedNodeId) ?? null;

  const counts = useMemo(() => {
    const docTypes = workflow?.document_types.length ?? draft?.document_types.length ?? 0;
    const fields = workflow
      ? workflow.nodes.filter((n) => n.kind === 'extract_field').length
      : draft?.fields.length ?? 0;
    const rules = workflow
      ? workflow.nodes.filter((n) => n.kind === 'evaluate_rule').length
      : draft?.rules.length ?? 0;
    return {
      nodes: steps.length,
      edges: stepEdges.length,
      outputs: workflow?.outputs.length ?? 0,
      docTypes,
      fields,
      rules,
    };
  }, [workflow, draft, steps.length, stepEdges.length]);

  const diffCount = revision?.diff.length ?? 0;

  // ---------------------------------------------------------------- tab strip

  function onTabKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((t) => t.value === tab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next].value);
    const strip = tabStripRef.current;
    const button = strip?.querySelectorAll<HTMLButtonElement>('.stu-tab')[next];
    button?.focus();
  }

  // ---------------------------------------------------------------- panels

  function portsFor(nodeId: string) {
    const reads = stepEdges
      .filter((e) => e.target === nodeId && e.raw)
      .map((e) => ({
        port: e.raw!.to.port,
        peer: titleById.get(e.raw!.from.node_id) ?? e.raw!.from.node_id,
        peerPort: e.raw!.from.port,
        conditional: Boolean(e.raw!.when),
      }));
    const writes = stepEdges
      .filter((e) => e.source === nodeId && e.raw)
      .map((e) => ({
        port: e.raw!.from.port,
        peer: titleById.get(e.raw!.to.node_id) ?? e.raw!.to.node_id,
        peerPort: e.raw!.to.port,
        conditional: Boolean(e.raw!.when),
      }));
    return { reads, writes };
  }

  function renderDiagram() {
    if (steps.length === 0) {
      return (
        <div className="stu-body">
          <div className="stu-empty">
            <EmptyState
              title={booting ? 'Opening the draft…' : 'No workflow yet'}
              body={
                booting
                  ? 'Reading this Pack’s latest frozen version so you can edit it.'
                  : 'Describe the review in the conversation on the left. Each accepted turn becomes a validated revision, and its typed nodes and edges are drawn here.'
              }
              icon={<IconLayers className="ic lg" />}
            />
          </div>
        </div>
      );
    }
    if (workflow) {
      return (
        <WorkflowDiagram
          key={revision?.digest ?? 'wf'}
          steps={steps}
          edges={stepEdges}
          selectedId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
        />
      );
    }
    const legacy = draft ? specToGraph(draft) : { nodes: [], edges: [] };
    return (
      <GraphCanvas nodes={legacy.nodes} edges={legacy.edges} onChange={() => {}} onSelectNode={setSelectedNodeId} readOnly />
    );
  }

  function renderSpec() {
    if (steps.length === 0) {
      return (
        <div className="stu-body">
          <div className="stu-empty">
            <EmptyState
              title="No steps to read yet"
              body="Once a draft exists, every step appears here with the ports it reads, the ports it writes, and the configuration the runtime will use."
              icon={<IconRows className="ic lg" />}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="stu-body stu-body--pad">
        <div className="stu-wrap">
          {workflow && (
            <section className="stu-sec">
              <div className="stu-sechd">
                <h3>Contract</h3>
                <span className="n">
                  {counts.outputs} output{counts.outputs === 1 ? '' : 's'}
                </span>
                <p>What a run of this Pack returns</p>
              </div>
              {workflow.outputs.length === 0 ? (
                <p className="stu-fine">
                  This draft declares no outputs, so a run would produce nothing to review. Workflow validation
                  reports this as an error.
                </p>
              ) : (
                <div className="stu-box">
                  {workflow.outputs.map((o) => (
                    <Kv
                      key={o.name}
                      k={humanise(o.name)}
                      v={
                        <span className="stu-code">
                          {o.contract.kind} · {o.node_id}.{o.port}
                          {o.contract.include_citations ? ' · cited' : ''}
                        </span>
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="stu-sec">
            <div className="stu-sechd">
              <h3>Document types</h3>
              <span className="n">{counts.docTypes}</span>
              <p>What this Pack accepts</p>
            </div>
            {counts.docTypes === 0 ? (
              <p className="stu-fine">No document types declared yet.</p>
            ) : (
              <div className="chips">
                {(workflow?.document_types ?? draft?.document_types ?? []).map((t) => (
                  <span key={t} className="tag out" title={t}>
                    {humanise(t)}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="stu-sec">
            <div className="stu-sechd">
              <h3>Steps</h3>
              <span className="n">{counts.nodes}</span>
              <p>{workflow ? 'In execution order' : 'From the interim draft'}</p>
            </div>
            {steps.map((s, index) => {
              const { reads, writes } = portsFor(s.id);
              const outs = workflow?.outputs.filter((o) => o.node_id === s.id) ?? [];
              const selected = s.id === selectedNodeId;
              return (
                <div key={s.id} className={`stu-step${selected ? ' is-sel' : ''}`}>
                  <span className="no">{String(index + 1).padStart(2, '0')}</span>
                  <div className="bd">
                    <div className="hd">
                      <button
                        type="button"
                        className="stu-steptitle"
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedNodeId(s.id);
                          setPane('insp');
                        }}
                      >
                        <span className="stu-kind" data-kind={s.kind}>
                          {kindLabel(s.kind)}
                        </span>
                        <b>{s.title}</b>
                        {s.machine && <span className="stu-code">{s.machine}</span>}
                      </button>
                      <span className="id">{s.id}</span>
                    </div>
                    {s.detail && <p className="cbd mt-2">{s.detail}</p>}
                    {s.raw && (
                      <p className="stu-fine mt-2">
                        <b>On failure</b> {humanise(s.raw.on_failure)} · <b>Retry</b> {s.raw.retry.max_attempts}×,{' '}
                        {s.raw.retry.timeout_seconds}s timeout
                      </p>
                    )}
                  </div>
                  {workflow && (
                    <div className="stu-io">
                      <div>
                        <h4>Reads</h4>
                        <ul className="stu-ports">
                          {reads.length === 0 && <li className="none">Nothing — this step starts the run</li>}
                          {reads.map((r, i) => (
                            <li key={i}>
                              <span className="p">{r.port}</span>
                              <span className="arw">←</span>
                              <span className="peer">
                                {r.peer}.{r.peerPort}
                              </span>
                              {r.conditional && <span className="cond">when</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4>Writes</h4>
                        <ul className="stu-ports">
                          {writes.length === 0 && outs.length === 0 && (
                            <li className="none">Nothing consumes this step</li>
                          )}
                          {writes.map((w, i) => (
                            <li key={i}>
                              <span className="p">{w.port}</span>
                              <span className="arw">→</span>
                              <span className="peer">
                                {w.peer}.{w.peerPort}
                              </span>
                              {w.conditional && <span className="cond">when</span>}
                            </li>
                          ))}
                          {outs.map((o) => (
                            <li key={o.name}>
                              <span className="p">{o.port}</span>
                              <span className="arw">→</span>
                              <span className="peer">output “{o.name}”</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      </div>
    );
  }

  function renderChanges() {
    if (!revision) {
      return (
        <div className="stu-body">
          <div className="stu-empty">
            <EmptyState
              title="No revisions yet"
              body="Every accepted turn records the exact difference it made to the workflow. That audit trail appears here from the second revision onward."
              icon={<IconRefresh className="ic lg" />}
            />
          </div>
        </div>
      );
    }
    if (revision.diff.length === 0) {
      return (
        <div className="stu-body">
          <div className="stu-empty">
            <EmptyState
              title={`Revision ${revision.revision_no} has no parent to diff`}
              body={
                revision.parent_id
                  ? 'This revision is byte-identical to its parent — the turn changed nothing.'
                  : 'This is the first revision of the session, so there is nothing to compare it against. Your next accepted turn records its diff here.'
              }
              icon={<IconRefresh className="ic lg" />}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="stu-body stu-body--pad">
        <div className="stu-wrap">
          <div className="stu-sechd">
            <h3>Revision {revision.revision_no}</h3>
            <span className="n">{revision.diff.length} changes</span>
            <p>Against its parent revision</p>
          </div>
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
                {entry.op === 'add' && entry.next !== undefined && <p>{JSON.stringify(entry.next)}</p>}
                {entry.op === 'remove' && entry.prev !== undefined && (
                  <p>
                    <span className="line-through">{JSON.stringify(entry.prev)}</span>
                  </p>
                )}
              </div>
              <span className="rid">{entry.op}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderTest() {
    if (!hasDraft) {
      return (
        <div className="stu-body">
          <div className="stu-empty">
            <EmptyState
              title="Nothing to dry-run yet"
              body="A preview runs this session's current draft against documents you have already uploaded. Draft the review first, then paste the document IDs here."
              icon={<IconPlay className="ic lg" />}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="stu-body stu-body--pad">
        <div className="stu-wrap">
          <div className="stu-sechd">
            <h3>Dry run</h3>
            <p>Nothing is frozen by a preview</p>
          </div>
          <p className="cbd">
            Run the current draft against documents already uploaded to a workspace session to see what it would
            extract and verify. Document IDs are the UUIDs shown on a session’s document list.
          </p>
          <form className="stu-testform mt-3" onSubmit={runPreview}>
            <Input
              id="stu-docids"
              label="Document IDs"
              value={testDocIds}
              onChange={setTestDocIds}
              placeholder="Paste one or more document UUIDs, comma or space separated"
            />
            <ActionButton type="submit" variant="primary" disabled={!testDocIds.trim() || testing}>
              {testing ? 'Running…' : 'Run preview'}
            </ActionButton>
          </form>

          {testError && (
            <div className="stu-strip stu-strip--box dgr mt-3">
              <IconAlert className="ic s-ic" />
              <div className="s-bd">
                <b>Preview did not run</b>
                <p>{testError.message}</p>
                {testError.code === 'STUDIO_DRAFT_NOT_FOUND' && (
                  <p className="mt-2">
                    The preview endpoint reads the session’s legacy draft spec. Revision-based drafts — everything
                    authored here — do not write one, so this reports no draft until that backend gap is closed.
                    Approve a version and run it from a workspace session to see real results.
                  </p>
                )}
              </div>
            </div>
          )}

          {previewResult && (
            <section className="stu-sec mt-6">
              <div className="stu-sechd">
                <h3>Extracted facts</h3>
                <span className="n">{previewResult.facts.length}</span>
              </div>
              {previewResult.facts.length === 0 ? (
                <p className="stu-fine">The preview produced no facts for those documents.</p>
              ) : (
                <ul className="stu-facts">
                  {previewResult.facts.map((fact, index) => (
                    <li key={index}>
                      <div className="f-hd">
                        <b>{humanise(fact.field)}</b>
                        <span className="stu-code">{fact.field}</span>
                        <Tag
                          variant={fact.state === 'verified' ? 'accent' : fact.state === 'missing' ? 'danger' : 'warn'}
                        >
                          {fact.state}
                        </Tag>
                      </div>
                      {fact.value !== null && <p className="f-v">{fact.value}</p>}
                      {fact.citations.length > 0 && <p className="f-q">“{fact.citations[0].quote}”</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    );
  }

  function renderInspector() {
    if (selectedStep) {
      const { reads, writes } = portsFor(selectedStep.id);
      const raw = selectedStep.raw;
      const configEntries = raw ? Object.entries(raw.config ?? {}) : [];
      return (
        <>
          <section className="stu-icard">
            <div className="stu-ihd">
              <span className="stu-kind" data-kind={selectedStep.kind}>
                {kindLabel(selectedStep.kind)}
              </span>
              <IconButton
                icon={<IconClose className="ic sm" />}
                label="Clear selection"
                onClick={() => setSelectedNodeId(null)}
              />
            </div>
            <h3>{selectedStep.title}</h3>
            {selectedStep.detail && <p className="desc">{selectedStep.detail}</p>}
            <div className="stu-isec">
              <h4>Identity</h4>
              <Kv k="Node id" v={<span className="stu-code">{selectedStep.id}</span>} />
              {selectedStep.machine && <Kv k="Machine name" v={<span className="stu-code">{selectedStep.machine}</span>} />}
              {raw && <Kv k="Kind" v={<span className="stu-code">{raw.kind}</span>} />}
            </div>
            {raw && (
              <div className="stu-isec">
                <h4>Runtime policy</h4>
                <Kv k="On failure" v={humanise(raw.on_failure)} />
                <Kv k="Attempts" v={String(raw.retry.max_attempts)} />
                <Kv k="Timeout" v={`${raw.retry.timeout_seconds}s`} />
              </div>
            )}
            {configEntries.length > 0 && (
              <div className="stu-isec">
                <h4>Configuration</h4>
                {configEntries.map(([key, value]) => (
                  <Kv
                    key={key}
                    k={humanise(key)}
                    v={<span className="stu-code">{typeof value === 'string' ? value : JSON.stringify(value)}</span>}
                  />
                ))}
              </div>
            )}
            {raw ? (
              <>
                <div className="stu-isec">
                  <h4>Reads</h4>
                  <ul className="stu-ports">
                    {reads.length === 0 && <li className="none">Nothing — this step starts the run</li>}
                    {reads.map((r, i) => (
                      <li key={i}>
                        <span className="p">{r.port}</span>
                        <span className="arw">←</span>
                        <span className="peer">
                          {r.peer}.{r.peerPort}
                        </span>
                        {r.conditional && <span className="cond">when</span>}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="stu-isec">
                  <h4>Writes</h4>
                  <ul className="stu-ports">
                    {writes.length === 0 && <li className="none">Nothing consumes this step</li>}
                    {writes.map((w, i) => (
                      <li key={i}>
                        <span className="p">{w.port}</span>
                        <span className="arw">→</span>
                        <span className="peer">
                          {w.peer}.{w.peerPort}
                        </span>
                        {w.conditional && <span className="cond">when</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <p className="stu-fine stu-isec">
                This node comes from the interim draft projection, before the session’s canonical revision arrives.
                It has no typed ports or runtime policy yet.
              </p>
            )}
          </section>
          <p className="stu-fine">Select a different step on the diagram or in the Spec tab, or clear the selection to see the draft summary.</p>
        </>
      );
    }

    return (
      <>
        <div className="stu-stats">
          <Stat bare label="Nodes" value={counts.nodes} />
          <Stat bare label="Edges" value={counts.edges} />
          <Stat bare label="Outputs" value={counts.outputs} tone={counts.outputs === 0 && hasDraft ? 'missing' : 'default'} />
          <Stat bare label="Doc types" value={counts.docTypes} />
          <Stat bare label="Fields" value={counts.fields} />
          <Stat bare label="Rules" value={counts.rules} />
        </div>

        {revision ? (
          <section className="stu-icard">
            <div className="stu-ihd">
              <h3>Revision {revision.revision_no}</h3>
              {revision.validation.ok ? <Tag variant="accent">Valid</Tag> : <Tag variant="danger">Invalid</Tag>}
            </div>
            <Kv k="Drafted" v={formatDateTime(revision.created_at)} />
            <Kv k="Parent" v={revision.parent_id ? `Revision ${revision.revision_no - 1}` : 'None — first revision'} />
            <Kv k="Digest" v={<span className="stu-code">{revision.digest.slice(0, 16)}</span>} />
            {revision.model_id && <Kv k="Model" v={<span className="stu-code">{revision.model_id}</span>} />}
            <Kv k="Changes" v={`${diffCount} vs parent`} />
          </section>
        ) : (
          <section className="stu-icard">
            <h3>No revision yet</h3>
            <p className="desc">
              {booting
                ? 'Opening this Pack’s latest frozen version as draft revision 1.'
                : 'The studio records a validated revision for every accepted turn. Describe the review in the conversation to create the first one.'}
            </p>
          </section>
        )}

        <section className="stu-icard">
          <h3>{editing ? 'Pack identity' : 'Name this Pack'}</h3>
          {editing ? (
            <>
              <div className="stu-isec">
                <Kv k="Pack" v={packName || existingPackName || '—'} />
                <Kv k="Editing" v="Latest frozen version" />
              </div>
              <p className="stu-fine stu-isec">
                Approving a new version does not rename the Pack — the API takes no name — so the name is shown here
                rather than offered as an editable field.
              </p>
            </>
          ) : (
            <>
              <Input
                id="pack-name"
                label="Pack name"
                value={packName}
                onChange={setPackName}
                placeholder="e.g. Supplier invoice review"
              />
              <p className="stu-fine">
                Required to publish. This is the name workspaces will see in the marketplace.
              </p>
            </>
          )}
        </section>

        <p className="stu-fine">
          {editing
            ? 'Approving freezes a NEW version. Existing versions stay frozen; workspaces pick the new one up on their next run. Submitting for review sends this revision to a reviewer instead of freezing it yourself.'
            : 'Publishing approves this draft as version 1 and installs it into the workspace. Frozen versions are superseded, never edited in place.'}
        </p>
      </>
    );
  }

  // ---------------------------------------------------------------- render

  const statusTag = invalid
    ? { variant: 'danger' as const, label: 'Fails validation' }
    : revision
      ? { variant: 'accent' as const, label: `Revision ${revision.revision_no} · valid` }
      : hasDraft
        ? { variant: 'neutral' as const, label: 'Interim draft' }
        : { variant: 'neutral' as const, label: booting ? 'Opening…' : 'No draft yet' };

  const issues = invalid ? revision!.validation.errors : turnIssues;

  return (
    <section className="stu-root">
      <header className="stu-head">
        <div className="stu-back">
          <Button
            href={editing && packId ? `/marketplace/${packId}` : `/workspace/${workspaceId ?? ''}`}
            variant="ghost"
            size="sm"
            icon={<IconArrowLeft className="ic sm" />}
          >
            {editing ? 'Back to Pack' : `Back to ${workspaceName ?? 'workspace'}`}
          </Button>
        </div>

        <div className="stu-idrow">
          <div className="stu-id">
            <p className="eyebrow">{editing ? 'Pack Studio · new version' : 'Pack Studio · new Pack'}</p>
            <h1 className="stu-title">
              {packName || existingPackName || (workspaceName ? `Author a Pack for ${workspaceName}` : 'Author a Pack')}
            </h1>
            <div className="stu-meta">
              <Tag variant={statusTag.variant}>{statusTag.label}</Tag>
              <span className="dot" />
              <span className="stamp">
                {counts.nodes} nodes · {counts.edges} edges
              </span>
              {revision && <span className="stamp">{formatDateTime(revision.created_at)}</span>}
            </div>
          </div>

          <div className="stu-actwrap">
            <div className="stu-acts">
              {editing && (
                <ActionButton variant="outline" size="sm" disabled={!canSubmit} onClick={submitForReview}>
                  {submitting ? 'Submitting…' : 'Submit for review'}
                </ActionButton>
              )}
              <ActionButton
                variant="primary"
                size="sm"
                disabled={Boolean(blocked) || approving || submitting}
                onClick={approve}
              >
                {approving ? (editing ? 'Approving…' : 'Publishing…') : editing ? 'Approve new version' : 'Publish Pack'}
              </ActionButton>
            </div>
            {blocked && <p className="stu-fine">{blocked}</p>}
          </div>
        </div>

        <div className="stu-tabs" role="tablist" aria-label="Draft views" ref={tabStripRef} onKeyDown={onTabKey}>
          {TABS.map((t) => {
            const active = t.value === tab;
            const badge =
              t.value === 'spec' ? counts.nodes : t.value === 'changes' ? diffCount : null;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                id={`stu-tab-${t.value}`}
                aria-selected={active}
                aria-controls="stu-tabpanel"
                tabIndex={active ? 0 : -1}
                className="stu-tab"
                onClick={() => setTab(t.value)}
              >
                {t.label}
                {badge !== null && badge > 0 && <span className="n">{badge}</span>}
              </button>
            );
          })}
        </div>
      </header>

      {notice && (
        <div className="stu-strip warn" role="status">
          <IconAlert className="ic s-ic" />
          <div className="s-bd">
            <b>Heads up</b>
            <p>{notice}</p>
          </div>
          <IconButton icon={<IconClose className="ic sm" />} label="Dismiss" onClick={() => setNotice(null)} />
        </div>
      )}

      {issues.length > 0 && (
        <div className="stu-strip dgr" role="status">
          <IconAlert className="ic s-ic" />
          <div className="s-bd">
            <b>
              {issues.length} validation error{issues.length === 1 ? '' : 's'} — approval and review are blocked
            </b>
            <ul className="stu-issues">
              {issues.slice(0, 4).map((err, index) => (
                <li key={index}>
                  <span className="code">{err.code}</span>
                  {err.path && <span className="at">{err.path}</span>}
                  <span className="txt">{err.message}</span>
                </li>
              ))}
              {issues.length > 4 && <li className="txt">…and {issues.length - 4} more.</li>}
            </ul>
          </div>
        </div>
      )}

      <div className="stu-switch" role="group" aria-label="Choose a pane">
        {PANES.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={pane === p.value}
            className={`stu-sw ${p.cls}`.trim()}
            onClick={() => setPane(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={`stu-grid is-${pane}`}>
        <section className="stu-pane stu-pane--chat" aria-label="Build conversation">
          <div className="stu-phead">
            <h2>Conversation</h2>
            <span className="hint">
              {streaming
                ? 'Drafting…'
                : (() => {
                    const turns = lines.filter((l) => l.role === 'user').length;
                    return `${turns} turn${turns === 1 ? '' : 's'}`;
                  })()}
            </span>
          </div>
          <div className="chat-scroll">
            {lines.length === 0 && (
              <EmptyState
                title="Describe the review you need"
                body="Name the documents, the fields that must be extracted, and the checks that must pass. The studio drafts a typed workflow you can inspect, correct, and then approve."
                icon={<IconFile className="ic lg" />}
              />
            )}
            {lines.map((line, index) => (
              <div key={index} className={`msg${line.role === 'user' ? ' me' : ''}`}>
                {line.role === 'assistant' && (
                  <span className="msg-av">
                    <IconSparkle className="ic sm" />
                  </span>
                )}
                <div
                  className={`msg-bubble${line.state === 'error' ? ' is-err' : ''}${line.state === 'wait' ? ' is-wait' : ''}`}
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {line.content || (line.state === 'wait' ? 'Drafting…' : '')}
                  {line.issues && line.issues.length > 0 && (
                    <span className="msg-note">
                      {line.issues.slice(0, 3).map((err, i) => (
                        <span key={i} className="block">
                          <span className="code">{err.code}</span> {err.message}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          {lines.length === 0 && (
            <div className="stu-quick">
              <span className="lbl">Start from</span>
              {QUICK_PROMPTS.map((q) => (
                <button key={q.label} type="button" className="chip" onClick={() => setInput(q.prompt)}>
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <form
            className="stu-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <label className="sr-only" htmlFor="stu-composer">
              Describe the review this Pack should perform
            </label>
            <textarea
              id="stu-composer"
              className="stu-ta"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Describe the review — documents, fields to extract, checks to run."
            />
            <div className="stu-crow">
              <span className="hint">
                <kbd>Enter</kbd> to draft
              </span>
              <ActionButton type="submit" variant="primary" size="sm" disabled={!input.trim() || streaming}>
                {streaming ? 'Drafting…' : 'Draft'}
              </ActionButton>
            </div>
          </form>
        </section>

        <section
          className="stu-pane stu-pane--canvas"
          id="stu-tabpanel"
          role="tabpanel"
          aria-labelledby={`stu-tab-${tab}`}
          tabIndex={-1}
        >
          {tab === 'diagram' && renderDiagram()}
          {tab === 'spec' && renderSpec()}
          {tab === 'changes' && renderChanges()}
          {tab === 'test' && renderTest()}
          <div className="stu-foot">
            <span>
              {counts.nodes} nodes · {counts.edges} edges · {counts.outputs} output{counts.outputs === 1 ? '' : 's'}
            </span>
            <span>
              {revision
                ? `Revision ${revision.revision_no} · ${revision.validation.ok ? 'valid' : `${revision.validation.errors.length} errors`}`
                : hasDraft
                  ? 'Interim draft · not yet a revision'
                  : 'No draft yet'}
            </span>
          </div>
        </section>

        <aside className="stu-pane stu-pane--insp" aria-label="Inspector">
          <div className="stu-phead">
            <h2>Inspector</h2>
            <span className="hint">{selectedStep ? 'Step' : 'Draft'}</span>
          </div>
          <div className="stu-body stu-body--rail">{renderInspector()}</div>
        </aside>
      </div>
    </section>
  );
}
