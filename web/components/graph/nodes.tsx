'use client';

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { EditableLabel } from './EditableLabel';

export type GraphNodeData = {
  /** 01..N sequence number, assigned by GraphCanvas in document_type → field → rule order. */
  num: string;
  label: string;
  detail?: string;
  onRename: (id: string, label: string) => void;
};

type GraphNode = Node<GraphNodeData>;

const shell =
  'min-w-40 max-w-56 bg-surface border border-rule px-3 py-2 text-base text-ink shadow-sm transition hover:border-accent hover:shadow-md';

const kicker = 'text-2xs tracking-widest uppercase text-accent';

/** Document types: the sources feeding the pipeline. Page glyph, numbered kicker. */
export function DocTypeNode({ id, data, selected }: NodeProps<GraphNode>) {
  return (
    <div className={`${shell} ${selected ? 'ring-2 ring-accent' : ''}`}>
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-ink-2">
          <path
            d="M2.5 1h4.5L9.5 3.5V11h-7V1z"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <path d="M7 1v2.5h2.5" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
        <p className={kicker}>
          {data.num} · Source
        </p>
      </div>
      <EditableLabel
        value={data.label}
        onChange={(v) => data.onRename(id, v)}
        className="mt-1 block text-base leading-tight"
      />
    </div>
  );
}

/** Fields: the extraction step. Funnel glyph, type shown as a data-font stamp. */
export function FieldNode({ id, data, selected }: NodeProps<GraphNode>) {
  return (
    <div className={`${shell} ${selected ? 'ring-2 ring-accent' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-ink-2">
          <path d="M1.5 2h9L7 6.5V10l-2 1V6.5L1.5 2z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
        <p className={kicker}>
          {data.num} · Field
        </p>
      </div>
      <EditableLabel
        value={data.label}
        onChange={(v) => data.onRename(id, v)}
        className="mt-1 block text-base leading-tight"
      />
      {data.detail && <p className="stamp mt-1.5 inline-block">{data.detail}</p>}
    </div>
  );
}

/** Rules: validations feeding off fields. Detail line carries the rule text. */
export function RuleNode({ id, data, selected }: NodeProps<GraphNode>) {
  return (
    <div className={`${shell} ${selected ? 'ring-2 ring-accent' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-ink-2">
          <path d="M6 1l4.5 2.2v3.6L6 11 1.5 6.8V3.2L6 1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
          <path d="M4 6l1.4 1.4L8.2 4.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className={kicker}>
          {data.num} · Rule
        </p>
      </div>
      <EditableLabel
        value={data.label}
        onChange={(v) => data.onRename(id, v)}
        className="mt-1 block text-base leading-tight"
      />
      {data.detail && (
        <p className="mt-1 truncate text-sm text-ink-2" title={data.detail}>
          {data.detail}
        </p>
      )}
    </div>
  );
}
