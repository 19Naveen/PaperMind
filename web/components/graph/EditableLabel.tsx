'use client';

import { useState } from 'react';

/**
 * A node's label: plain text when read-only, or an inline rename when editable.
 * Renaming opens on double-click or Enter/Space (the keyboard path is not
 * double-click-only), and the field is labelled for screen readers.
 */
export function EditableLabel({
  value,
  onChange,
  className,
  readOnly,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function startEdit() {
    if (readOnly) return;
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
    else setDraft(value);
  }

  if (readOnly) {
    return <span className={className}>{value}</span>;
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={`Rename ${value}`}
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
          // Space types a space here rather than toggling — stop the default scroll.
          if (e.key === ' ') e.stopPropagation();
        }}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Rename ${value}`}
      className={`${className ?? ''} cursor-text`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        startEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          startEdit();
        }
      }}
    >
      {value}
    </span>
  );
}
