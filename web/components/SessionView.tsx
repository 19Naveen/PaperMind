'use client';

import { useState } from 'react';
import type { ChatMessage, Fact, RunDocument, WorkspaceSession, SessionStatus } from '@/lib/types';
import { PACK_NODES } from '@/lib/mock';
import { PageHeader, ActionButton, Card, CardKicker, CardTitle, CardBody, Tag, Pill, type PillTone } from '@/components/ui';

const STATUS_TONE: Record<SessionStatus, PillTone> = {
  running: 'running',
  complete: 'verified',
  failed: 'missing',
  pending: 'neutral',
};

export function SessionView(props: { workspaceId: string; workspaceName: string; session: WorkspaceSession; runReady: boolean; counts: { verified: number; unsupported: number; missing: number }; docs: RunDocument[]; facts: Fact[]; runId?: string; caseId?: string }) {
  const { workspaceName, session, runReady } = props;
  const [messages, setMessages] = useState<ChatMessage[]>(session.messages);
  const [input, setInput] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const completed = runReady && session.status === 'complete';
  const send = (text = input) => {
    const content = text.trim();
    if (!content) return;
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', content }, { id: `assistant-${Date.now()}`, role: 'assistant', content: completed ? 'I have added that to this session review. The report and its supporting artifacts remain tied to this Pack version.' : 'Upload the session documents when ready. I will run the Pack and prepare the report from those files.' }]);
    setInput('');
    setReply(content);
  };

  return <main className="flex min-h-full flex-col bg-ground text-ink">
    <PageHeader
      eyebrow={`Session in ${workspaceName}`}
      title={session.title}
      actions={<>
        <Tag variant="neutral">Pack {workspaceName}</Tag>
        <ActionButton variant="primary">{completed ? 'Run again' : 'Start run'}</ActionButton>
      </>}
    />
    <div className="grid min-h-0 flex-1 lg:grid-cols-[452px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b-2 border-rule bg-surface lg:border-b-0 lg:border-r-2">
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <p className="eyebrow text-accent">Session state</p>
          <Pill tone={STATUS_TONE[session.status]}>{session.status}</Pill>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <section className="border-b border-rule py-4">
            <p className="eyebrow">Uploaded files</p>
            {session.files && session.files.length > 0 ? <div className="mt-2 space-y-2">{session.files.map((file) => <div key={file.name} className="flex justify-between gap-3 font-data text-[11px]"><span className="truncate">{file.name}</span><span className="text-ink-3">{file.size}</span></div>)}</div> : <p className="mt-2 text-[12px] text-ink-2">No documents uploaded.</p>}
          </section>
          {completed && <section className="border-b border-rule py-4">
            <p className="eyebrow text-accent">Pack execution</p>
            <div className="mt-2">{PACK_NODES.map((node) => <div key={node.num} className="grid grid-cols-[30px_1fr_auto] gap-2 border-b border-rule/60 py-2 text-[12px]"><span className="font-data text-ink-3">{node.num}</span><span>{node.title}</span><span className="font-data text-[10px] text-verified">done</span></div>)}</div>
          </section>}
          <section>{messages.map((message) => <article key={message.id} className={`border-b border-rule py-4 ${message.role === 'user' ? 'text-right' : ''}`}><p className={`eyebrow ${message.role === 'assistant' ? 'text-accent' : ''}`}>{message.role === 'user' ? 'You' : 'PaperMind'}</p><p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{message.content}</p></article>)}</section>
          {completed && session.id === 'abc' && !reply && <div className="py-4">
            <p className="eyebrow">Suggested replies</p>
            <div className="mt-2 flex flex-wrap gap-2">{['Confirm passport date', 'Request clarification', 'Show open items'].map((item) => <ActionButton key={item} size="sm" onClick={() => send(item)}>{item}</ActionButton>)}</div>
          </div>}
        </div>
        <form className="border-t-2 border-rule p-4" onSubmit={(event) => { event.preventDefault(); send(); }}>
          <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about this session..." className="min-h-[68px] w-full resize-none border border-rule bg-raised p-2.5 text-[13px] outline-none focus:border-accent" />
          <ActionButton type="submit" variant="primary" disabled={!input.trim()} className="mt-2">Send</ActionButton>
        </form>
      </aside>
      <section className="min-w-0 overflow-auto p-5 sm:p-7">{!completed ? <div className="mx-auto mt-16 max-w-md border border-dashed border-rule bg-surface p-8 text-center"><p className="eyebrow text-accent">No document yet</p><h2 className="display mt-2 text-[23px] font-extrabold">This session is waiting for files</h2><p className="mt-3 text-[13px] leading-relaxed text-ink-2">Upload the customer documents to run the Pack. Its artifacts and report will appear here.</p></div> : <>
        <div className="flex items-center justify-between">
          <p className="eyebrow">Artifacts</p>
          <ActionButton>Download all</ActionButton>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">{['KYC report .docx', 'Extracted fields .json', 'Review summary .md'].map((artifact) => <Card key={artifact} className="flex flex-col gap-2">
          <CardKicker>Output</CardKicker>
          <CardTitle className="text-[16px]">{artifact}</CardTitle>
          <CardBody className="text-[11px]">Generated from this session and its fixed Pack version.</CardBody>
        </Card>)}</div>
        <Card className="mt-7 max-w-3xl bg-white px-6 py-6 shadow-md sm:px-9 sm:py-9">
          <p className="eyebrow text-accent">Extraction report</p>
          <h2 className="display mt-2 text-[25px] font-extrabold">{session.subject ?? session.title}</h2>
          <div className="my-5 h-px bg-rule" />
          {(session.report ?? []).map((row) => <div key={row.k} className="grid grid-cols-[120px_1fr] gap-4 border-b border-rule py-2 text-[12px]"><span className="uppercase tracking-[.08em] text-ink-3">{row.k}</span><span>{row.v}</span></div>)}
        </Card>
        <section className="mt-8 max-w-3xl">
          <p className="eyebrow">Why this run is comparable</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">Every session executes the same Pack version: identical nodes, prompts, assets and report template.</p>
          <div className="mt-4 grid grid-cols-2 border-l border-t-2 border-rule sm:grid-cols-4">{[['Nodes', '7'], ['Files', String(session.files?.length ?? 0)], ['Report rows', String(session.report?.length ?? 0)], ['Pack', 'Fixed']].map(([label, value]) => <div key={label} className="border-b border-r border-rule p-3"><p className="display text-[21px] font-extrabold">{value}</p><p className="text-[10px] text-ink-2">{label}</p></div>)}</div>
        </section>
      </>}</section>
    </div>
  </main>;
}
