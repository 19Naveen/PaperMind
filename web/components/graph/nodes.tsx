'use client';

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { EditableLabel } from './EditableLabel';

export type GraphNodeData = {
  /** 01..N sequence number, assigned by GraphCanvas in document_type → field → rule order. */
  num: string;
  label: string;
  detail?: string;
  onRename: (id: string, label: string) => void;
  /** When the canvas is read-only the label is NOT editable. It used to render the
   * editable affordance anyway: a rename mutated local canvas state, was emitted into
   * an `onChange` the studio deliberately ignores, and was silently lost. */
  readOnly?: boolean;
};

type GraphNode = Node<GraphNodeData>;

/** Card chrome lives in app/studio.css (`.wf-node`); the rail colour comes from the
 * `data-kind` attribute so no colour is expressed in this file. */
function shell(selected: boolean): string {
  return `wf-node${selected ? ' is-sel' : ''}`;
}

function Label({ id, data }: { id: string; data: GraphNodeData }) {
  if (data.readOnly) return <span className="l">{data.label}</span>;
  return <EditableLabel value={data.label} onChange={(v) => data.onRename(id, v)} className="l" />;
}

/** Document types: the sources feeding the pipeline. */
export function DocTypeNode({ id, data, selected }: NodeProps<GraphNode>) {
  return (
    <div className={shell(Boolean(selected))} data-kind="document_type">
      <Handle type="source" position={Position.Right} />
      <span className="k">{data.num} · Source</span>
      <Label id={id} data={data} />
    </div>
  );
}

/** Fields: the extraction step. The declared type rides along as a machine stamp. */
export function FieldNode({ id, data, selected }: NodeProps<GraphNode>) {
  return (
    <div className={shell(Boolean(selected))} data-kind="field">
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <span className="k">{data.num} · Field</span>
      <Label id={id} data={data} />
      {data.detail && (
        <span className="d" title={data.detail}>
          <span className="mono">{data.detail}</span>
        </span>
      )}
    </div>
  );
}

/** Rules: validations feeding off fields. The detail line carries the rule text. */
export function RuleNode({ id, data, selected }: NodeProps<GraphNode>) {
  return (
    <div className={shell(Boolean(selected))} data-kind="rule">
      <Handle type="target" position={Position.Left} />
      <span className="k">{data.num} · Rule</span>
      <Label id={id} data={data} />
      {data.detail && (
        <span className="d" title={data.detail}>
          {data.detail}
        </span>
      )}
    </div>
  );
}
