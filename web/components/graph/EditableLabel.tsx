'use client';

import { useState } from 'react';

/**
 * Double-click a node's label to rename it inline. Shared by all three node
 * kinds — the only thing renaming needs is a controlled span/input swap.
 */
export function EditableLabel({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
    else setDraft(value);
  }

  if (editing) {
    return (
      <input
        autoFocus
        className={`nodrag w-full rounded-none border border-accent bg-surface px-1 py-0.5 text-inherit outline-none ${className ?? ''}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <span
      className={className}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
      title="Double-click to rename"
    >
      {value}
    </span>
  );
}
