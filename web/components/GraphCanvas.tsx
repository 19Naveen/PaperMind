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
function toRFNodes(
  nodes: FlowNode[],
  onRename: (id: string, label: string) => void,
  readOnly: boolean,
): GNode[] {
  return [...nodes]
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    .map((n, i) => ({
      id: n.id,
      type: n.kind,
      position: n.position,
      data: { label: n.label, detail: n.detail, num: String(i + 1).padStart(2, '0'), onRename, readOnly },
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
  const [rfNodes, setRfNodes] = useNodesState<GNode>(toRFNodes(nodes, onRename, readOnly));
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
          data: { label: PLACEHOLDER[kind], detail: kind === 'field' ? 'string' : undefined, num: '00', onRename, readOnly },
        };
        const next = toRFNodes(fromRFNodes([...nds, newNode]), onRename, readOnly);
        emit(next, rfEdgesRef.current);
        return next;
      });
    },
    [emit, onRename, setRfNodes, readOnly],
  );

  // External change (chat patch) landed while we're mounted — resync. Our
  // own updates round-trip through the exact same array references via
  // `emit`, so this skips echoes and only fires on real outside edits.
  useEffect(() => {
    if (nodes !== lastEmitted.current.nodes) {
      setRfNodes(toRFNodes(nodes, onRename, readOnly));
      lastEmitted.current.nodes = nodes;
    }
  }, [nodes, onRename, setRfNodes, readOnly]);
  useEffect(() => {
    if (edges !== lastEmitted.current.edges) {
      setRfEdges(toRFEdges(edges));
      lastEmitted.current.edges = edges;
    }
  }, [edges, setRfEdges]);

  return (
    <div className="relative min-w-0 flex-1 bg-ground">
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
          color="color-mix(in srgb, #201e1d 22%, transparent)"
          gap={28}
          size={1}
        />
        <Controls showInteractive={!readOnly} className="!border !border-rule !bg-surface !shadow-sm [&_button]:!border-rule [&_button]:!bg-surface [&_button]:!text-ink [&_button:hover]:!bg-raised [&_svg]:!fill-ink" />
        {!readOnly && <Panel position="top-left">
          <div className="flex gap-1.5 border border-rule bg-surface p-1.5 shadow-sm">
            <button
              onClick={() => addNode('document_type')}
              className="border border-rule px-2 py-1 text-[12px] text-ink hover:border-accent hover:text-accent"
            >
              + Document type
            </button>
            <button
              onClick={() => addNode('field')}
              className="border border-rule px-2 py-1 text-[12px] text-ink hover:border-accent hover:text-accent"
            >
              + Field
            </button>
            <button
              onClick={() => addNode('rule')}
              className="border border-rule px-2 py-1 text-[12px] text-ink hover:border-accent hover:text-accent"
            >
              + Rule
            </button>
          </div>
        </Panel>}
        {nodes.length === 0 && (
          <Panel position="top-center">
            <div className="mt-24 flex max-w-xs flex-col items-center border border-dashed border-rule bg-surface px-6 py-6 text-center shadow-sm">
              <span className="flex h-10 w-10 items-center justify-center border border-rule bg-raised text-ink-2">
                <IconSparkle width={16} height={16} />
              </span>
              <p className="display mt-3 text-[14px] text-ink">Nothing to show yet</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                Describe the Pack in the chat, or add a node here directly.
              </p>
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
