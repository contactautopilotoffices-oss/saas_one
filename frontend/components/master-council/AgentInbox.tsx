'use client';

/**
 * AgentInbox — per-agent mailboxes.
 *
 * Left: agent picker. Right: the agent's in/out thread (body_html rendered;
 * drafts carry the amber treatment) and two compose modes — "As agent"
 * (draft or send, from-name = agent) and "To agent" (writes a 'received'
 * message; the agent's reply arrives as a generated draft — server-side via
 * persona + LLM in live mode, a local persona stub in fixture mode).
 *
 * Endpoints (wired by the chamber shell via props):
 *   GET  /api/council/inbox?agent=<key>
 *   POST /api/council/inbox            { agent_key, to, subject, html, send }
 *   POST /api/council/inbox/to-agent   { agent_key, from, subject, text }
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, Send, Save, PenLine, CornerUpLeft, Phone } from 'lucide-react';
import type { AgentKey, CouncilAgent, CouncilInboxMessage } from './fixtures';
import AgentAvatar from './AgentAvatar';

const EASE = [0.19, 1, 0.22, 1] as const;

type ComposeMode = 'as-agent' | 'to-agent';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 11px',
  borderRadius: 10,
  border: '1px solid var(--cc-hairline)',
  background: 'rgba(255, 255, 255, 0.65)',
  fontSize: 12.5,
  fontWeight: 500,
  color: 'var(--cc-ink)',
  outline: 'none',
  fontFamily: 'var(--font-body)',
};

function InboxStatusChip({ status }: { status: CouncilInboxMessage['status'] }) {
  const color =
    status === 'received' ? 'var(--cc-blue)' : status === 'draft' ? 'var(--cc-amber)' : 'var(--cc-green)';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 9px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        lineHeight: 1.4,
        textTransform: 'capitalize',
        color: 'var(--cc-ink-2)',
        boxShadow: 'inset 0 0 0 1px var(--cc-hairline)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, flex: 'none', borderRadius: 999, background: color }}
      />
      {status}
    </span>
  );
}

export default function AgentInbox({
  agents,
  initialMessages,
  onCompose,
  onToAgent,
  onCall,
}: {
  agents: CouncilAgent[];
  initialMessages: CouncilInboxMessage[];
  /** Starts a 1:1 voice call with the selected member. */
  onCall?: (agent: CouncilAgent) => void;
  onCompose?: (payload: {
    agent_key: AgentKey;
    to: string;
    subject: string;
    html: string;
    send: boolean;
  }) => Promise<void>;
  onToAgent?: (payload: {
    agent_key: AgentKey;
    from: string;
    subject: string;
    text: string;
  }) => Promise<void>;
}) {
  const [messages, setMessages] = useState<CouncilInboxMessage[]>(initialMessages);
  const [selected, setSelected] = useState<AgentKey>(agents[0]?.key ?? 'ops');

  // Live mode: inboxes load after mount — adopt them when the prop changes.
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);
  const [mode, setMode] = useState<ComposeMode>('as-agent');
  const [to, setTo] = useState('');
  const [from, setFrom] = useState('saniel@aop.com');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const agent = agents.find((a) => a.key === selected) ?? agents[0];
  const thread = useMemo(
    () =>
      messages
        .filter((m) => m.agent_key === selected)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages, selected],
  );
  const counts = useMemo(() => {
    const c = new Map<AgentKey, number>();
    for (const m of messages) c.set(m.agent_key, (c.get(m.agent_key) ?? 0) + 1);
    return c;
  }, [messages]);

  const resetCompose = () => {
    setSubject('');
    setBody('');
    setTo('');
  };

  const pushMessage = (msg: CouncilInboxMessage) => setMessages((cur) => [...cur, msg]);

  const compose = async (send: boolean) => {
    if (!agent || !to.trim() || !subject.trim() || !body.trim()) return;
    setBusy(true);
    setNote(null);
    const html = `<p>${body
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, '<br/>'))
      .join('</p><p>')}</p>`;
    const local: CouncilInboxMessage = {
      id: `local-${Date.now()}`,
      agent_key: agent.key,
      direction: 'out',
      from_addr: `${agent.name} — ${agent.title} <${agent.email}>`,
      to_addr: to.trim(),
      subject: subject.trim(),
      body_html: html,
      status: send ? 'sent' : 'draft',
      created_at: new Date().toISOString(),
    };
    pushMessage(local);
    try {
      await onCompose?.({ agent_key: agent.key, to: to.trim(), subject: subject.trim(), html, send });
      setNote(send ? 'Sent.' : 'Saved as draft.');
    } catch {
      setNote('Recorded locally — the mailbox endpoint rejected the save.');
    } finally {
      setBusy(false);
      resetCompose();
    }
  };

  const writeToAgent = async () => {
    if (!agent || !from.trim() || !subject.trim() || !body.trim()) return;
    setBusy(true);
    setNote(null);
    const text = body.trim();
    const subj = subject.trim();
    pushMessage({
      id: `local-${Date.now()}`,
      agent_key: agent.key,
      direction: 'in',
      from_addr: from.trim(),
      to_addr: agent.email,
      subject: subj,
      body_html: `<p>${text.replace(/\n/g, '<br/>')}</p>`,
      status: 'received',
      created_at: new Date().toISOString(),
    });
    try {
      await onToAgent?.({ agent_key: agent.key, from: from.trim(), subject: subj, text });
      setNote(`Delivered to ${agent.name} — a draft reply is being composed.`);
    } catch {
      setNote('Recorded locally — the endpoint rejected the write.');
    } finally {
      setBusy(false);
    }
    // Fixture mode only: stand in for the server's persona-generated draft reply.
    if (!onToAgent) {
      const replyAgent = agent;
      window.setTimeout(() => {
        pushMessage({
          id: `local-reply-${Date.now()}`,
          agent_key: replyAgent.key,
          direction: 'out',
          from_addr: `${replyAgent.name} — ${replyAgent.title} <${replyAgent.email}>`,
          to_addr: from.trim(),
          subject: `Re: ${subj}`,
          body_html: `<p>Received, and thank you for the specifics. I am checking “${subj}” against this week's data pack and will answer with evidence, not adjectives.</p><p>— ${replyAgent.name}</p>`,
          status: 'draft',
          created_at: new Date().toISOString(),
        });
      }, 900);
    }
    resetCompose();
  };

  if (!agent) return null;

  const modeTab = (key: ComposeMode, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setMode(key)}
      style={{
        padding: '5px 12px',
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 700,
        fontFamily: 'var(--font-body)',
        color: mode === key ? '#fff' : 'var(--cc-ink-2)',
        background: mode === key ? 'var(--cc-ink)' : 'transparent',
        transition: 'all 300ms cubic-bezier(0.19, 1, 0.22, 1)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '230px minmax(0, 1fr)',
        gap: 14,
        alignItems: 'start',
      }}
    >
      {/* ------------------------------------------------------ agent picker */}
      <div className="cc-card" style={{ padding: 8, gap: 1 }}>
        <div style={{ padding: '6px 10px 8px', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Inbox size={12} style={{ color: 'var(--council-ink-cap)' }} />
          <span className="cc-title" style={{ fontSize: 9.5 }}>
            Agent inboxes
          </span>
        </div>
        {agents.map((a) => {
          const active = a.key === selected;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => setSelected(a.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                width: '100%',
                padding: '7px 9px',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'var(--font-body)',
                background: active ? `color-mix(in srgb, ${a.color} 10%, transparent)` : 'transparent',
                boxShadow: active ? `inset 2px 0 0 ${a.color}` : 'none',
                transition: 'all 300ms cubic-bezier(0.19, 1, 0.22, 1)',
              }}
            >
              <AgentAvatar agent={a} size={26} />
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: active ? 700 : 600,
                    lineHeight: 1.4,
                    color: 'var(--cc-ink)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {a.name}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 10.5,
                    fontWeight: 500,
                    lineHeight: 1.4,
                    color: 'var(--council-ink-cap)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {a.title}
                </span>
              </span>
              {(counts.get(a.key) ?? 0) > 0 && (
                <span
                  style={{
                    flex: 'none',
                    fontSize: 10.5,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--council-ink-cap)',
                  }}
                >
                  {counts.get(a.key)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---------------------------------------------------------- thread */}
      <div className="cc-card" style={{ padding: '16px 18px', minHeight: 480 }}>
        <div className="cc-card-head" style={{ marginBottom: 12 }}>
          <AgentAvatar agent={agent} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cc-ink)', lineHeight: 1.35 }}>
              {agent.name} — {agent.title}
            </div>
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.4,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: 'var(--council-ink-cap)',
              }}
            >
              {agent.email}
            </div>
          </div>
          <div
            className="cc-head-meta"
            style={{
              display: 'flex',
              gap: 2,
              background: 'rgba(30, 42, 48, 0.05)',
              borderRadius: 999,
              padding: 3,
            }}
          >
            {modeTab('as-agent', `Compose as ${agent.name}`)}
            {modeTab('to-agent', `Write to ${agent.name}`)}
          </div>
          {onCall && (
            <button
              type="button"
              onClick={() => onCall(agent)}
              title={`Call ${agent.name} — 1:1 voice, full duplex`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 13px',
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--cc-ink)',
                background: `color-mix(in srgb, ${agent.color} 14%, transparent)`,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${agent.color} 40%, transparent)`,
                transition: 'all 300ms cubic-bezier(0.19, 1, 0.22, 1)',
              }}
            >
              <Phone size={12} /> Call
            </button>
          )}
        </div>

        {/* messages */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {thread.length === 0 && (
            <div
              style={{
                padding: '30px 16px',
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--cc-ink-2)',
                lineHeight: 1.55,
              }}
            >
              {agent.name}'s mailbox is empty. Write to the agent below — the reply
              arrives as a draft in the agent's own voice.
            </div>
          )}
          <AnimatePresence initial={false}>
            {thread.map((m) => {
              const inbound = m.direction === 'in';
              return (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, ease: EASE }}
                  style={{
                    alignSelf: inbound ? 'flex-start' : 'flex-end',
                    maxWidth: '82%',
                    minWidth: 'min(320px, 60%)',
                    padding: '11px 14px',
                    borderRadius: 12,
                    background: inbound
                      ? 'rgba(30, 42, 48, 0.045)'
                      : `color-mix(in srgb, ${agent.color} 6%, transparent)`,
                    border: `1px solid ${
                      m.status === 'draft'
                        ? 'color-mix(in srgb, var(--cc-amber) 35%, transparent)'
                        : 'var(--cc-hairline)'
                    }`,
                    borderLeft: inbound
                      ? '1px solid var(--cc-hairline)'
                      : `2px solid ${agent.color}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        lineHeight: 1.4,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--council-ink-cap)',
                      }}
                    >
                      {inbound ? m.from_addr : m.to_addr}
                    </span>
                    <span style={{ marginLeft: 'auto', flex: 'none' }}>
                      <InboxStatusChip status={m.status} />
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--cc-ink)', lineHeight: 1.45 }}>
                    {m.subject}
                  </div>
                  <div
                    className="council-mail-body"
                    style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--cc-ink-2)', marginTop: 5 }}
                    dangerouslySetInnerHTML={{ __html: m.body_html }}
                  />
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 500,
                      lineHeight: 1.4,
                      color: 'var(--council-ink-cap)',
                      marginTop: 7,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {new Date(m.created_at).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {m.status === 'draft' && ` · drafted in ${agent.name}'s voice — review before sending`}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* compose */}
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px solid var(--cc-hairline)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {mode === 'as-agent' ? (
              <PenLine size={12} style={{ color: 'var(--council-ink-cap)' }} />
            ) : (
              <CornerUpLeft size={12} style={{ color: 'var(--council-ink-cap)' }} />
            )}
            <span className="cc-title" style={{ fontSize: 9.5 }}>
              {mode === 'as-agent'
                ? `Compose — from ${agent.name} <${agent.email}>`
                : `Write to ${agent.name} — reply arrives as a draft`}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 }}>
            {mode === 'as-agent' ? (
              <input
                style={inputStyle}
                placeholder="To — e.g. saniel@aop.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            ) : (
              <input
                style={inputStyle}
                placeholder="From — your address"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
            <input
              style={inputStyle}
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 74, resize: 'vertical', lineHeight: 1.5 }}
            placeholder={
              mode === 'as-agent'
                ? `Write in ${agent.name}'s voice — evidence first, no platitudes…`
                : `Ask ${agent.name} something specific — the more numbers you give, the sharper the reply…`
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {mode === 'as-agent' ? (
              <>
                <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => compose(false)}>
                  <Save size={11} /> Save draft
                </button>
                <button type="button" className="cc-btn" disabled={busy} onClick={() => compose(true)}>
                  <Send size={11} /> Send as {agent.name}
                </button>
              </>
            ) : (
              <button type="button" className="cc-btn" disabled={busy} onClick={writeToAgent}>
                <Send size={11} /> Send to {agent.name}
              </button>
            )}
            {note && (
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--cc-ink-2)' }}>{note}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
