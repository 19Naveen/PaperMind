'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { IMPORT_SPEC_KEY } from '@/lib/types';

/** Loads a Pack spec JSON file and hands it to a fresh workspace to open. */
export function ImportPackButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    try {
      const spec = JSON.parse(text);
      if (!spec.document_types || !spec.fields) throw new Error('not a Pack spec');
      sessionStorage.setItem(IMPORT_SPEC_KEY, text);
      router.push('/workspace/new');
    } catch {
      alert('That file doesn’t look like a Pack spec — expected JSON with document_types and fields.');
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="application/json" className="hidden" onChange={onFile} />
      <button
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-none border border-dashed border-accent/50 px-2.5 py-1.5 text-[12.5px] font-medium text-accent transition hover:border-accent hover:bg-accent-soft"
      >
        Import spec
      </button>
    </>
  );
}
