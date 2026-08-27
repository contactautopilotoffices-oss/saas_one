'use client';

/**
 * CouncilChamber — the Agent Council view (master admin playground).
 *
 * A dark chamber (`.cc-canvas` family) with eight agent presences arranged
 * below the chairman's elevated synthesis screen. Convene flow: question →
 * POST /api/council/sessions → poll GET /api/council/sessions/[id] every 2 s
 * until complete; the transcript unfolds live under the chamber.
 *
 * Calm-tech rule: exactly ONE pulsing element at a time — the agent currently
 * speaking (stage 1), the peer-review step (stage 2), or the chairman's screen
 * (synthesis). At rest, nothing pulses.
 *
 * With `preview` fixtures (the /cc-preview harness) no network calls are made;
 * Convene replays the recorded session with staged timing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Orbit,
  ClipboardList,
  ScrollText,
  ShieldAlert,
  Inbox as InboxIcon,
  Crown,
  Sparkles,
  FileDown,
  RefreshCcw,
} from 'lucide-react';
import AgentPresence from './AgentPresence';
import CouncilTranscript from './CouncilTranscript';
import FindingsBoard from './FindingsBoard';
import AgentInbox from './AgentInbox';
import CouncilBrief from './CouncilBrief';
import AgentCall from './AgentCall';
import type {
  AgentKey,
  CouncilAgent,
  CouncilFinding,
  CouncilFixtures,
  CouncilInboxMessage,
  CouncilMessage,
  CouncilSession,
  FindingStatus,
  SessionStatus,
} from './fixtures';
import { COUNCIL_AGENTS } from './fixtures';

const EASE = [0.19, 1, 0.22, 1] as const;

export type CouncilPane = 'brief' | 'chamber' | 'transcript' | 'findings' | 'inbox';

const TERMINAL: SessionStatus[] = ['complete', 'failed'];

const STATUS_LABEL: Record<SessionStatus, string> = {
  running: 'Convening',
  stage1: 'Stage 1 · Opinions',
  stage2: 'Stage 2 · Peer review',
  synthesis: 'Stage 3 · Synthesis',
  complete: 'Complete',
  failed: 'Failed',
};

/* ------------------------------------------------------- api normalization */

function normalizeSession(raw: any): CouncilSession {
  return {
    id: String(raw?.id ?? ''),
    question: String(raw?.question ?? ''),
    status: (raw?.status ?? 'running') as SessionStatus,
    error: raw?.error ?? null,
    created_at: String(raw?.created_at ?? new Date().toISOString()),
    completed_at: raw?.completed_at ?? null,
  };
}

function normalizeFinding(raw: any): CouncilFinding {
  return {
    id: String(raw?.id ?? ''),
    session_id: String(raw?.session_id ?? ''),
    agent_key: (raw?.agent_key ?? 'ops') as AgentKey,
    severity: (raw?.severity ?? 'P2') as CouncilFinding['severity'],
    title: String(raw?.title ?? ''),
    detail: String(raw?.detail ?? ''),
    recommendation: String(raw?.recommendation ?? ''),
    status: (raw?.status ?? 'open') as FindingStatus,
    created_at: String(raw?.created_at ?? new Date().toISOString()),
  };
}

function normalizeMessage(raw: any, sessionFindings: CouncilFinding[]): CouncilMessage {
  const agentKey = (raw?.agent_key ?? 'ops') as CouncilMessage['agent_key'];
  const own: any[] = Array.isArray(raw?.findings) ? raw.findings : [];
  const attached =
    own.length > 0
      ? own.map(normalizeFinding)
      : raw?.stage === 'opinion'
        ? sessionFindings.filter((fd) => fd.agent_key === agentKey)
        : null;
  return {
    id: String(raw?.id ?? ''),
    session_id: String(raw?.session_id ?? ''),
    agent_key: agentKey,
    stage: (raw?.stage ?? 'opinion') as CouncilMessage['stage'],
    label: raw?.label ?? null,
    content: String(raw?.content ?? ''),
    findings: attached,
    ranked_labels: Array.isArray(raw?.ranked_labels) ? raw.ranked_labels : null,
    created_at: String(raw?.created_at ?? new Date().toISOString()),
  };
}

function normalizeInbox(raw: any): CouncilInboxMessage {
  return {
    id: String(raw?.id ?? ''),
    agent_key: (raw?.agent_key ?? 'ops') as AgentKey,
    direction: raw?.direction === 'out' ? 'out' : 'in',
    from_addr: String(raw?.from_addr ?? ''),
    to_addr: String(raw?.to_addr ?? ''),
    subject: String(raw?.subject ?? ''),
    body_html: String(raw?.body_html ?? ''),
    status: (raw?.status ?? 'received') as CouncilInboxMessage['status'],
    created_at: String(raw?.created_at ?? new Date().toISOString()),
  };
}

/* ------------------------------------------------------------------ chrome */

function StatusDot({ status }: { status: SessionStatus | 'idle' }) {
  const color =
    status === 'complete'
      ? 'var(--cc-green)'
      : status === 'failed'
        ? 'var(--cc-red)'
        : status === 'idle'
          ? 'var(--council-ink-4)'
          : 'var(--cc-amber)';
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)`,
        flex: 'none',
      }}
    />
  );
}

/* ================================================================== shell */

export default function CouncilChamber({
  preview,
  initialPane = 'brief',
}: {
  preview?: CouncilFixtures;
  initialPane?: CouncilPane;
}) {
  const isPreview = !!preview;
  const reduceMotion = useReducedMotion();

  const [pane, setPane] = useState<CouncilPane>(initialPane);
  const [agents, setAgents] = useState<CouncilAgent[]>(preview?.agents ?? COUNCIL_AGENTS);
  const [sessions, setSessions] = useState<CouncilSession[]>(preview?.sessions ?? []);
  const [session, setSession] = useState<CouncilSession | null>(preview?.session ?? null);
  const [messages, setMessages] = useState<CouncilMessage[]>(preview?.messages ?? []);
  const [findings, setFindings] = useState<CouncilFinding[]>(preview?.findings ?? []);
  const [inbox, setInbox] = useState<CouncilInboxMessage[]>(preview?.inbox ?? []);
  const [question, setQuestion] = useState('');
  const [convening, setConvening] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [inboxLoaded, setInboxLoaded] = useState(isPreview);
  /** The member currently on a 1:1 voice call, if any. */
  const [callAgent, setCallAgent] = useState<CouncilAgent | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => () => {
    clearTimers();
    stopPolling();
  }, []);

  /* ------------------------------------------------------------ live data */

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/council/agents');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const rows: any[] = Array.isArray(data) ? data : (data.agents ?? []);
      if (rows.length > 0) {
        setAgents(
          rows
            .filter((r) => r.is_active !== false)
            .map((r, i) => ({
              key: r.key as AgentKey,
              name: String(r.name),
              title: String(r.title),
              email: String(r.email),
              lens: String(r.lens ?? ''),
              color: String(r.color ?? COUNCIL_AGENTS[i % COUNCIL_AGENTS.length].color),
              sort: Number(r.sort ?? i),
            })),
        );
      }
      setFetchError(null);
    } catch {
      setFetchError('The council roster is unreachable — showing the seeded eight.');
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/council/sessions');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const rows: any[] = Array.isArray(data) ? data : (data.sessions ?? []);
      setSessions(rows.map(normalizeSession));
    } catch {
      /* session history is optional chrome */
    }
  }, []);

  const loadFindings = useCallback(async () => {
    try {
      const res = await fetch('/api/council/findings');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const rows: any[] = Array.isArray(data) ? data : (data.findings ?? []);
      setFindings(rows.map(normalizeFinding));
    } catch {
      /* board keeps its empty state */
    }
  }, []);

  const loadInbox = useCallback(async () => {
    const results = await Promise.all(
      COUNCIL_AGENTS.map(async (a) => {
        try {
          const res = await fetch(`/api/council/inbox?agent=${a.key}`);
          if (!res.ok) return [];
          const data = await res.json();
          const rows: any[] = Array.isArray(data) ? data : (data.messages ?? []);
          return rows.map(normalizeInbox);
        } catch {
          return [];
        }
      }),
    );
    setInbox(results.flat());
    setInboxLoaded(true);
  }, []);

  const applySessionDetail = useCallback((data: any) => {
    const s = normalizeSession(data.session ?? data);
    const frows: any[] = Array.isArray(data.findings) ? data.findings : [];
    const sessionFindings = frows.map(normalizeFinding);
    const mrows: any[] = Array.isArray(data.messages) ? data.messages : [];
    setSession(s);
    setMessages(mrows.map((m) => normalizeMessage(m, sessionFindings)));
    if (sessionFindings.length > 0) {
      // Fold this session's findings into the board without duplicates.
      setFindings((cur) => {
        const seen = new Set(cur.map((fd) => fd.id));
        return [...sessionFindings.filter((fd) => !seen.has(fd.id)), ...cur];
      });
    }
    return s;
  }, []);

  const loadSession = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/council/sessions/${id}`);
      if (!res.ok) throw new Error('session fetch failed');
      return applySessionDetail(await res.json());
    },
    [applySessionDetail],
  );

  useEffect(() => {
    if (isPreview) return;
    loadAgents();
    loadSessions();
    loadFindings();
  }, [isPreview, loadAgents, loadSessions, loadFindings]);

  useEffect(() => {
    if (!isPreview && pane === 'inbox' && !inboxLoaded) loadInbox();
  }, [isPreview, pane, inboxLoaded, loadInbox]);

  /* -------------------------------------------------------------- polling */

  useEffect(() => {
    if (isPreview || !session || TERMINAL.includes(session.status)) {
      stopPolling();
      return;
    }
    stopPolling();
    pollRef.current = setInterval(() => {
      loadSession(session.id).catch(() => {
        /* transient poll failure — the next tick retries */
      });
    }, 2000);
    return stopPolling;
  }, [isPreview, session?.id, session?.status, loadSession]);

  /* -------------------------------------------------------------- convene */

  const replayFixture = useCallback(
    (q: string) => {
      if (!preview) return;
      clearTimers();
      const later = (ms: number, fn: () => void) => {
        timers.current.push(setTimeout(fn, ms));
      };
      const opinions = preview.messages.filter((m) => m.stage === 'opinion');
      const reviews = preview.messages.filter((m) => m.stage === 'review');
      const synthesis = preview.messages.find((m) => m.stage === 'synthesis');

      const base: CouncilSession = {
        ...preview.session,
        question: q || preview.session.question,
        created_at: new Date().toISOString(),
        completed_at: null,
      };
      setMessages([]);
      setSession({ ...base, status: 'stage1' });

      opinions.forEach((op, i) => {
        later(650 * (i + 1), () => setMessages((cur) => [...cur, op]));
      });
      const t2 = 650 * (opinions.length + 1) + 400;
      later(t2, () => setSession((s) => (s ? { ...s, status: 'stage2' } : s)));
      reviews.forEach((rv, i) => {
        later(t2 + 420 * (i + 1), () => setMessages((cur) => [...cur, rv]));
      });
      const t3 = t2 + 420 * (reviews.length + 1) + 500;
      later(t3, () => setSession((s) => (s ? { ...s, status: 'synthesis' } : s)));
      later(t3 + 1400, () => {
        if (synthesis) setMessages((cur) => [...cur, synthesis]);
        setSession((s) =>
          s ? { ...s, status: 'complete', completed_at: new Date().toISOString() } : s,
        );
      });
    },
    [preview],
  );

  const convene = useCallback(async () => {
    const q = question.trim();
    setConvening(true);
    setFetchError(null);
    if (isPreview) {
      replayFixture(q);
      setConvening(false);
      return;
    }
    try {
      const res = await fetch('/api/council/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q || undefined }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const s = applySessionDetail(data.session ?? data);
      setSessions((cur) => [s, ...cur.filter((x) => x.id !== s.id)]);
      if (TERMINAL.includes(s.status)) await loadSession(s.id);
    } catch {
      setFetchError('The council could not be convened — check that the council API is reachable.');
    } finally {
      setConvening(false);
    }
  }, [isPreview, question, replayFixture, applySessionDetail, loadSession]);

  const openSession = useCallback(
    async (id: string) => {
      clearTimers();
      if (isPreview) {
        if (preview && id === preview.session.id) {
          setSession(preview.session);
          setMessages(preview.messages);
        } else {
          const s = preview?.sessions.find((x) => x.id === id) ?? null;
          setSession(s);
          setMessages([]);
        }
        return;
      }
      try {
        await loadSession(id);
      } catch {
        setFetchError('That session record could not be loaded.');
      }
    },
    [isPreview, preview, loadSession],
  );

  /* --------------------------------------------------------- live actions */

  const patchFinding = useCallback(
    async (id: string, status: FindingStatus) => {
      if (isPreview) return;
      const res = await fetch(`/api/council/findings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('patch failed');
    },
    [isPreview],
  );

  const composeInbox = useCallback(
    async (payload: { agent_key: AgentKey; to: string; subject: string; html: string; send: boolean }) => {
      if (isPreview) return;
      const res = await fetch('/api/council/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('compose failed');
    },
    [isPreview],
  );

  const writeToAgent = useCallback(
    async (payload: { agent_key: AgentKey; from: string; subject: string; text: string }) => {
      if (isPreview) return;
      const res = await fetch('/api/council/inbox/to-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('to-agent failed');
      // The agent's reply is generated server-side as a draft; refresh to show it.
      setTimeout(loadInbox, 2500);
    },
    [isPreview, loadInbox],
  );

  /* ------------------------------------------------------------ the pulse */

  const opinions = useMemo(() => messages.filter((m) => m.stage === 'opinion'), [messages]);
  const synthesis = useMemo(() => messages.find((m) => m.stage === 'synthesis') ?? null, [messages]);

  const pulseTarget = useMemo((): string | null => {
    if (!session) return null;
    if (session.status === 'running' || session.status === 'stage1') {
      const landed = new Set(opinions.map((o) => o.agent_key));
      const next = agents.find((a) => !landed.has(a.key));
      return next ? `agent:${next.key}` : null;
    }
    if (session.status === 'stage2') return 'review';
    if (session.status === 'synthesis') return 'chairman';
    return null;
  }, [session, opinions, agents]);

  const presenceState = (key: AgentKey): 'dim' | 'lit' | 'speaking' => {
    if (pulseTarget === `agent:${key}`) return 'speaking';
    return opinions.some((o) => o.agent_key === key) ? 'lit' : 'dim';
  };

  /* ------------------------------------------------------------- derived */

  const sevCounts = useMemo(() => {
    const c = { P0: 0, P1: 0, P2: 0 };
    for (const op of opinions) {
      for (const fd of op.findings ?? []) c[fd.severity] += 1;
    }
    return c;
  }, [opinions]);

  const auditTitle = useMemo(() => {
    if (!synthesis) return null;
    const first = synthesis.content.split('\n').find((l) => l.startsWith('# '));
    return first ? first.slice(2) : 'Council Audit';
  }, [synthesis]);

  const openFindings = useMemo(
    () => findings.filter((fd) => fd.status === 'open' || fd.status === 'acked').length,
    [findings],
  );

  const sessionLabel = session ? STATUS_LABEL[session.status] : 'Idle';
  const stageIndex = !session
    ? -1
    : session.status === 'running' || session.status === 'stage1'
      ? 0
      : session.status === 'stage2'
        ? 1
        : session.status === 'synthesis'
          ? 2
          : session.status === 'complete'
            ? 3
            : -1;

  /* ---------------------------------------------------------------- render */

  const paneBtn = (
    key: CouncilPane,
    label: string,
    icon: React.ReactNode,
    badge?: number,
  ) => (
    <button
      key={key}
      type="button"
      onClick={() => setPane(key)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 14px',
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: pane === key ? 700 : 600,
        color: pane === key ? 'var(--council-ink-1)' : 'var(--council-ink-2)',
        background: pane === key ? 'rgba(30, 42, 48, 0.10)' : 'transparent',
        boxShadow: pane === key ? 'inset 0 1px 0 rgba(30, 42, 48, 0.10)' : 'none',
        transition: 'all 300ms cubic-bezier(0.19, 1, 0.22, 1)',
      }}
    >
      {icon}
      {label}
      {typeof badge === 'number' && badge > 0 && <span className="cc-badge">{badge}</span>}
    </button>
  );

  return (
    <div className="council-page" style={{ flexDirection: 'column' }}>
      <div
        style={{
          width: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          padding: '26px 28px 56px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {/* ---------------------------------------------------------- header */}
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div className="council-eyebrow">Master admin · Playground</div>
            <h1
              style={{
                margin: '5px 0 0',
                fontFamily: 'var(--font-display)',
                fontSize: 28,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: 'var(--council-ink-1)',
                lineHeight: 1.15,
              }}
            >
              The Agent Council
            </h1>
            <p
              style={{
                margin: '5px 0 0',
                fontSize: 13,
                fontWeight: 500,
                lineHeight: 1.5,
                color: 'var(--council-ink-2)',
              }}
            >
              Eight lenses read the same data pack, rank each other, and the chairman writes the audit.
            </p>
          </div>

          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 13px',
                borderRadius: 999,
                border: '1px solid var(--council-hairline-strong)',
                background: 'var(--council-surface-1)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--council-ink-2)',
              }}
            >
              <StatusDot status={session ? session.status : 'idle'} />
              {isPreview ? `Fixture replay · ${sessionLabel}` : sessionLabel}
            </span>
            {!isPreview && session?.status === 'complete' && (
              <a
                href={`/api/council/export?session=${session.id}&format=xlsx`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  borderRadius: 999,
                  border: '1px solid var(--council-hairline-strong)',
                  background: 'transparent',
                  color: 'var(--council-ink-1)',
                  fontSize: 11.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                  transition: 'border-color 300ms cubic-bezier(0.19, 1, 0.22, 1)',
                }}
              >
                <FileDown size={12} /> Export audit (xlsx)
              </a>
            )}
          </div>
        </header>

        {/* ---------------------------------------------------------- subnav */}
        <nav
          style={{
            display: 'inline-flex',
            alignSelf: 'flex-start',
            gap: 3,
            padding: 4,
            borderRadius: 999,
            background: 'var(--council-surface-1)',
            WebkitBackdropFilter: 'blur(18px) saturate(140%)',
            backdropFilter: 'blur(18px) saturate(140%)',
            border: '1px solid var(--council-hairline)',
          }}
        >
          {paneBtn('brief', 'Brief', <ClipboardList size={12} />)}
          {paneBtn('chamber', 'Chamber', <Orbit size={12} />)}
          {paneBtn('transcript', 'Transcript', <ScrollText size={12} />)}
          {paneBtn('findings', 'Findings', <ShieldAlert size={12} />, openFindings)}
          {paneBtn('inbox', 'Inbox', <InboxIcon size={12} />)}
        </nav>

        {fetchError && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 1.5,
              color: 'var(--council-danger-ink)',
              background: 'color-mix(in srgb, var(--cc-red) 14%, transparent)',
              border: '1px solid color-mix(in srgb, var(--cc-red) 45%, transparent)',
              boxShadow: 'inset 3px 0 0 var(--cc-red)',
            }}
          >
            <ShieldAlert size={14} style={{ flex: 'none', color: 'var(--cc-red)' }} />
            {fetchError}
            <button
              type="button"
              onClick={() => {
                setFetchError(null);
                if (!isPreview) {
                  loadAgents();
                  loadSessions();
                  loadFindings();
                }
              }}
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 11px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.3)',
                background: 'transparent',
                color: 'var(--council-ink-1)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                flex: 'none',
              }}
            >
              <RefreshCcw size={11} /> Retry
            </button>
          </div>
        )}

        {/* -------------------------------------------------------- brief */}
        {pane === 'brief' && (
          <CouncilBrief
            findings={findings}
            agents={agents}
            sessionId={session?.id ?? null}
            previewAssignments={preview?.assignments}
          />
        )}

        {/* ------------------------------------------------------ chamber */}
        {pane === 'chamber' && (
          <>
            {/* convene bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 16,
                background: 'var(--council-surface-1)',
                WebkitBackdropFilter: 'blur(18px) saturate(140%)',
                backdropFilter: 'blur(18px) saturate(140%)',
                border: '1px solid rgba(30, 42, 48, 0.05)',
              }}
            >
              <span
                style={{
                  flex: 'none',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.13em',
                  textTransform: 'uppercase',
                  color: 'var(--council-ink-3)',
                  paddingLeft: 4,
                }}
              >
                Ask the council
              </span>
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !convening) convene();
                }}
                placeholder="e.g. Where are we bleeding this week — and what do we fix first?"
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  height: 38,
                  padding: '0 16px',
                  borderRadius: 999,
                  border: '1px solid rgba(30, 42, 48, 0.10)',
                  background: 'rgba(30, 42, 48, 0.05)',
                  color: 'var(--council-ink-1)',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'var(--font-body)',
                  outline: 'none',
                }}
              />
              <button type="button" className="cc-btn" disabled={convening} onClick={convene} style={{ height: 38, padding: '0 20px', fontSize: 12 }}>
                <Sparkles size={13} />
                {convening ? 'Convening…' : session ? 'Reconvene' : 'Convene'}
              </button>
            </div>

            {/* recent sessions */}
            {sessions.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.13em',
                    textTransform: 'uppercase',
                    color: 'var(--council-ink-3)',
                  }}
                >
                  Recent sessions
                </span>
                {sessions.slice(0, 4).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openSession(s.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      maxWidth: 320,
                      padding: '5px 12px',
                      borderRadius: 999,
                      cursor: 'pointer',
                      border: `1px solid ${session?.id === s.id ? 'rgba(255,255,255,0.35)' : 'rgba(30, 42, 48, 0.10)'}`,
                      background: session?.id === s.id ? 'rgba(30, 42, 48, 0.10)' : 'rgba(30, 42, 48, 0.05)',
                      color: 'var(--council-ink-2)',
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: 'var(--font-body)',
                      transition: 'all 300ms cubic-bezier(0.19, 1, 0.22, 1)',
                    }}
                  >
                    <StatusDot status={s.status} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.question || 'Weekly audit'}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* the chamber floor */}
            <div style={{ position: 'relative' }}>
              {/* floor halo */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  left: '6%',
                  right: '6%',
                  bottom: -30,
                  height: 190,
                  borderRadius: '50%',
                  border: '1px solid rgba(30, 42, 48, 0.05)',
                  background: 'radial-gradient(ellipse 55% 60% at 50% 45%, rgba(112,143,150,0.13), transparent 70%)',
                  transform: 'scaleY(0.5)',
                  transformOrigin: 'center',
                  pointerEvents: 'none',
                }}
              />

              {/* chairman screen */}
              <motion.div
                initial={false}
                animate={{ opacity: 1 }}
                style={{
                  position: 'relative',
                  maxWidth: 760,
                  margin: '0 auto 26px',
                  borderRadius: 16,
                  overflow: 'hidden',
                  // Light, elevated: the chairman's screen is the most important
                  // surface on the page, so it earns the top of the elevation
                  // ladder — not an inverted colour. The faint brand wash marks
                  // it as the synthesis without making it a dark island.
                  background:
                    'linear-gradient(180deg, #ffffff, color-mix(in srgb, var(--primary) 5%, #ffffff))',
                  border: `1px solid ${pulseTarget === 'chairman'
                    ? 'color-mix(in srgb, var(--primary) 45%, transparent)'
                    : 'var(--council-hairline)'}`,
                  boxShadow: 'var(--council-elev-4)',
                  transition: 'border-color 900ms cubic-bezier(0.19, 1, 0.22, 1)',
                }}
              >
                {/* synthesis pulse — only while the chairman writes */}
                {pulseTarget === 'chairman' && !reduceMotion && (
                  <motion.span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      inset: 0,
                      pointerEvents: 'none',
                      boxShadow: 'inset 0 0 60px rgba(112,143,150,0.25)',
                    }}
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                {/* screen top light */}
                <div
                  aria-hidden
                  style={{
                    height: 2,
                    background:
                      'linear-gradient(90deg, transparent, rgba(112,143,150,0.85) 30%, rgba(112,143,150,0.85) 70%, transparent)',
                  }}
                />

                <div style={{ padding: '18px 26px 20px', textAlign: 'center' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      textAlign: 'left',
                    }}
                  >
                    <Crown size={13} style={{ color: 'var(--council-ink-3)', flex: 'none' }} />
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.13em',
                        textTransform: 'uppercase',
                        color: 'var(--council-ink-3)',
                      }}
                    >
                      Chairman · Synthesis
                    </span>
                    <span
                      style={{
                        marginLeft: 'auto',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--council-ink-2)',
                      }}
                    >
                      <StatusDot status={session ? session.status : 'idle'} />
                      {sessionLabel}
                    </span>
                  </div>

                  {/* states */}
                  {!session && (
                    <div style={{ padding: '22px 0 18px' }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 19,
                          fontWeight: 600,
                          color: 'var(--council-ink-1)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        The chamber is quiet.
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--council-ink-2)', lineHeight: 1.55 }}>
                        Ask a question above and the eight will convene — opinions first,
                        then peer review, then the audit on this screen.
                      </div>
                    </div>
                  )}

                  {session && session.status !== 'complete' && session.status !== 'failed' && (
                    <div style={{ padding: '20px 0 16px' }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 17,
                          fontWeight: 600,
                          color: 'var(--council-ink-1)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {session.status === 'synthesis'
                          ? 'The chairman is writing the audit.'
                          : session.status === 'stage2'
                            ? 'Opinions are in — the council is ranking its own.'
                            : `Stage 1 — ${opinions.length} of ${agents.length} opinions landed.`}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: 'var(--council-ink-2)', fontStyle: 'italic' }}>
                        “{session.question}”
                      </div>
                      {/* stage stepper */}
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16 }}>
                        {['Opinions', 'Peer review', 'Synthesis', 'Audit'].map((label, i) => {
                          const active = i === stageIndex || (stageIndex === 3 && i === 3);
                          const done = stageIndex > i;
                          const isPulsingStep = pulseTarget === 'review' && i === 1;
                          return (
                            <span
                              key={label}
                              style={{
                                position: 'relative',
                                padding: '4px 12px',
                                borderRadius: 999,
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                color: active || done ? 'var(--council-ink-1)' : 'var(--council-ink-3)',
                                background: active ? 'rgba(112,143,150,0.3)' : done ? 'rgba(30, 42, 48, 0.10)' : 'rgba(30, 42, 48, 0.05)',
                                border: `1px solid ${active ? 'rgba(112,143,150,0.6)' : 'rgba(30, 42, 48, 0.05)'}`,
                              }}
                            >
                              {isPulsingStep && !reduceMotion && (
                                <motion.span
                                  aria-hidden
                                  style={{ position: 'absolute', inset: -1, borderRadius: 999, border: '1px solid rgba(112,143,150,0.9)' }}
                                  animate={{ opacity: [0.2, 1, 0.2] }}
                                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                                />
                              )}
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {session?.status === 'failed' && (
                    <div style={{ padding: '20px 0 16px' }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 17,
                          fontWeight: 600,
                          color: 'var(--council-danger-ink)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        The council adjourned in disagreement with the data.
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--council-ink-2)', lineHeight: 1.55 }}>
                        {session.error ?? 'The run failed before a synthesis could be written.'}
                      </div>
                    </div>
                  )}

                  {session?.status === 'complete' && (
                    <div style={{ padding: '16px 0 12px' }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 19,
                          fontWeight: 700,
                          color: 'var(--council-ink-1)',
                          letterSpacing: '-0.01em',
                          lineHeight: 1.3,
                        }}
                      >
                        {auditTitle ?? 'Council Audit'}
                      </div>
                      <div
                        style={{
                          marginTop: 10,
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        {(['P0', 'P1', 'P2'] as const).map((sev) => (
                          <span key={sev} className="council-sev" data-sev={sev}>
                            {sev === 'P0' && <ShieldAlert aria-hidden />}
                            {sev} · {sevCounts[sev]}
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => setPane('transcript')}
                          className="cc-btn"
                          style={{ marginLeft: 6 }}
                        >
                          <ScrollText size={11} /> Read the audit
                        </button>
                      </div>
                      <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5, color: 'var(--council-ink-2)', fontStyle: 'italic' }}>
                        “{session.question}”
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>

              {/* the eight presences */}
              <div
                style={{
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(252px, 1fr))',
                  gap: 14,
                }}
              >
                {agents.map((a) => (
                  <AgentPresence
                    key={a.key}
                    agent={a}
                    state={presenceState(a.key)}
                    label={opinions.find((o) => o.agent_key === a.key)?.label ?? null}
                    findingsCount={opinions.find((o) => o.agent_key === a.key)?.findings?.length}
                    onClick={() => setPane('inbox')}
                    onCall={isPreview ? undefined : () => setCallAgent(a)}
                  />
                ))}
              </div>
            </div>

            {/* transcript unfolds here */}
            {session && messages.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    margin: '6px 0 14px',
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.13em',
                      textTransform: 'uppercase',
                      color: 'var(--council-ink-3)',
                    }}
                  >
                    Transcript
                  </span>
                  <span style={{ flex: '1 1 auto', height: 1, background: 'rgba(30, 42, 48, 0.05)' }} />
                </div>
                <CouncilTranscript session={session} messages={messages} agents={agents} />
              </div>
            )}
            {session?.status === 'failed' && (
              <CouncilTranscript session={session} messages={messages} agents={agents} />
            )}
          </>
        )}

        {/* ---------------------------------------------------- transcript */}
        {pane === 'transcript' &&
          (session ? (
            <CouncilTranscript session={session} messages={messages} agents={agents} />
          ) : (
            <div
              style={{
                padding: '46px 20px',
                textAlign: 'center',
                borderRadius: 16,
                background: 'rgba(28, 36, 38, 0.45)',
                border: '1px solid rgba(30, 42, 48, 0.05)',
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--council-ink-1)' }}>
                No session on the record
              </div>
              <div style={{ marginTop: 7, fontSize: 12.5, lineHeight: 1.5, color: 'var(--council-ink-2)' }}>
                Convene the council from the chamber and the full three-stage transcript lands here.
              </div>
            </div>
          ))}

        {/* ------------------------------------------------------ findings */}
        {pane === 'findings' && (
          <FindingsBoard initialFindings={findings} agents={agents} onPatch={patchFinding} />
        )}

        {/* --------------------------------------------------------- inbox */}
        {pane === 'inbox' && (
          <AgentInbox
            agents={agents}
            initialMessages={inbox}
            onCompose={composeInbox}
            onToAgent={writeToAgent}
            onCall={isPreview ? undefined : (a) => setCallAgent(a)}
          />
        )}
      </div>

      {/* -------------------------------------------------- 1:1 voice call */}
      {callAgent && <AgentCall agent={callAgent} onClose={() => setCallAgent(null)} />}
    </div>
  );
}
