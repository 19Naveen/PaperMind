'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowEdge, FlowNode, NodeKind } from '@/lib/types';
import { IconSparkle } from '@/lib/icons';
import { ActionButton, EmptyState } from '@/components/ui';
import { DocTypeNode, FieldNode, RuleNode, type GraphNodeData } from './graph/nodes';

const nodeTypes = { document_type: DocTypeNode, field: FieldNode, rule: RuleNode };

type GNode = Node<GraphNodeData>;

const COL_X: Record<NodeKind, number> = { document_type: 40, field: 340, rule: 660 };
const KIND_ORDER: Record<NodeKind, number> = { document_type: 0, field: 1, rule: 2 };
const PLACEHOLDER: Record<NodeKind, string> = {
  document_type: 'New document type',
  field: 'new_field',
  rule: 'New rule',
};

// Nodes are numbered 01..N in document_type → field → rule order, so the cards
// can carry the prototype's numbered kicker and the ports/ledger views triangulate.
function toRFNodes(nodes: FlowNode[], onRename: (id: string, label: string) => void): GNode[] {
  return [...nodes]
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    .map((n, i) => ({
      id: n.id,
      type: n.kind,
      position: n.position,
      data: { label: n.label, detail: n.detail, num: String(i + 1).padStart(2, '0'), onRename },
    }));
}

function fromRFNodes(nodes: GNode[]): FlowNode[] {
  return nodes.map((n) => ({
    id: n.id,
    kind: n.type as NodeKind,
    label: n.data.label,
    detail: n.data.detail,
    position: n.position,
  }));
}

function toRFEdges(edges: FlowEdge[]): Edge[] {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
}

function fromRFEdges(edges: Edge[]): FlowEdge[] {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
}

function Canvas({
  nodes,
  edges,
  onChange,
  onSelectNode,
  readOnly,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onChange: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  onSelectNode?: (id: string | null) => void;
  readOnly: boolean;
}) {
  // Stable dispatcher so it can be baked into node data at creation time
  // without going stale — the ref is repointed at the latest handleRename
  // on every render, but the function identity handed to React Flow never
  // changes.
  const renameRef = useRef<(id: string, label: string) => void>(() => {});
  const onRename = useCallback((id: string, label: string) => renameRef.current(id, label), []);

  // The linter's ref-safety check can't see that `onRename` only dereferences
  // `renameRef.current` when *invoked* — from EditableLabel's later event
  // handler — never during this render. Storing the function itself (not
  // reading `.current`) into node.data is the part happening now.
  // eslint-disable-next-line react-hooks/refs
  const [rfNodes, setRfNodes] = useNodesState<GNode>(toRFNodes(nodes, onRename));
  const [rfEdges, setRfEdges] = useEdgesState<Edge>(toRFEdges(edges));

  const rfNodesRef = useRef(rfNodes);
  const rfEdgesRef = useRef(rfEdges);
  useEffect(() => {
    rfNodesRef.current = rfNodes;
  }, [rfNodes]);
  useEffect(() => {
    rfEdgesRef.current = rfEdges;
  }, [rfEdges]);

  // The last {nodes, edges} we handed to onChange — used to tell "the parent
  // echoed our own update back" apart from "the chat pane patched the graph
  // while we were open", so external patches resync without fighting drags.
  const lastEmitted = useRef<{ nodes: FlowNode[]; edges: FlowEdge[] }>({ nodes, edges });

  const emit = useCallback(
    (ns: GNode[], es: Edge[]) => {
      const flowNodes = fromRFNodes(ns);
      const flowEdges = fromRFEdges(es);
      lastEmitted.current = { nodes: flowNodes, edges: flowEdges };
      onChange(flowNodes, flowEdges);
    },
    [onChange],
  );

  const handleRename = useCallback(
    (id: string, label: string) => {
      setRfNodes((nds) => {
        const next = nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n));
        emit(next, rfEdgesRef.current);
        return next;
      });
    },
    [emit, setRfNodes],
  );
  useEffect(() => {
    renameRef.current = handleRename;
  }, [handleRename]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<GNode>[]) => {
      setRfNodes((nds) => {
        const next = applyNodeChanges<GNode>(changes, nds);
        // Measurement-only changes (React Flow fires `dimensions` during mount
        // and on resize, synchronously inside render) carry no graph meaning.
        // Emitting them would setState on the parent mid-render — the
        // "Cannot update a component while rendering" warning. Our graph state
        // stores no measurements, so they're safe to swallow here.
        if (changes.some((c) => c.type !== 'dimensions')) {
          emit(next, rfEdgesRef.current);
        }
        return next;
      });
    },
    [emit, setRfNodes],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        emit(rfNodesRef.current, next);
        return next;
      });
    },
    [emit, setRfEdges],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      setRfEdges((eds) => {
        const next = addEdge(connection, eds);
        emit(rfNodesRef.current, next);
        return next;
      });
    },
    [emit, setRfEdges],
  );

  const addNode = useCallback(
    (kind: NodeKind) => {
      setRfNodes((nds) => {
        const count = nds.filter((n) => n.type === kind).length;
        const id = `${kind}_${Math.random().toString(36).slice(2, 8)}`;
        const newNode: GNode = {
          id,
          type: kind,
          position: { x: COL_X[kind], y: 40 + count * 100 },
          data: { label: PLACEHOLDER[kind], detail: kind === 'field' ? 'string' : undefined, num: '00', onRename },
        };
        const next = toRFNodes(fromRFNodes([...nds, newNode]), onRename);
        emit(next, rfEdgesRef.current);
        return next;
      });
    },
    [emit, onRename, setRfNodes],
  );

  // External change (chat patch) landed while we're mounted — resync. Our
  // own updates round-trip through the exact same array references via
  // `emit`, so this skips echoes and only fires on real outside edits.
  useEffect(() => {
    if (nodes !== lastEmitted.current.nodes) {
      setRfNodes(toRFNodes(nodes, onRename));
      lastEmitted.current.nodes = nodes;
    }
  }, [nodes, onRename, setRfNodes]);
  useEffect(() => {
    if (edges !== lastEmitted.current.edges) {
      setRfEdges(toRFEdges(edges));
      lastEmitted.current.edges = edges;
    }
  }, [edges, setRfEdges]);

  return (
    <div className="pm-graph relative min-w-0 flex-1 bg-ground">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={readOnly ? undefined : handleNodesChange}
        onEdgesChange={readOnly ? undefined : handleEdgesChange}
        onConnect={readOnly ? undefined : handleConnect}
        onNodeClick={(_, n) => onSelectNode?.(String(n.id))}
        onPaneClick={() => onSelectNode?.(null)}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        nodesConnectable={!readOnly}
        nodesDraggable={!readOnly}
        elementsSelectable
        defaultEdgeOptions={{ style: { stroke: 'var(--color-ink-2)', strokeWidth: 1.5 } }}
        fitView
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="color-mix(in srgb, var(--color-ink-3) 22%, transparent)"
          gap={28}
          size={1}
        />
        <Controls showInteractive={!readOnly} />
        {!readOnly && <Panel position="top-left">
          <div className="flex gap-1.5 border border-rule bg-surface p-1.5 shadow-sm">
            <ActionButton variant="outline" size="sm" onClick={() => addNode('document_type')}>
              + Document type
            </ActionButton>
            <ActionButton variant="outline" size="sm" onClick={() => addNode('field')}>
              + Field
            </ActionButton>
            <ActionButton variant="outline" size="sm" onClick={() => addNode('rule')}>
              + Rule
            </ActionButton>
          </div>
        </Panel>}
        {nodes.length === 0 && (
          <Panel position="top-center">
            <div className="mx-auto mt-16 max-w-sm">
              <EmptyState
                title="Nothing to show yet"
                body={
                  readOnly
                    ? 'Describe the Pack in the conversation — nodes appear here as the studio drafts them.'
                    : 'Describe the Pack in the chat, or add a node here directly.'
                }
                icon={<IconSparkle width={18} height={18} />}
              />
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

export function GraphCanvas({
  nodes,
  edges,
  onChange,
  onSelectNode,
  readOnly = false,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onChange: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  onSelectNode?: (id: string | null) => void;
  readOnly?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <Canvas nodes={nodes} edges={edges} onChange={onChange} onSelectNode={onSelectNode} readOnly={readOnly} />
    </ReactFlowProvider>
  );
}
