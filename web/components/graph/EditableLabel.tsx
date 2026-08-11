'use client';

import { useState } from 'react';

/**
 * Rename a node's label in place. Shared by all three legacy node kinds.
 *
 * Reachable by keyboard as well as by mouse: the resting state is a real button, so
 * Tab reaches it and Enter/Space opens the editor. The old build was a `<span>` with
 * an `onDoubleClick` and a "Double-click to rename" tooltip, which meant renaming was
 * impossible without a pointer.
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

  function start() {
    setDraft(value);
    setEditing(true);
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Node label"
        className={`nodrag wf-rename ${className ?? ''}`.trim()}
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
    <button
      type="button"
      className={`wf-renamebtn ${className ?? ''}`.trim()}
      title="Rename"
      aria-label={`Rename ${value}`}
      onClick={(e) => {
        e.stopPropagation();
        start();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        start();
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2') {
          e.preventDefault();
          start();
        }
      }}
    >
      {value}
    </button>
  );
}
