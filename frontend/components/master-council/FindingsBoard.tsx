'use client';

/**
 * FindingsBoard — the persistent cross-session findings list.
 *
 * Severity filter chips, ack / resolve / dismiss via onPatch (wired to
 * PATCH /api/council/findings/[id] by the chamber shell). Updates are
 * optimistic: the row flips immediately and reverts if the patch rejects.
 * Light .cc- glass over the dark chamber canvas.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Eye, Ban, RotateCcw, ClipboardList } from 'lucide-react';
import type { CouncilAgent, CouncilFinding, FindingStatus, Severity } from './fixtures';
import { agentByKey } from './fixtures';
import AgentAvatar from './AgentAvatar';
import { SeverityPill } from './CouncilTranscript';

const EASE = [0.19, 1, 0.22, 1] as const;

type SevFilter = 'all' | Severity;

const STATUS_META: Record<FindingStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: 'var(--cc-blue)' },
  acked: { label: 'Acked', color: 'var(--cc-amber)' },
  resolved: { label: 'Resolved', color: 'var(--cc-green)' },
  dismissed: { label: 'Dismissed', color: 'var(--cc-ink-3)' },
};

/** Lifecycle state — deliberately NOT on the severity form ladder: it is a
 *  different axis, so it stays a flat neutral pill with a coloured dot.
 *  (glass-ambient.md: one meaning per signal; binance: a semantic hue is a text
 *  colour or a small badge fill, never a second competing surface.) */
function StatusChip({ status }: { status: FindingStatus }) {
  const meta = STATUS_META[status];
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
        color: 'var(--cc-ink-2)',
        boxShadow: 'inset 0 0 0 1px var(--cc-hairline)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          flex: 'none',
          borderRadius: 999,
          background: meta.color,
        }}
      />
      {meta.label}
    </span>
  );
}

export default function FindingsBoard({
  initialFindings,
  agents,
  onPatch,
}: {
  initialFindings: CouncilFinding[];
  agents: CouncilAgent[];
  onPatch?: (id: string, status: FindingStatus) => Promise<void>;
}) {
  const [findings, setFindings] = useState<CouncilFinding[]>(initialFindings);
  const [filter, setFilter] = useState<SevFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Live mode: findings load after mount — adopt them when the prop changes.
  useEffect(() => {
    setFindings(initialFindings);
  }, [initialFindings]);

  const counts = useMemo(() => {
    const c: Record<SevFilter, number> = { all: findings.length, P0: 0, P1: 0, P2: 0 };
    for (const fd of findings) c[fd.severity] += 1;
    return c;
  }, [findings]);

  const visible = useMemo(() => {
    const list = filter === 'all' ? findings : findings.filter((fd) => fd.severity === filter);
    const rank: Record<Severity, number> = { P0: 0, P1: 1, P2: 2 };
    return [...list].sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [findings, filter]);

  const patch = async (id: string, status: FindingStatus) => {
    const prev = findings;
    setError(null);
    setBusy(id);
    setFindings((cur) => cur.map((fd) => (fd.id === id ? { ...fd, status } : fd)));
    try {
      await onPatch?.(id, status);
    } catch {
      setFindings(prev); // revert optimistic update
      setError('The update did not save — the finding was restored.');
    } finally {
      setBusy(null);
    }
  };

  const filterChip = (key: SevFilter, label: string) => {
    const active = filter === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setFilter(key)}
        className={key === 'all' ? undefined : 'council-sev'}
        data-sev={key === 'all' ? undefined : key}
        aria-pressed={active}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          border: 0,
          fontFamily: 'var(--font-body)',
          outline: active ? '2px solid var(--cc-ink)' : '2px solid transparent',
          outlineOffset: 1,
          opacity: active ? 1 : 0.62,
          ...(key === 'all'
            ? {
                padding: '3px 9px',
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: 'var(--cc-ink-2)',
                background: 'transparent',
                boxShadow: 'inset 0 0 0 1px var(--cc-hairline)',
              }
            : null),
          transition: 'opacity 300ms cubic-bezier(0.19, 1, 0.22, 1)',
        }}
      >
        {label}
        <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>{counts[key]}</span>
      </button>
    );
  };

  return (
    <div className="cc-card" style={{ padding: '16px 18px' }}>
      <div className="cc-card-head" style={{ marginBottom: 12 }}>
        <span className="cc-chip cc-chip--red">
          <ClipboardList />
        </span>
        <span className="cc-title">Findings board</span>
        <div className="cc-head-meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {filterChip('all', 'All')}
          {filterChip('P0', 'P0')}
          {filterChip('P1', 'P1')}
          {filterChip('P2', 'P2')}
        </div>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 10,
            padding: '9px 12px',
            borderRadius: 10,
            fontSize: 11.5,
            fontWeight: 600,
            lineHeight: 1.5,
            color: 'var(--council-p0-fill)',
            background: 'color-mix(in srgb, var(--error) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--error) 35%, transparent)',
          }}
        >
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div
          style={{
            padding: '34px 16px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--cc-ink)' }}>
            Nothing on the board
          </span>
          <span style={{ fontSize: 12, color: 'var(--cc-ink-2)', maxWidth: 360, lineHeight: 1.55 }}>
            {filter === 'all'
              ? 'Convene the council and its findings will persist here, across sessions.'
              : `No ${filter} findings yet. The council has been kind — or unobservant.`}
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <AnimatePresence initial={false}>
            {visible.map((fd) => {
              const agent = agentByKey(fd.agent_key);
              const acting = busy === fd.id;
              return (
                <motion.div
                  key={fd.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: fd.status === 'dismissed' || fd.status === 'resolved' ? 0.62 : 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6, ease: EASE }}
                  className={`council-frow${fd.severity === 'P0' ? ' council-row-p0' : ''}`}
                  style={
                    { '--council-agent': agent.color } as React.CSSProperties
                  }
                >
                  <AgentAvatar agent={agent} size={28} />

                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <SeverityPill sev={fd.severity} />
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--cc-ink)', lineHeight: 1.45 }}>
                        {fd.title}
                      </span>
                    </div>
                    <div className="council-read" style={{ marginTop: 4 }}>
                      {fd.detail}
                    </div>
                    <div className="council-read-cap" style={{ marginTop: 4 }}>
                      <span className="council-read-strong">Ask — </span>
                      {fd.recommendation}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 500,
                        lineHeight: 1.4,
                        color: 'var(--council-ink-cap)',
                        marginTop: 6,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {agent.name} · {new Date(fd.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>

                  <div
                    style={{
                      flex: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 6,
                      opacity: acting ? 0.5 : 1,
                      transition: 'opacity 300ms cubic-bezier(0.19, 1, 0.22, 1)',
                    }}
                  >
                    <StatusChip status={fd.status} />
                    <div style={{ display: 'flex', gap: 5 }}>
                      {fd.status === 'open' && (
                        <button type="button" className="cc-btn-ghost" style={{ padding: '5px 11px', fontSize: 11 }} disabled={acting} onClick={() => patch(fd.id, 'acked')}>
                          <Eye size={11} /> Ack
                        </button>
                      )}
                      {(fd.status === 'open' || fd.status === 'acked') && (
                        <>
                          <button type="button" className="cc-btn-ghost" style={{ padding: '5px 11px', fontSize: 11, color: 'color-mix(in srgb, var(--success) 62%, var(--cc-ink))', borderColor: 'color-mix(in srgb, var(--success) 40%, transparent)' }} disabled={acting} onClick={() => patch(fd.id, 'resolved')}>
                            <Check size={11} /> Resolve
                          </button>
                          <button type="button" className="cc-btn-ghost" style={{ padding: '5px 11px', fontSize: 11 }} disabled={acting} onClick={() => patch(fd.id, 'dismissed')}>
                            <Ban size={11} /> Dismiss
                          </button>
                        </>
                      )}
                      {(fd.status === 'resolved' || fd.status === 'dismissed') && (
                        <button type="button" className="cc-btn-ghost" style={{ padding: '5px 11px', fontSize: 11 }} disabled={acting} onClick={() => patch(fd.id, 'open')}>
                          <RotateCcw size={11} /> Reopen
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
