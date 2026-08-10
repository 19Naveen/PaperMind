// ---------------------------------------------------------------------------
// Pack authoring: a Workspace's one Pack. Many chats, one live flow graph.
// API-facing types (WorkspaceOut, RunOut, Fact, ChatMessage, PackSpec …) live
// in lib/api.ts — this module holds only the graph/studio model built on top
// of them. Do not redefine an api.ts type here.
// ---------------------------------------------------------------------------

import type { WorkflowSpecV1, Node, Edge } from '@/lib/api';

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

// ---------------------------------------------------------------------------
// Pack spec → graph. A spec is the backend's frozen description of a Pack; the
// graph is its authorable form. Document types feed the fields extracted from
// them; a rule wires to a field only when the rule's own text names it — a
// real, derivable dependency rather than an invented one.
// ---------------------------------------------------------------------------

export interface PackField {
  name: string;
  description: string;
  type: string;
}

export interface PackRule {
  id: string;
  description: string;
}

export interface PackSpec {
  name: string;
  document_types: string[];
  fields: PackField[];
  rules: PackRule[];
}

const COL_X = { document_type: 40, field: 340, rule: 660 };
const ROW_H = 84;

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

// ---------------------------------------------------------------------------
// WorkflowSpecV1 → read-only canvas graph. A one-way projection of the
// canonical workflow (lib/api.ts) into the Pack Studio layout: one column per
// node kind in execution order, nodes stacked vertically within a column.
// Unlike specToGraph above (which projects the legacy PackSpec), this never
// feeds back into authoring — it is the read-only view of a compiled pack.
// ---------------------------------------------------------------------------

export interface WorkflowGraphNode {
  id: string;
  /** Workflow NodeKind (6-string union) — expressed via Node['kind'] to avoid
   * colliding with this module's legacy NodeKind (3-string) used by FlowNode. */
  kind: Node['kind'];
  label: string;
  detail?: string;
  x: number;
  y: number;
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

/** Read a string config value, or undefined when absent / not a string. */
function cfgStr(cfg: Record<string, unknown>, key: string): string | undefined {
  const v = cfg[key];
  return typeof v === 'string' ? v : undefined;
}

/** Derive a human label + optional detail per node kind. */
function nodeLabelDetail(n: Node): { label: string; detail?: string } {
  const field = cfgStr(n.config, 'field');
  switch (n.kind) {
    case 'classify_documents': {
      const types = Array.isArray(n.config.document_types) ? n.config.document_types : [];
      return { label: 'Classify', detail: types.length ? types.join(', ') : undefined };
    }
    case 'retrieve_evidence':
      return { label: 'Retrieve' };
    case 'extract_field':
      return { label: 'Extract ' + (field ?? n.id), detail: cfgStr(n.config, 'type') };
    case 'verify_field':
      return { label: 'Verify ' + (field ?? n.id) };
    case 'evaluate_rule':
      return {
        label: 'Rule ' + (cfgStr(n.config, 'rule_id') ?? n.id),
        detail: cfgStr(n.config, 'description'),
      };
    case 'render_checklist':
      return { label: 'Report' };
    default:
      return { label: n.id };
  }
}

export function workflowToGraph(
  spec: WorkflowSpecV1,
): { nodes: WorkflowGraphNode[]; edges: WorkflowGraphEdge[] } {
  // Column x per kind; extract_field and verify_field share 560 and stack by stage.
  const COL_X: Record<Node['kind'], number> = {
    classify_documents: 40,
    retrieve_evidence: 300,
    extract_field: 560,
    verify_field: 560,
    evaluate_rule: 820,
    render_checklist: 1080,
  };
  const STAGE: Record<Node['kind'], number> = {
    classify_documents: 0,
    retrieve_evidence: 1,
    extract_field: 2,
    verify_field: 3,
    evaluate_rule: 4,
    render_checklist: 5,
  };
  const ROW_H = 96;

  // Order by execution stage so the shared 560 column stacks extract above verify.
  const ordered = [...spec.nodes].sort((a, b) => STAGE[a.kind] - STAGE[b.kind]);
  const colIndex = new Map<number, number>();
  const nodes: WorkflowGraphNode[] = ordered.map((n) => {
    const x = COL_X[n.kind];
    const i = colIndex.get(x) ?? 0;
    colIndex.set(x, i + 1);
    const { label, detail } = nodeLabelDetail(n);
    return { id: n.id, kind: n.kind, label, detail, x, y: i * ROW_H };
  });

  const edges: WorkflowGraphEdge[] = spec.edges.map((e: Edge) => {
    const ports = `${e.from.port}->${e.to.port}`;
    return {
      id: `${e.from.node_id}:${e.from.port}->${e.to.node_id}:${e.to.port}`,
      source: e.from.node_id,
      target: e.to.node_id,
      label: e.when ? `${ports} (when)` : ports,
    };
  });

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Marketplace seed type (display metadata only — see lib/mock.ts)
// ---------------------------------------------------------------------------

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
