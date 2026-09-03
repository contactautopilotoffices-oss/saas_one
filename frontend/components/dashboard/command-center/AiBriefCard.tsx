'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import { useWidgetData, inr, relativeTime } from '@/frontend/lib/dashboard/useWidgetData';
import {
  aiBrief, CC_COLORS, activeTicketsOf, useCommandCenterOrgId,
  type CcTicketsSummary, type CcAopSummary, type CcMailboxSummary,
} from './mockData';
import SourceTag from './SourceTag';
import { CardSkeleton, CardEmpty, fetchErrorReason } from './CardStates';

/**
 * AI BRIEF — templated from live numbers, no model call.
 *
 * Sentence 1: the building carrying the heaviest load (most urgent open tickets, then
 *   most active) from /api/organizations/{orgId}/tickets-summary.
 * Sentence 2: pending purchase approvals from /api/procurement/mailbox/summary when that
 *   authenticated feed answers; otherwise the real ticket-validation backlog.
 * Sentence 3: budget position for the latest AOP month (/api/aop/summary) when that
 *   authenticated feed answers; otherwise the month's AOP sentence is omitted.
 *
 * Every figure is one the neighbouring cards already show — nothing is generated. The
 * card is Live when the tickets feed answers; it shows a skeleton while that feed is in
 * flight and an honest message if it errors — never a placeholder sentence.
 */

const P_STYLE: React.CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.55,
  fontWeight: 500,
  color: 'var(--cc-ink-2)',
  margin: 0,
};

const B = ({ color, children }: { color?: string; children: React.ReactNode }) => (
  <b style={{ color: color ?? 'var(--cc-ink)', fontWeight: 700 }}>{children}</b>
);

function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y || 2000, (m || 1) - 1).toLocaleString('en-IN', { month: 'long' });
}

export default function AiBriefCard() {
  const orgId = useCommandCenterOrgId();
  const ticketsQ = useWidgetData<CcTicketsSummary>(
    orgId ? `/api/organizations/${orgId}/tickets-summary?period=all` : null, 5 * 60_000);
  const aopQ = useWidgetData<CcAopSummary>(
    orgId ? `/api/aop/summary?org_id=${orgId}` : null, 5 * 60_000);
  const mailboxQ = useWidgetData<CcMailboxSummary>(
    orgId ? `/api/procurement/mailbox/summary?org_id=${orgId}&limit=10` : null, 5 * 60_000);

  const t = ticketsQ.data;
  const aop = aopQ.data?.provisioned ? aopQ.data : null;
  const mailbox = mailboxQ.data?.provisioned ? mailboxQ.data : null;

  // orgId resolves in an effect, so treat "scope not known yet" as loading rather than
  // letting the card flash an error for a fetch that was never started.
  const loading = !orgId || ticketsQ.loading;
  const live = !!t;

  let paragraphs: React.ReactNode[] | null = null;

  if (t) {
    paragraphs = [];

    // 1 — heaviest-loaded building (most urgent, then most active).
    const leader = [...(t.properties ?? [])].sort((a, b) =>
      b.urgent_open - a.urgent_open || activeTicketsOf(b) - activeTicketsOf(a))[0];
    if (leader) {
      const active = activeTicketsOf(leader);
      const rate = leader.total > 0 ? Math.round((leader.resolved / leader.total) * 100) : 100;
      paragraphs.push(
        <p key="p1" style={P_STYLE}>
          {leader.property_name} is carrying the heaviest load:{' '}
          <B color={leader.urgent_open > 0 ? CC_COLORS.red : undefined}>
            {leader.urgent_open} urgent
          </B>{' '}
          of {active} active tickets, with <B>{rate}%</B> of its {leader.total.toLocaleString('en-IN')} tickets resolved.
        </p>);
    }

    // 2 — purchase approvals when the mailbox feed answers; else validation backlog.
    if (mailbox?.totals) {
      const mt = mailbox.totals;
      paragraphs.push(
        <p key="p2" style={P_STYLE}>
          <B>{mt.unactioned_request} purchase requests</B> are waiting for action and{' '}
          <B>{mt.awaiting_reply} vendor threads</B> for a reply
          {mt.oldest_days > 0 ? <>; the oldest has waited <B color={CC_COLORS.amber}>{mt.oldest_days} days</B></> : null}.
        </p>);
    } else if (t.pending_validation > 0) {
      paragraphs.push(
        <p key="p2" style={P_STYLE}>
          <B color={CC_COLORS.amber}>{t.pending_validation} resolved tickets</B> are still
          awaiting validation across the portfolio.
        </p>);
    }

    // 3 — budget projection when the AOP feed answers.
    if (aop?.current) {
      const c = aop.current;
      const over = Math.max(0, -Number(c.saving || 0));
      paragraphs.push(
        <p key="p3" style={P_STYLE}>
          {monthLabel(c.month)} spend is at{' '}
          <B>{c.utilisation_pct != null ? `${c.utilisation_pct}%` : '—'} of budget</B>
          {over > 0 ? (
            <> — a projected <B color={CC_COLORS.red}>{inr(over, { compact: true })} overspend</B> if the trend holds.</>
          ) : (
            <> — currently <B color={CC_COLORS.green}>under plan</B>.</>
          )}
        </p>);
    }

    if (!paragraphs.length) paragraphs = null;
  }

  return (
    <section className="cc-card">
      <div className="cc-card-head">
        <span className="cc-chip cc-chip--purple">
          <Sparkles />
        </span>
        <span className="cc-title">AI Brief</span>
        <span className="cc-head-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {!loading && <SourceTag live={live} />}
          {live && ticketsQ.fetchedAt ? relativeTime(ticketsQ.fetchedAt) : null}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {loading ? (
          <CardSkeleton lines={4} />
        ) : !paragraphs ? (
          <CardEmpty
            reason={t ? 'Not enough signal across tickets, mailbox and budget to draft a brief yet.' : fetchErrorReason(ticketsQ.error)}
          />
        ) : (
          paragraphs
        )}
      </div>

      <button
        type="button"
        className="cc-btn"
        style={{ alignSelf: 'flex-start', marginTop: 12, opacity: 0.5, cursor: 'not-allowed' }}
        disabled
        title="No full AI Brief page exists yet"
      >
        {aiBrief.ctaLabel}
      </button>
    </section>
  );
}
