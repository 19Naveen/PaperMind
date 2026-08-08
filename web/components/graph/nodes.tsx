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
  'min-w-[168px] max-w-[220px] rounded-[3px] bg-white border border-[#d9deea] px-3 py-2.5 text-[13px] text-ink shadow-[0_4px_14px_rgba(30,41,59,0.08)] transition-[border-color,box-shadow] hover:border-accent hover:shadow-[0_8px_20px_rgba(30,41,59,0.12)]';

const kicker = 'text-[9.5px] tracking-[0.1em] uppercase text-accent';

/** Document types: the sources feeding the pipeline. Page glyph, numbered kicker. */
export function DocTypeNode({ id, data, selected }: NodeProps<GraphNode>) {
  return (
    <div className={`${shell} ${selected ? 'ring-2 ring-accent' : ''}`}>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-rule !bg-ink-2" />
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
        className="display mt-1 block text-[13px] leading-tight"
      />
    </div>
  );
}

/** Fields: the extraction step. Funnel glyph, type shown as a data-font stamp. */
export function FieldNode({ id, data, selected }: NodeProps<GraphNode>) {
  return (
    <div className={`${shell} ${selected ? 'ring-2 ring-accent' : ''}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-rule !bg-ink-2" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-rule !bg-ink-2" />
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
        className="display mt-1 block text-[13px] leading-tight"
      />
      {data.detail && <p className="stamp mt-1.5 inline-block">{data.detail}</p>}
    </div>
  );
}

/** Rules: validations feeding off fields. Detail line carries the rule text. */
export function RuleNode({ id, data, selected }: NodeProps<GraphNode>) {
  return (
    <div className={`${shell} ${selected ? 'ring-2 ring-accent' : ''}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-rule !bg-ink-2" />
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
        className="display mt-1 block text-[13px] leading-tight"
      />
      {data.detail && (
        <p className="mt-1 truncate text-[12px] text-ink-2" title={data.detail}>
          {data.detail}
        </p>
      )}
    </div>
  );
}
