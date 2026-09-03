'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Zap,
  Gauge,
  Mail,
  Users,
  ShieldAlert,
  MoreVertical,
} from 'lucide-react';
import {
  priorityActionsMeta,
  useCommandCenterOrgId,
} from './mockData';
import { buildNavMap } from './navMap';
import type { TicketsRisk, MailboxStats, BudgetStats, QueryState } from './useCommandCenterData';
import SourceTag from './SourceTag';
import { useWidgetData } from '@/frontend/lib/dashboard/useWidgetData';
import type { ElecPacePayload } from './IntelligenceRow';
import { CardSkeleton, CardEmpty, fetchErrorReason } from './CardStates';

interface RosterCoveragePayload {
  provisioned: boolean;
  scheduled?: number;
  present?: number;
  late?: number;
  absent?: number;
  coverage_pct?: number | null;
  scheduled_tomorrow?: number;
  short_tomorrow?: number;
  worst_property?: { name: string; absent: number } | null;
}

/* Shared figure style (between .cc-metric and .cc-metric--sm per the mock). */
const figure: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: '-0.3px',
  lineHeight: 1.15,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--cc-ink)',
};

const statLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--cc-ink-3, #6b7c84)',
  lineHeight: 1.3,
};

/** Right-hand stat column, separated from the figure by a hairline. */
const statCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  paddingLeft: 14,
  borderLeft: '1px solid var(--cc-hairline)',
};

const statValue: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 17,
  fontWeight: 700,
  letterSpacing: '-0.3px',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--cc-ink)',
  lineHeight: 1.2,
};

function CardShell({
  chipClass,
  icon,
  title,
  children,
  footer,
  tag,
}: {
  chipClass: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  tag?: React.ReactNode;
}) {
  return (
    <div className="cc-card" style={{ padding: '14px 16px' }}>
      <div className="cc-card-head" style={{ marginBottom: 10, gap: 8 }}>
        <span className={`cc-chip ${chipClass}`}>{icon}</span>
        <span
          className="cc-title"
          style={{ letterSpacing: '0.06em', whiteSpace: 'nowrap', overflow: 'visible' }}
        >
          {title}
        </span>
        <span className="cc-head-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {tag}
          <MoreVertical size={14} strokeWidth={2} />
        </span>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          borderTop: '1px solid var(--cc-hairline)',
          marginTop: 12,
          paddingTop: 10,
        }}
      >
        {footer}
      </div>
    </div>
  );
}

function Donut({ pct }: { pct: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: 76, height: 76, flex: 'none' }}>
      <svg width={76} height={76} viewBox="0 0 76 76" aria-hidden>
        <circle
          cx={38}
          cy={38}
          r={r}
          fill="none"
          stroke="var(--cc-hairline)"
          strokeWidth={7}
        />
        <circle
          cx={38}
          cy={38}
          r={r}
          fill="none"
          stroke="var(--cc-amber)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${((pct / 100) * c).toFixed(1)} ${c.toFixed(1)}`}
          transform="rotate(-90 38 38)"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--cc-ink)',
            lineHeight: 1.1,
          }}
        >
          {pct}%
        </span>
        <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--cc-ink-3, #6b7c84)' }}>
          Utilized
        </span>
      </div>
    </div>
  );
}

/** Loading/error state for one fetch, threaded down so each card can pick its own view. */
export interface FetchState { loading: boolean; error: string | null }

export default function PriorityActions({
  tickets, ticketsState,
  mailbox, mailboxState,
  budget, aopState,
  orgId,
}: {
  tickets?: TicketsRisk | null;
  ticketsState?: FetchState;
  mailbox?: MailboxStats | null;
  mailboxState?: FetchState;
  budget?: BudgetStats | null;
  aopState?: FetchState;
  orgId?: string | null;
}) {
  const paceQ = useWidgetData<ElecPacePayload>(
    orgId ? `/api/electricity/pace?org_id=${orgId}` : null, 5 * 60_000);
  const rosterQ = useWidgetData<RosterCoveragePayload>(
    orgId ? `/api/organizations/${orgId}/roster-coverage` : null, 2 * 60_000);

  // CTA targets — org from the shell's data-org, property scope from the
  // header selector's ?propertyId= param (same source buildNavMap consumes).
  const resolvedOrgId = useCommandCenterOrgId() ?? orgId ?? null;
  const propertyId = useSearchParams().get('propertyId') ?? undefined;
  const links = resolvedOrgId ? buildNavMap(resolvedOrgId, propertyId).cardLinks : null;

  /* Electricity Alert — latest reading anomaly, else the largest month-on-month spike. */
  const pace = paceQ.data?.provisioned ? paceQ.data : null;
  const ea = (() => {
    if (!pace) {
      return {
        live: false,
        figure: '▲ 18%',
        figureColor: 'var(--cc-red)',
        sub: 'vs 30-day average',
        site: 'Whitefield Tower',
        started: 'Started 2:15 PM, Today',
        meter: null as string | null,
      };
    }
    const anomalies = [...(pace.data_quality?.anomalies ?? [])]
      .sort((a, b) => (b.reading_date || '').localeCompare(a.reading_date || ''));
    const latest = anomalies[0];
    if (latest) {
      const times = latest.times_typical != null ? `${Math.round(latest.times_typical)}×` : null;
      return {
        live: true,
        figure: times ? `▲ ${times}` : '▲ Spike',
        figureColor: 'var(--cc-red)',
        sub: 'vs typical for this meter',
        site: latest.property_name || 'Unknown site',
        started: `Logged ${latest.reading_date}`,
        meter: latest.meter_name,
      };
    }
    const top = [...(pace.properties ?? [])]
      .filter(p => p.delta_pct !== null)
      .sort((a, b) => (b.delta_pct ?? 0) - (a.delta_pct ?? 0))[0];
    const d = pace.delta_pct ?? null;
    if (d !== null) {
      const up = d > 0;
      return {
        live: true,
        figure: `${up ? '▲' : '▼'} ${Math.abs(d)}%`,
        figureColor: up ? 'var(--cc-red)' : 'var(--cc-green)',
        sub: 'vs same days last month',
        site: top?.name || 'All properties',
        started: pace.as_of ? `As of ${pace.as_of}` : '',
        meter: null as string | null,
      };
    }
    return {
      live: true,
      figure: '—',
      figureColor: 'var(--cc-ink)',
      sub: 'no anomalies detected',
      site: 'All properties',
      started: pace.as_of ? `As of ${pace.as_of}` : '',
      meter: null as string | null,
    };
  })();

  /* Workforce Coverage — roster vs check-ins. */
  const roster = rosterQ.data?.provisioned ? rosterQ.data : null;
  const wc = roster ? {
    live: true,
    coverage: roster.coverage_pct != null ? `${Math.round(roster.coverage_pct)}%` : '—',
    late: roster.late,
    absent: roster.absent,
    site: roster.worst_property?.name ?? null,
    footerSub: (roster.short_tomorrow ?? 0) > 0
      ? `${roster.short_tomorrow} short tomorrow vs today`
      : `Fully rostered tomorrow (${roster.scheduled_tomorrow ?? 0})`,
  } : null;

  const tk = tickets ? {
    atRisk: tickets.atRisk,
    breached: tickets.breached,
    withinSla: tickets.withinSla,
  } : null;

  const mb = mailbox ? {
    total: mailbox.total,
    needAction: mailbox.needAction,
    waitingVendors: mailbox.waitingVendors,
    oldestDays: mailbox.oldestDays,
  } : null;
  // No mock fallback: a null here makes the card render its empty state rather than a
  // plausible-looking invention. Forecast has no source at all, so it is always null.
  const bh = budget ? {
    utilizedPct: budget.utilizedPct,
    forecastPct: null as number | null,
    overspendRisk: budget.overspendRisk,
  } : null;
  return (
    <section>
      {/* Row label. The band head above already names the horizon ("Ball by ball"); this
          names the row inside it and carries the open count. Ink tokens, not white: the
          host renders this board on a white <main>, not the dark .cc-canvas shell, and the
          band head owns the top spacing so this header adds none of its own. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          margin: '0 2px 10px',
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--cc-ink-2)',
          }}
        >
          {priorityActionsMeta.label}
        </span>
        <span className="cc-badge">{priorityActionsMeta.count}</span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 'var(--cc-gap, 16px)',
        }}
      >
        {/* 1 — Electricity Alert */}
        <CardShell
          chipClass="cc-chip--red"
          icon={<Zap />}
          title="Electricity Alert"
          tag={<SourceTag live={ea.live} />}
          footer={
            <>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cc-ink)' }}>
                {ea.site}
              </span>
              {links ? (
                <Link href={links.investigate} className="cc-btn" style={{ whiteSpace: 'nowrap' }}>Investigate</Link>
              ) : (
                <button type="button" className="cc-btn" style={{ whiteSpace: 'nowrap' }}>Investigate</button>
              )}
            </>
          }
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ ...figure, color: ea.figureColor }}>{ea.figure}</div>
              <div className="cc-sub">{ea.sub}</div>
            </div>
            {ea.live && ea.meter
              ? <div style={{ ...statLabel, maxWidth: 92, textAlign: 'right' }}>{ea.meter}</div>
              : null}
          </div>
          <div className="cc-sub" style={{ marginTop: 8, color: 'var(--cc-ink-3, #6b7c84)' }}>
            {ea.started}
          </div>
        </CardShell>

        {/* 2 — Budget Health */}
        <CardShell
          chipClass="cc-chip--amber"
          icon={<Gauge />}
          title="Budget Health"
          tag={<SourceTag live={!!budget} />}
          footer={
            links ? (
              <Link href={links.viewBudget} className="cc-btn" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                View Budget
              </Link>
            ) : (
              <button type="button" className="cc-btn" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                View Budget
              </button>
            )
          }
        >
          {aopState?.loading ? (
            <CardSkeleton lines={2} />
          ) : !bh ? (
            <CardEmpty reason={
              aopState?.error ? fetchErrorReason(aopState.error)
                : 'No operating plan imported yet.'} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Donut pct={bh.utilizedPct} />
              <div style={statCol}>
                <div>
                  <div style={statLabel}>Overspend risk</div>
                  <div style={{ ...statValue, color: 'var(--cc-red)' }}>
                    {bh.overspendRisk}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardShell>

        {/* 3 — Purchase Mailbox */}
        <CardShell
          chipClass="cc-chip--amber"
          icon={<Mail />}
          title="Purchase Mailbox"
          tag={<SourceTag live={!!mailbox} />}
          footer={
            <>
              <div>
                <div style={statLabel}>Oldest unresolved</div>
                <div style={{ ...statValue, color: 'var(--cc-red)' }}>
                  {mb ? `${mb.oldestDays} days` : '—'}
                </div>
              </div>
              <button
                type="button"
                className="cc-btn"
                style={{ whiteSpace: 'nowrap', opacity: 0.5, cursor: 'not-allowed' }}
                disabled
                title="No mailbox page exists yet — the purchase mailbox is API/digest only"
              >
                Open Mailbox
              </button>
            </>
          }
        >
          {mailboxState?.loading ? (
            <CardSkeleton lines={2} />
          ) : !mb ? (
            <CardEmpty reason={mailboxState?.error ? fetchErrorReason(mailboxState.error) : 'Mailbox digest not provisioned.'} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={figure}>{mb.total}</div>
                <div className="cc-sub">Total emails</div>
              </div>
              <div style={{ ...statCol }}>
                <div>
                  <div style={statLabel}>Need action</div>
                  <div style={{ ...statValue, color: 'var(--cc-red)' }}>{mb.needAction}</div>
                </div>
                <div>
                  <div style={statLabel}>Waiting vendors</div>
                  <div style={statValue}>{mb.waitingVendors}</div>
                </div>
              </div>
            </div>
          )}
        </CardShell>

        {/* 4 — Workforce Coverage */}
        <CardShell
          chipClass="cc-chip--purple"
          icon={<Users />}
          title="Workforce Coverage"
          tag={<SourceTag live={!!wc} />}
          footer={
            <>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cc-ink)' }}>
                  {wc?.site ?? '—'}
                </div>
                <div style={{ ...statLabel, fontSize: 10 }}>
                  {wc?.footerSub ?? 'No roster data'}
                </div>
              </div>
              {links ? (
                <Link href={links.viewRoster} className="cc-btn" style={{ whiteSpace: 'nowrap' }}>View Roster</Link>
              ) : (
                <button type="button" className="cc-btn" style={{ whiteSpace: 'nowrap' }}>View Roster</button>
              )}
            </>
          }
        >
          {rosterQ?.loading ? (
            <CardSkeleton lines={2} />
          ) : !wc ? (
            <CardEmpty reason={rosterQ?.error ? fetchErrorReason(rosterQ.error) : 'Roster coverage not available.'} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={figure}>{wc.coverage}</div>
                <div className="cc-sub">Today&apos;s coverage</div>
              </div>
              <div style={statCol}>
                <div>
                  <div style={statLabel}>Late</div>
                  <div style={statValue}>{wc.late}</div>
                </div>
                <div>
                  <div style={statLabel}>Absent</div>
                  <div style={{ ...statValue, color: 'var(--cc-red)' }}>{wc.absent}</div>
                </div>
              </div>
            </div>
          )}
        </CardShell>

        {/* 5 — Tickets at Risk */}
        <CardShell
          chipClass="cc-chip--red"
          icon={<ShieldAlert />}
          title="Tickets at Risk"
          tag={<SourceTag live={!!tickets} />}
          footer={
            links ? (
              <Link href={links.viewAllTickets} className="cc-btn" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                View All Tickets
              </Link>
            ) : (
              <button type="button" className="cc-btn" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                View All Tickets
              </button>
            )
          }
        >
          {ticketsState?.loading ? (
            <CardSkeleton lines={2} />
          ) : !tk ? (
            <CardEmpty reason={ticketsState?.error ? fetchErrorReason(ticketsState.error) : 'Ticket summary unavailable.'} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={figure}>{tk.atRisk}</div>
                <div className="cc-sub">At risk of breach</div>
              </div>
              <div style={statCol}>
                <div>
                  <div style={statLabel}>Breached</div>
                  <div style={{ ...statValue, color: 'var(--cc-red)' }}>{tk.breached}</div>
                </div>
                <div>
                  <div style={statLabel}>Within SLA</div>
                  <div style={statValue}>{tk.withinSla}</div>
                </div>
              </div>
            </div>
          )}
        </CardShell>
      </div>
    </section>
  );
}
