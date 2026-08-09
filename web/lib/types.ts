export type FactState = 'verified' | 'unsupported' | 'missing';
export type RunStatus = 'pending' | 'running' | 'complete' | 'failed';

/** The six deterministic runtime stages, in order. */
export const STAGES = [
  'classify',
  'retrieve',
  'extract',
  'verify',
  'cross-validate',
  'report',
] as const;
export type Stage = (typeof STAGES)[number];

export interface Citation {
  chunk_id: string;
  quote: string;
  document_id: string;
  document_name: string;
  page: number;
  char_start: number;
  char_end: number;
}

export interface Fact {
  id: string;
  case_id: string;
  field: string;
  value: string | null;
  state: FactState;
  citations: Citation[];
}

export interface RunDocument {
  id: string;
  case_id: string;
  name: string;
  doc_type: string | null;
}

/** One subject under review — a vendor, a customer, a lease. */
export interface Case {
  id: string;
  subject: string;
}

export interface Run {
  id: string;
  pack_id: string;
  pack_name: string;
  pack_version: number;
  status: RunStatus;
  stage: Stage | null;
  started_at: string;
  cases: Case[];
  documents: RunDocument[];
  facts: Fact[];
}

/** Source text + page offsets — what EvidenceViewer highlights into. */
export interface DocumentContent {
  id: string;
  name: string;
  text: string;
  pages: { page: number; char_start: number }[];
}

// The Pack spec is the API's contract type (lib/api.ts); re-export it here so
// authoring code reads from the same shape the backend validates against.
import type { PackSpec } from '@/lib/api';
export type { PackSpec };
export interface PackVersion {
  id: string;
  version: number;
  created_at: string;
  spec: PackSpec;
}
export interface Pack {
  id: string;
  name: string;
  latest_version: number;
  updated_at: string;
}

export function factsForCase(run: Run, caseId: string): Fact[] {
  return run.facts.filter((f) => f.case_id === caseId);
}

export function countByState(facts: Fact[]): Record<FactState, number> {
  return facts.reduce((acc, f) => ({ ...acc, [f.state]: acc[f.state] + 1 }), {
    verified: 0,
    unsupported: 0,
    missing: 0,
  });
}

/** A case is clear only when every field in it verified. */
export function caseIsClear(run: Run, caseId: string): boolean {
  const facts = factsForCase(run, caseId);
  return facts.length > 0 && facts.every((f) => f.state === 'verified');
}

/** Bates-style locator: the stamp that makes a citation pointable. */
export function locator(c: Citation): string {
  return `${c.document_id.toUpperCase()} · p${c.page} · ${c.char_start}–${c.char_end}`;
}

// ---------------------------------------------------------------------------
// Workspaces: the container level. A Workspace defines a business objective and
// is composed from Packs; Sessions are the isolated executions inside it.
// ---------------------------------------------------------------------------

export type WorkspaceStatus = 'draft' | 'ready' | 'running';
export type SessionStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface WorkspaceSession {
  id: string;
  title: string;
  status: SessionStatus;
  /** 0–100, meaningful while running. */
  progress: number;
  messages: ChatMessage[];
  /** When present, this session renders live evidence from a Run's case. */
  run_id?: string;
  case_id?: string;
  meta?: string;
  docs_label?: string;
  subject?: string;
  updated?: string;
  files?: SessionFile[];
  report?: ReportRow[];
}

export interface SessionFile {
  name: string;
  size: string;
}

export interface ReportRow {
  k: string;
  v: string;
}

export interface PackAsset {
  name: string;
  meta: string;
}

export interface PackNode {
  num: string;
  kicker: string;
  title: string;
  sub: string;
  in: string;
  out: string;
  asset: string;
  prompt: string;
}

export interface MarketplacePack {
  id: string;
  category: string;
  name: string;
  description: string;
  nodes: number;
  assets: number;
  installs: string;
  author: string;
}

export interface Workspace {
  id: string;
  name: string;
  goal: string;
  status: WorkspaceStatus;
  /** e.g. "Draft v3" — a workspace's Pack is versioned too. */
  draft_label: string | null;
  /** null until the first "Freeze" — the workspace's Pack can predate the Pack. */
  pack_id: string | null;
  /** The workspace's one Pack, authored via chat + a live flow graph. */
  chats: Chat[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  updated_at: string;
  sessions: WorkspaceSession[];
  pack_name?: string | null;
  pack_version?: string | null;
  pack_description?: string;
  pack_category?: string | null;
  pack_published?: boolean;
  pack_assets?: PackAsset[];
  usage?: number[];
}

export function countSessions(sessions: WorkspaceSession[]): Record<SessionStatus, number> {
  return sessions.reduce(
    (acc, s) => ({ ...acc, [s.status]: acc[s.status] + 1 }),
    { pending: 0, running: 0, complete: 0, failed: 0 },
  );
}

// ---------------------------------------------------------------------------
// Pack Library: the reusable, versioned capabilities a workspace is composed
// from. Sessions never invent rules — they're composed from these Packs.
// ---------------------------------------------------------------------------

export type PackCategory = 'Compliance' | 'Legal' | 'Finance' | 'Engineering';

export interface LibraryPack {
  id: string;
  name: string;
  category: PackCategory;
  description: string;
  version: number;
  /** The kinds of capability this Pack contributes to a session. */
  contributes: string[];
  checks: string[];
}

// ---------------------------------------------------------------------------
// Pack authoring: a Workspace's one Pack. Many chats, one live flow graph.
// ---------------------------------------------------------------------------

export type NodeKind = 'document_type' | 'field' | 'rule';

export interface FlowNode {
  id: string;
  kind: NodeKind;
  label: string;
  detail?: string;
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
}

const COL_X = { document_type: 40, field: 340, rule: 660 };
const ROW_H = 84;

/**
 * The spec, laid out as a graph. Document types feed the fields extracted
 * from them; a rule wires to a field only when the rule's own text names it —
 * a real, derivable dependency rather than an invented one, since the PackSpec
 * doesn't declare a source document type or a rule->field reference today.
 */
export function specToGraph(spec: PackSpec): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const docNodes = spec.document_types.map((name, i) => ({
    id: `doc:${name}`,
    kind: 'document_type' as const,
    label: name,
    position: { x: COL_X.document_type, y: i * ROW_H },
  }));
  const fieldNodes = spec.fields.map((f, i) => ({
    id: `field:${f.name}`,
    kind: 'field' as const,
    label: f.name,
    detail: f.type,
    position: { x: COL_X.field, y: i * ROW_H },
  }));
  const ruleNodes = spec.rules.map((r, i) => ({
    id: `rule:${r.id}`,
    kind: 'rule' as const,
    label: `Rule ${i + 1}`,
    detail: r.description,
    position: { x: COL_X.rule, y: i * ROW_H },
  }));
  nodes.push(...docNodes, ...fieldNodes, ...ruleNodes);

  for (const d of docNodes) {
    for (const f of fieldNodes) {
      edges.push({ id: `${d.id}->${f.id}`, source: d.id, target: f.id });
    }
  }
  for (const r of ruleNodes) {
    for (const f of fieldNodes) {
      if (r.detail?.toLowerCase().includes(f.label.replace(/_/g, ' ').toLowerCase())) {
        edges.push({ id: `${f.id}->${r.id}`, source: f.id, target: r.id });
      }
    }
  }
  return { nodes, edges };
}

export function newChat(title: string): Chat {
  return { id: `chat_${Math.random().toString(36).slice(2, 9)}`, title, messages: [] };
}

/** A stub Pack the wizard "creates" until the backend exists. */
export const SAMPLE_WORKSPACE_ID = 'ws_vendor';

/** sessionStorage key an imported Pack spec JSON is handed to the workspace wizard through. */
export const IMPORT_SPEC_KEY = 'papermind:import-spec';

/** What a chat turn does to the graph. Additive by default — nothing here deletes silently. */
export interface GraphPatch {
  addNodes?: FlowNode[];
  removeNodeIds?: string[];
  addEdges?: FlowEdge[];
  removeEdgeIds?: string[];
}

export function applyGraphPatch(
  nodes: FlowNode[],
  edges: FlowEdge[],
  patch: GraphPatch,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const removeNodes = new Set(patch.removeNodeIds ?? []);
  const removeEdges = new Set(patch.removeEdgeIds ?? []);
  const nextNodes = [...nodes.filter((n) => !removeNodes.has(n.id)), ...(patch.addNodes ?? [])];
  const nextEdges = [
    ...edges.filter((e) => !removeEdges.has(e.id) && !removeNodes.has(e.source) && !removeNodes.has(e.target)),
    ...(patch.addEdges ?? []),
  ];
  return { nodes: nextNodes, edges: nextEdges };
}
