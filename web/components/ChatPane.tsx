'use client';

import { useEffect, useRef, useState } from 'react';
import type { Chat, ChatMessage, GraphPatch } from '@/lib/types';
import { ActionButton } from './ui';

// Layout constants mirrored from lib/types.ts specToGraph — keeps nodes this
// chat adds sitting in the same three columns as anything an imported spec
// would have placed.
const COL_X = { document_type: 40, field: 340, rule: 660 };
const ROW_H = 84;

const GREETING =
  "New workspace, empty flow — nothing on the canvas yet. Tell me what you're checking and what documents come in, " +
  "and I'll start wiring up document types, fields, and rules as we go. You'll see each one land on the canvas as we talk.";

/** One scripted turn: a fixed assistant reply, optionally with a graph patch. */
interface Turn {
  reply: string;
  patch?: GraphPatch;
}

const SCRIPT: Turn[] = [
  {
    reply:
      "Vendor due diligence — got it. I'll start with the document types a review like this needs: Vendor Contract, DPA, and Privacy Policy. Added all three.",
    patch: {
      addNodes: [
        { id: 'doc:Vendor Contract', kind: 'document_type', label: 'Vendor Contract', position: { x: COL_X.document_type, y: 0 } },
        { id: 'doc:DPA', kind: 'document_type', label: 'DPA', position: { x: COL_X.document_type, y: ROW_H } },
        { id: 'doc:Privacy Policy', kind: 'document_type', label: 'Privacy Policy', position: { x: COL_X.document_type, y: 2 * ROW_H } },
      ],
    },
  },
  {
    reply:
      'Next, the fields to pull off the Vendor Contract. Added `liability_cap` and `jurisdiction`, both wired from Vendor Contract.',
    patch: {
      addNodes: [
        { id: 'field:liability_cap', kind: 'field', label: 'liability_cap', detail: 'currency', position: { x: COL_X.field, y: 0 } },
        { id: 'field:jurisdiction', kind: 'field', label: 'jurisdiction', detail: 'string', position: { x: COL_X.field, y: ROW_H } },
      ],
      addEdges: [
        { id: 'doc:Vendor Contract->field:liability_cap', source: 'doc:Vendor Contract', target: 'field:liability_cap' },
        { id: 'doc:Vendor Contract->field:jurisdiction', source: 'doc:Vendor Contract', target: 'field:jurisdiction' },
      ],
    },
  },
  {
    reply: 'One thing I need from you: do you require a DPA for all vendors, or only those outside the EU?',
  },
  {
    reply:
      "Understood — I'll treat a signed DPA as required whenever a vendor processes EU personal data. Added `dpa_signed_date` off the DPA doc type, plus a rule requiring it.",
    patch: {
      addNodes: [
        { id: 'field:dpa_signed_date', kind: 'field', label: 'dpa_signed_date', detail: 'date', position: { x: COL_X.field, y: 2 * ROW_H } },
        { id: 'rule:r1', kind: 'rule', label: 'Rule 1', detail: 'A signed DPA must be present for any vendor processing EU personal data', position: { x: COL_X.rule, y: 0 } },
      ],
      addEdges: [
        { id: 'doc:DPA->field:dpa_signed_date', source: 'doc:DPA', target: 'field:dpa_signed_date' },
        { id: 'field:dpa_signed_date->rule:r1', source: 'field:dpa_signed_date', target: 'rule:r1' },
      ],
    },
  },
  {
    reply:
      "I'll also add guardrails on the numbers you've already got: liability cap must be at least $250,000, and jurisdiction must sit within the EU or an adequacy-decision country. Added both as rules.",
    patch: {
      addNodes: [
        { id: 'rule:r2', kind: 'rule', label: 'Rule 2', detail: 'Liability cap must be at least $250,000', position: { x: COL_X.rule, y: ROW_H } },
        { id: 'rule:r3', kind: 'rule', label: 'Rule 3', detail: 'Jurisdiction must be within the EU or an adequacy-decision country', position: { x: COL_X.rule, y: 2 * ROW_H } },
      ],
      addEdges: [
        { id: 'field:liability_cap->rule:r2', source: 'field:liability_cap', target: 'rule:r2' },
        { id: 'field:jurisdiction->rule:r3', source: 'field:jurisdiction', target: 'rule:r3' },
      ],
    },
  },
  {
    reply:
      "That covers what I'd ask by default — feel free to keep chatting, or tweak the flow directly on the canvas.",
  },
];

const FALLBACK: Turn = {
  reply: "Noted — I'm not adding anything further to the flow from here. Adjust nodes directly on the canvas for anything beyond this.",
};

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Chat switcher up top (dense tabs, one per open thread), the active thread's
 * messages below, composer at the bottom. There's no backend: every reply is
 * a fixed line from SCRIPT, keyed by how many user messages that chat has
 * sent so far — chat.messages already tracks that, so each chat's turn
 * counter falls out of its own message list, no extra state needed.
 */
export function ChatPane({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onAppendMessage,
  onApplyPatch,
}: {
  chats: Chat[];
  activeChatId: string;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onAppendMessage: (chatId: string, message: ChatMessage) => void;
  onApplyPatch: (patch: GraphPatch) => void;
}) {
  const [input, setInput] = useState('');
  const greeted = useRef(new Set<string>());
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeChat = chats.find((c) => c.id === activeChatId);

  // A fresh chat opens on an empty flow — greet it once with a real opening
  // message rather than leaving a blank thread.
  useEffect(() => {
    if (activeChat && activeChat.messages.length === 0 && !greeted.current.has(activeChat.id)) {
      greeted.current.add(activeChat.id);
      onAppendMessage(activeChat.id, { id: uid('m'), role: 'assistant', content: GREETING });
    }
  }, [activeChat, onAppendMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeChat?.messages.length]);

  function send() {
    const text = input.trim();
    if (!text || !activeChat) return;
    const turnIndex = activeChat.messages.filter((m) => m.role === 'user').length;
    onAppendMessage(activeChat.id, { id: uid('m'), role: 'user', content: text });
    setInput('');
    const turn = SCRIPT[turnIndex] ?? FALLBACK;
    onAppendMessage(activeChat.id, { id: uid('m'), role: 'assistant', content: turn.reply });
    if (turn.patch) onApplyPatch(turn.patch);
  }

  const messages = activeChat?.messages ?? [];
  const lastAssistantIdx = messages.length - 1 >= 0 && messages[messages.length - 1].role === 'assistant' ? messages.length - 1 : -1;

  return (
    <div className="flex w-[360px] shrink-0 flex-col border-r-2 border-rule bg-surface">
      <div className="shrink-0 border-b border-rule px-[18px] py-3 text-[10px] uppercase tracking-[0.1em] text-ink-2">
        Build conversation
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-rule px-[18px] py-2.5">
        {chats.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelectChat(c.id)}
            className={`max-w-[9rem] truncate border px-2 py-1 font-data text-[11px] transition ${
              c.id === activeChatId ? 'border-accent bg-accent-soft text-accent' : 'border-rule bg-surface text-ink-2 hover:text-ink'
            }`}
            title={c.title}
          >
            {c.title}
          </button>
        ))}
        <button
          onClick={onNewChat}
          className="border border-dashed border-rule px-2 py-1 font-data text-[11px] text-ink-2 hover:border-accent hover:text-accent"
        >
          + New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ul className="flex flex-col">
          {messages.map((m, i) => (
            <li
              key={m.id}
              className={`border-b border-rule px-[18px] py-[14px] ${
                i === lastAssistantIdx ? 'sweep' : undefined
              }`}
              aria-live={i === lastAssistantIdx ? 'polite' : undefined}
            >
              <p className={`eyebrow ${m.role === 'user' ? '' : 'text-accent'}`}>
                {m.role === 'user' ? 'You' : 'PaperMind'}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{m.content}</p>
            </li>
          ))}
        </ul>
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t-2 border-rule p-[14px]">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={activeChat ? 'Describe what to check…' : 'Select a chat'}
          disabled={!activeChat}
          className="min-h-[70px] w-full resize-none border border-rule bg-raised p-2.5 text-[13.5px] text-ink outline-none focus-visible:border-accent"
        />
        <div className="mt-2 flex items-center gap-2">
          <ActionButton onClick={send} variant="primary" size="md" disabled={!activeChat || !input.trim()}>
            Send
          </ActionButton>
          <ActionButton variant="secondary" size="md" onClick={() => {}}>
            Attach asset
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

// ponytail: SCRIPT node ids (doc:Vendor Contract, field:liability_cap, …) are
// fixed per turn, so running the same script in two chats on one workspace
// adds duplicate ids to the shared graph — ChatPane only sees `chats`, not the
// live nodes, so there's no cheap way to check "already added" from here.
// Fine for this scripted demo (applyGraphPatch is additive-only, nothing
// breaks); dedupe by id in applyGraphPatch itself if that becomes real.
