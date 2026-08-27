'use client';

/**
 * CouncilTranscript — the three-stage record of a council session.
 *
 * Stage 1: per-agent opinion cards (findings with P0/P1/P2 severity badges).
 * Stage 2: compact anonymized peer-review summary (Borda aggregate + reviewer
 * rationales). Stage 3: the chairman's Council Audit, markdown rendered with
 * the severity ladder — P0 sections get the critical treatment (red rim +
 * tint). Motion is the monopo patient curve; nothing here pulses — the
 * chamber owns the single pulse.
 *
 * Contains a deliberately small markdown renderer for the subset the chairman
 * produces (headings, bold/italic/code, lists, hr) — no new dependency.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Crown, ShieldAlert, MessagesSquare, Vote } from 'lucide-react';
import type { CouncilAgent, CouncilMessage, CouncilSession, Severity } from './fixtures';
import { agentByKey } from './fixtures';
import AgentAvatar from './AgentAvatar';

const EASE = [0.19, 1, 0.22, 1] as const;

/* ----------------------------------------------------------- severity pill */

/**
 * Severity is encoded by FORM first and colour second, so P0 is unmistakable in
 * a list of 24 and the ladder survives colour-blindness / peripheral vision.
 *   P0  filled + square (4px) + AlertTriangle glyph   (sentry: filled = strongest)
 *   P1  tinted + 1px rim + pill                       (outlined = downgraded)
 *   P2  ghost + hairline + pill                       (ghost = downgraded twice)
 * See app/globals.css `.council-sev` and research/glass-ambient.md §B1.
 */
export function SeverityPill({ sev, onDark }: { sev: Severity; onDark?: boolean }) {
  return (
    <span className="council-sev" data-sev={sev} data-on={onDark ? 'dark' : undefined}>
      {sev === 'P0' && <AlertTriangle aria-hidden />}
      {sev}
    </span>
  );
}

/* ------------------------------------------------------- markdown (subset) */

type MdBlock =
  | { type: 'h1' | 'h2' | 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'hr' };

function parseBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    if (line === '---') {
      flushList();
      blocks.push({ type: 'hr' });
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushList();
      blocks.push({ type: `h${h[1].length}` as 'h1' | 'h2' | 'h3', text: h[2] });
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    // Each line is its own paragraph — the chairman's format puts
    // Repro / Impact / Ask on separate lines by design.
    flushList();
    blocks.push({ type: 'p', text: line });
  }
  flushList();
  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+?\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      out.push(
        <strong key={k++} style={{ fontWeight: 700, color: 'var(--cc-ink)' }}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith('`')) {
      out.push(
        <code
          key={k++}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.86em',
            background: 'rgba(30, 42, 48, 0.07)',
            border: '1px solid rgba(30, 42, 48, 0.08)',
            borderRadius: 5,
            padding: '1px 5px',
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function MdBlockView({ block }: { block: MdBlock }) {
  switch (block.type) {
    case 'h1':
      return (
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 21,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'var(--cc-ink)',
            lineHeight: 1.25,
          }}
        >
          {renderInline(block.text)}
        </div>
      );
    case 'h2':
      return (
        <div
          style={{
            fontSize: 14.5,
            fontWeight: 800,
            letterSpacing: '0.01em',
            color: 'var(--cc-ink)',
            lineHeight: 1.35,
          }}
        >
          {renderInline(block.text)}
        </div>
      );
    case 'h3':
      return (
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cc-ink)', lineHeight: 1.45 }}>
          {renderInline(block.text)}
        </div>
      );
    case 'p':
      return (
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.62, color: 'var(--cc-ink-2)' }}>
          {renderInline(block.text)}
        </p>
      );
    case 'ul':
    case 'ol': {
      const List = block.type === 'ul' ? 'ul' : 'ol';
      return (
        <List
          style={{
            margin: 0,
            paddingLeft: block.type === 'ul' ? 16 : 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            fontSize: 13,
            lineHeight: 1.58,
            color: 'var(--cc-ink-2)',
          }}
        >
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </List>
      );
    }
    case 'hr':
      return <div style={{ height: 1, background: 'var(--cc-hairline)', margin: '4px 0' }} />;
  }
}

/** Group blocks under their `## ` section so P0 can take the critical treatment. */
function MdSections({ md }: { md: string }) {
  const blocks = parseBlocks(md);
  const sections: { heading: MdBlock | null; blocks: MdBlock[] }[] = [];
  let current: { heading: MdBlock | null; blocks: MdBlock[] } = { heading: null, blocks: [] };
  for (const b of blocks) {
    if (b.type === 'h2') {
      sections.push(current);
      current = { heading: b, blocks: [] };
    } else {
      current.blocks.push(b);
    }
  }
  sections.push(current);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {sections.map((sec, i) => {
        const isP0 = !!sec.heading && sec.heading.type === 'h2' && /^p0\b/i.test(sec.heading.text);
        const inner = (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sec.heading &&
              (isP0 && sec.heading.type === 'h2' ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    fontSize: 14.5,
                    fontWeight: 800,
                    letterSpacing: '0.01em',
                    color: 'var(--council-p0-fill)',
                    lineHeight: 1.35,
                  }}
                >
                  <AlertTriangle size={14} style={{ flex: 'none' }} aria-hidden />
                  {renderInline(sec.heading.text)}
                </div>
              ) : (
                <MdBlockView block={sec.heading} />
              ))}
            {sec.blocks.map((b, j) => (
              <MdBlockView key={j} block={b} />
            ))}
          </div>
        );
        if (!isP0) return <div key={i}>{inner}</div>;
        return (
          <div
            key={i}
            style={{
              borderLeft: '3px solid var(--council-p0-fill)',
              background: 'color-mix(in srgb, var(--error) 6%, transparent)',
              borderRadius: '0 12px 12px 0',
              padding: '14px 16px',
            }}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ stage header */

function StageHeader({
  icon,
  kicker,
  title,
  right,
}: {
  icon: React.ReactNode;
  kicker: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--council-ink-1)',
          background: 'rgba(30, 42, 48, 0.10)',
          border: '1px solid var(--council-hairline)',
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.13em',
            textTransform: 'uppercase',
            color: 'var(--council-ink-3)',
          }}
        >
          {kicker}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--council-ink-1)', letterSpacing: '-0.01em' }}>
          {title}
        </div>
      </div>
      {right && <div style={{ marginLeft: 'auto', flex: 'none' }}>{right}</div>}
    </div>
  );
}

/* -------------------------------------------------------------- transcript */

export default function CouncilTranscript({
  session,
  messages,
  agents,
}: {
  session: CouncilSession | null;
  messages: CouncilMessage[];
  agents: CouncilAgent[];
}) {
  const opinions = messages.filter((m) => m.stage === 'opinion');
  const reviews = messages.filter((m) => m.stage === 'review');
  const synthesis = messages.find((m) => m.stage === 'synthesis') ?? null;

  const labelToAgent = new Map<string, CouncilAgent>();
  for (const op of opinions) {
    if (op.label) labelToAgent.set(op.label, agentByKey(op.agent_key));
  }

  // Borda aggregate over the reviewers' top-3 ballots (3/2/1 points).
  const aggregate = new Map<string, number>();
  for (const rv of reviews) {
    (rv.ranked_labels ?? []).forEach((label, idx) => {
      aggregate.set(label, (aggregate.get(label) ?? 0) + (3 - idx));
    });
  }
  const leaderboard = [...aggregate.entries()].sort((a, b) => b[1] - a[1]);
  const maxScore = leaderboard[0]?.[1] ?? 1;

  if (session?.status === 'failed') {
    return (
      <div className="cc-card" style={{ borderLeft: '2px solid var(--cc-red)' }}>
        <div className="cc-card-head" style={{ marginBottom: 8 }}>
          <span className="cc-chip cc-chip--red">
            <ShieldAlert />
          </span>
          <span className="cc-title">The session failed</span>
        </div>
        <p className="council-read" style={{ margin: 0 }}>
          {session.error ?? 'The council adjourned without a synthesis.'}
        </p>
      </div>
    );
  }

  if (opinions.length === 0 && !synthesis) return null;

  const rise = {
    hidden: { opacity: 0, y: 16 },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.85, ease: EASE, delay: i * 0.12 },
    }),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* session record */}
      {session && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.5,
              fontStyle: 'italic',
              color: 'var(--council-ink-2)',
              minWidth: 0,
            }}
          >
            “{session.question}”
          </span>
          <span
            style={{
              marginLeft: 'auto',
              flex: 'none',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--council-ink-3)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {new Date(session.created_at).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {' · '}
            {opinions.length} opinions · {reviews.length} reviews ·{' '}
            {opinions.reduce((n, o) => n + (o.findings?.length ?? 0), 0)} findings
          </span>
        </div>
      )}

      {/* ------------------------------------------------------- stage 1 */}
      {opinions.length > 0 && (
        <motion.section
          custom={0}
          variants={rise}
          initial="hidden"
          animate="show"
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <StageHeader
            icon={<MessagesSquare size={13} />}
            kicker="Stage 1"
            title="Independent opinions"
            right={
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--council-ink-2)' }}>
                {opinions.length} of {agents.length} landed
              </span>
            }
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: 14,
            }}
          >
            {opinions.map((op) => {
              const agent = agentByKey(op.agent_key);
              return (
                <div
                  key={op.id}
                  className="cc-card"
                  style={
                    {
                      borderTop: `2px solid ${agent.color}`,
                      '--council-agent': agent.color,
                    } as React.CSSProperties
                  }
                >
                  <div className="cc-card-head" style={{ marginBottom: 10 }}>
                    <AgentAvatar agent={agent} size={30} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cc-ink)', lineHeight: 1.35 }}>
                        {agent.name}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.4, color: 'var(--council-ink-cap)' }}>
                        {agent.title}
                      </div>
                    </div>
                    {op.label && (
                      <span
                        className="cc-head-meta"
                        style={{
                          border: '1px solid var(--cc-hairline)',
                          borderRadius: 999,
                          padding: '2px 8px',
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: 'var(--council-ink-cap)',
                        }}
                      >
                        {op.label}
                      </span>
                    )}
                  </div>

                  <p
                    style={{
                      margin: 0,
                      fontSize: 12.5,
                      lineHeight: 1.62,
                      color: 'var(--cc-ink-2)',
                      fontStyle: 'italic',
                    }}
                  >
                    “{op.content}”
                  </p>

                  {op.findings && op.findings.length > 0 && (
                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 10,
                        borderTop: '1px solid var(--cc-hairline)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      {op.findings.map((fd) => (
                        <div
                          key={fd.id}
                          className={fd.severity === 'P0' ? 'council-row-p0' : undefined}
                          style={{
                            display: 'flex',
                            gap: 9,
                            alignItems: 'flex-start',
                            padding: fd.severity === 'P0' ? '9px 11px' : undefined,
                            borderRadius: fd.severity === 'P0' ? 8 : undefined,
                          }}
                        >
                          <SeverityPill sev={fd.severity} />
                          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                            <div
                              style={{ fontSize: 12, fontWeight: 700, color: 'var(--cc-ink)', lineHeight: 1.45 }}
                            >
                              {fd.title}
                            </div>
                            <div className="council-read" style={{ marginTop: 3 }}>
                              {fd.detail}
                            </div>
                            <div className="council-read-cap" style={{ marginTop: 4 }}>
                              <span className="council-read-strong">Ask — </span>
                              {fd.recommendation}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* ------------------------------------------------------- stage 2 */}
      {reviews.length > 0 && (
        <motion.section
          custom={1}
          variants={rise}
          initial="hidden"
          animate="show"
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <StageHeader
            icon={<Vote size={13} />}
            kicker="Stage 2"
            title="Anonymized peer review"
            right={
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--council-ink-2)' }}>
                top-3 ballots · 3 / 2 / 1 pts
              </span>
            }
          />
          <div className="cc-card" style={{ gap: 0 }}>
            {/* Aggregate leaderboard */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {leaderboard.map(([label, score]) => {
                const agent = labelToAgent.get(label);
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={
                        {
                          width: 66,
                          flex: 'none',
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          '--council-agent': agent?.color ?? 'var(--primary)',
                          color: 'var(--council-agent-ink)',
                        } as React.CSSProperties
                      }
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        flex: '1 1 auto',
                        height: 6,
                        borderRadius: 999,
                        background: 'rgba(30, 42, 48, 0.07)',
                        overflow: 'hidden',
                      }}
                    >
                      <motion.span
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.round((score / maxScore) * 100)}%` }}
                        transition={{ duration: 1.1, ease: EASE, delay: 0.3 }}
                        style={{
                          display: 'block',
                          height: '100%',
                          borderRadius: 999,
                          background: agent?.color ?? 'var(--cc-teal)',
                          opacity: 0.85,
                        }}
                      />
                    </span>
                    <span
                      style={{
                        width: 40,
                        flex: 'none',
                        textAlign: 'right',
                        fontSize: 12,
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--cc-ink)',
                      }}
                    >
                      {score} pt
                    </span>
                    <span
                      style={{
                        width: 116,
                        flex: 'none',
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--council-ink-cap)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {agent ? `${agent.name} · ${agent.title.split(' ')[0]}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Reviewer rationales */}
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: '1px solid var(--cc-hairline)',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '12px 24px',
              }}
            >
              {reviews.map((rv) => {
                const agent = agentByKey(rv.agent_key);
                return (
                  <div key={rv.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span
                      style={{
                        marginTop: 5,
                        width: 8,
                        height: 8,
                        flex: 'none',
                        borderRadius: 999,
                        background: agent.color,
                        boxShadow: `0 0 0 1px color-mix(in srgb, ${agent.color} 45%, transparent)`,
                      }}
                    />
                    <div style={{ minWidth: 0, fontSize: 11.5, lineHeight: 1.55, color: 'var(--cc-ink-2)' }}>
                      <span style={{ fontWeight: 700, color: 'var(--cc-ink)' }}>{agent.name}</span>
                      <span style={{ color: 'var(--council-ink-cap)', fontWeight: 600 }}>
                        {' '}
                        → {(rv.ranked_labels ?? []).join(' · ')} —{' '}
                      </span>
                      {rv.content}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.section>
      )}

      {/* ------------------------------------------------------- stage 3 */}
      {synthesis && (
        <motion.section
          custom={2}
          variants={rise}
          initial="hidden"
          animate="show"
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <StageHeader
            icon={<Crown size={13} />}
            kicker="Stage 3 · Chairman synthesis"
            title="The Council Audit"
          />
          <div className="cc-card" data-elev="4" style={{ padding: '20px 22px' }}>
            <MdSections md={synthesis.content} />
          </div>
        </motion.section>
      )}
    </div>
  );
}
