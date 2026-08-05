'use client';

import { useState } from 'react';
import type { ChatMessage, PackNode, Workspace } from '@/lib/types';
import { PACK_NODES } from '@/lib/mock';
import { ActionButton, PageHeader, Seg, Tag } from '@/components/ui';

type BuilderView = 'diagram' | 'ports' | 'ledger';

const VIEW_OPTIONS: { value: BuilderView; label: string }[] = [
  { value: 'diagram', label: 'Diagram' },
  { value: 'ports', label: 'Ports' },
  { value: 'ledger', label: 'Ledger' },
];

/**
 * Fixed DAG layout matching the prototype exactly: 01→02, 02→{03,04},
 * 03→05, 04→06, {05,06}→07. Node size is 196×76; positions and the SVG
 * connector paths below are both derived from these coordinates, so they
 * stay in sync only because both read from this one map.
 */
const NODE_POSITION: Record<string, { left: number; top: number }> = {
  '01': { left: 20, top: 210 },
  '02': { left: 244, top: 210 },
  '03': { left: 468, top: 96 },
  '04': { left: 468, top: 324 },
  '05': { left: 692, top: 96 },
  '06': { left: 692, top: 324 },
  '07': { left: 916, top: 210 },
};
const CONNECTORS = [
  'M216,248 H244',
  'M440,248 H454 V134 H468',
  'M440,248 H454 V362 H468',
  'M664,134 H692',
  'M664,362 H692',
  'M888,134 H902 V248 H916',
  'M888,362 H902 V248 H916',
];

function NodeCard({ node, selected, onSelect }: { node: PackNode; selected: boolean; onSelect: (node: PackNode) => void }) {
  const output = node.num === '07';
  const position = NODE_POSITION[node.num] ?? { left: 20, top: 210 };
  return <button type="button" onClick={() => onSelect(node)} className={`absolute h-[76px] w-[196px] border p-3 text-left shadow-sm transition-colors ${output ? 'border-accent bg-accent-soft' : selected ? 'border-ink bg-surface' : 'border-rule bg-surface hover:border-ink-3'}`} style={{ left: `${position.left}px`, top: `${position.top}px` }}><p className="font-data text-[9px] uppercase tracking-[.09em] text-accent">{node.kicker}</p><p className="display mt-1 text-[14px] font-extrabold leading-tight">{node.title}</p><p className="mt-1 text-[10px] leading-snug text-ink-2">{node.sub}</p></button>;
}

export function PackBuilderView({ initial }: { initial: Workspace }) {
  const [view, setView] = useState<BuilderView>('diagram');
  const [selected, setSelected] = useState<PackNode | null>(null);
  const [draftDescription, setDraftDescription] = useState('');
  // No backend to create a Pack yet — "Create Pack draft" seeds the builder
  // locally, same as the chat's submit() below only ever mutates local state.
  const [draftCreated, setDraftCreated] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initial.chats[0]?.messages ?? []);
  const [input, setInput] = useState('');
  const hasPack = Boolean(initial.pack_name) || draftCreated;
  const packName = initial.pack_name ?? (draftCreated ? `${initial.name} (draft)` : initial.name);
  const assets = initial.pack_assets ?? [];
  const submit = () => {
    const content = input.trim();
    if (!content) return;
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', content }, { id: `assistant-${Date.now()}`, role: 'assistant', content: 'I have updated the Pack draft. Review the workflow, ports and ledger before publishing a new version.' }]);
    setInput('');
  };
  const createDraft = () => {
    const description = draftDescription.trim();
    if (!description) return;
    setMessages([
      { id: `user-${Date.now()}`, role: 'user', content: description },
      { id: `assistant-${Date.now()}`, role: 'assistant', content: 'Drafted a seven-step workflow from that description. Review the diagram, ports and ledger, then publish when it looks right.' },
    ]);
    setDraftCreated(true);
  };

  if (!hasPack) {
    return (
      <main className="min-h-full bg-ground text-ink">
        <PageHeader
          eyebrow="Pack builder"
          title={initial.name}
          actions={<ActionButton variant="secondary">Version history</ActionButton>}
        />
        <section className="mx-auto flex min-h-[calc(100vh-85px)] max-w-2xl flex-col justify-center px-6">
          <p className="eyebrow text-accent">Start with a Pack</p>
          <h2 className="display mt-2 text-[34px] font-extrabold leading-none">Describe the work you want to standardize</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">Build a Pack from a conversation, then review its nodes, assets and outputs here before publishing it.</p>
          <textarea
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder="For example: review supplier onboarding documents against our policy..."
            className="mt-6 min-h-28 border border-rule bg-surface p-3 text-[13px] outline-none focus:border-accent"
          />
          <ActionButton variant="primary" disabled={!draftDescription.trim()} onClick={createDraft} className="mt-3 w-fit">
            Create Pack draft
          </ActionButton>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-full flex-col bg-ground text-ink">
      <PageHeader
        eyebrow="Pack builder"
        title={packName}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Seg options={VIEW_OPTIONS} value={view} onChange={setView} />
            <ActionButton variant="secondary">Version history</ActionButton>
            <ActionButton variant="primary">Publish</ActionButton>
          </div>
        }
      />
      <div className="grid min-h-0 flex-1 xl:grid-cols-[360px_minmax(0,1fr)_312px]">
        <aside className="flex min-h-[360px] flex-col border-b-2 border-rule bg-surface xl:min-h-0 xl:border-b-0 xl:border-r-2">
          <div className="border-b border-rule px-4 py-3">
            <p className="eyebrow text-accent">Build conversation</p>
            <p className="mt-1 text-[11px] text-ink-2">Describe changes. The Pack remains versioned.</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {messages.map((message) => (
              <article key={message.id} className={`border-b border-rule py-4 ${message.role === 'user' ? 'text-right' : ''}`}>
                <p className={`eyebrow ${message.role === 'assistant' ? 'text-accent' : ''}`}>{message.role === 'user' ? 'You' : 'PaperMind'}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{message.content}</p>
              </article>
            ))}
          </div>
          <form className="border-t-2 border-rule p-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask to change this Pack..." className="min-h-[72px] w-full resize-none border border-rule bg-raised p-2 text-[12px] outline-none focus:border-accent"/>
            <ActionButton type="submit" variant="primary" disabled={!input.trim()} className="mt-2">Send</ActionButton>
          </form>
        </aside>
        <section className="min-w-0 overflow-auto">
          {view === 'diagram' ? (
            <div className="overflow-x-auto">
              <div className="relative h-[460px] min-w-[1152px]" style={{ backgroundImage: 'radial-gradient(var(--color-rule) 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1152 460" fill="none" aria-hidden>
                  <defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="none" stroke="currentColor" /></marker></defs>
                  {CONNECTORS.map((d) => <path key={d} d={d} stroke="currentColor" className="text-ink-3" strokeWidth="1.5" markerEnd="url(#arrow)" />)}
                </svg>
                {PACK_NODES.map((node) => <NodeCard key={node.num} node={node} selected={selected?.num === node.num} onSelect={setSelected} />)}
              </div>
            </div>
          ) : view === 'ports' ? (
            <div className="min-w-[800px] p-5">
              <p className="eyebrow">Data ports</p>
              <div className="mt-3 grid grid-cols-4 border-l border-t-2 border-rule">
                {PACK_NODES.map((node) => (
                  <button key={node.num} onClick={() => setSelected(node)} className="border-b border-r border-rule p-3 text-left hover:bg-raised">
                    <p className="font-data text-[10px] text-accent">{node.kicker}</p>
                    <p className="display mt-1 text-[14px] font-extrabold">{node.title}</p>
                    <p className="mt-3 font-data text-[10px] text-ink-2">IN {node.in}</p>
                    <p className="mt-1 font-data text-[10px] text-ink-2">OUT {node.out}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="min-w-[720px] p-5">
              <p className="eyebrow">Ledger · execution order</p>
              <div className="mt-3 border-t-2 border-rule">
                {PACK_NODES.map((node) => (
                  <button key={node.num} onClick={() => setSelected(node)} className="grid w-full grid-cols-[52px_1fr_240px] gap-4 border-b border-rule py-3 text-left hover:bg-raised">
                    <span className="display text-[20px] font-extrabold text-accent">{node.num}</span>
                    <span><b className="display text-[15px]">{node.title}</b><small className="mt-1 block text-[11px] text-ink-2">{node.sub}</small></span>
                    <span className="font-data text-[10px] text-ink-2">{node.in} → {node.out}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
        <aside className="border-t-2 border-rule bg-surface p-4 xl:border-l-2 xl:border-t-0">
          <p className="eyebrow text-accent">{selected ? selected.kicker : 'Pack contents'}</p>
          {selected ? (
            <>
              <h2 className="display mt-1 text-[18px] font-extrabold">{selected.title}</h2>
              <p className="mt-1 text-[12px] text-ink-2">{selected.sub}</p>
              <hr className="my-4 border-rule"/>
              <p className="eyebrow">Instructions</p>
              <p className="mt-2 border-l-[3px] border-accent bg-raised p-3 text-[12px] leading-relaxed">{selected.prompt}</p>
              <p className="eyebrow mt-4">Ports</p>
              <p className="mt-2 font-data text-[11px] text-ink-2">IN {selected.in}<br/>OUT {selected.out}</p>
              <p className="eyebrow mt-4">Asset</p>
              <Tag variant="accent" className="mt-1">{selected.asset}</Tag>
              <ActionButton variant="secondary" onClick={() => setSelected(null)} className="mt-5 w-full">Clear selection</ActionButton>
            </>
          ) : (
            <>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-2">Select a node to inspect its prompt, ports and attached asset.</p>
              <div className="mt-4 divide-y divide-rule border-y border-rule">
                {assets.map((asset) => (
                  <div key={asset.name} className="py-2.5">
                    <p className="font-data text-[11px]">{asset.name}</p>
                    <p className="text-[10px] text-ink-3">{asset.meta}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
