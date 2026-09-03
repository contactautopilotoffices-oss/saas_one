'use client';

import React from 'react';
import { Heart, AlertTriangle, OctagonAlert, Gem, Home } from 'lucide-react';
import { useWidgetData, inr } from '@/frontend/lib/dashboard/useWidgetData';
import {
  CC_COLORS, activeTicketsOf, siteScore, useCommandCenterOrgId,
  type HealthStat, type CcTicketsSummary, type CcAopSummary,
} from './mockData';
import SourceTag from './SourceTag';
import { CardSkeleton, CardEmpty, fetchErrorReason } from './CardStates';

/**
 * OPERATIONS HEALTH SCORE — the formula, honestly.
 *
 *   score = weighted mean of the components below, over the components whose source
 *           actually returned data (weights renormalize when a feed is missing).
 *
 *   input                     weight   source
 *   SLA health                40       /api/organizations/{orgId}/tickets-summary?period=all
 *        = 100 * (1 - sla_breached / active tickets)
 *   Resolution health         30       same endpoint
 *        = 100 * resolved / total tickets
 *   Urgency health            30       same endpoint
 *        = max(0, 100 - 2 * urgent_open)
 *   Budget health             20       /api/aop/summary (authenticated; dropped when 401)
 *        = 100 - max(0, utilisation_pct - 100)  (only overspend costs points)
 *
 * TREND: no historical score exists anywhere in this schema, so a 0-100 area chart is NOT
 * drawn — the card shows today's component breakdown bars instead. The stat strip reads:
 * buildings with per-site score < 85 (tickets-summary per-property rollups), urgent open
 * tickets, AOP overspend for the latest month (or '—'), and buildings with zero urgent
 * tickets.
 *
 * States: skeleton while the tickets feed is in flight; an honest message if it errors or
 * the caller isn't permitted to see it; the breakdown above once it answers. AOP is a
 * secondary input — its absence only drops the Budget adherence component and zeroes the
 * exposure stat, it never blocks the card.
 */

const STAT_ICONS = {
  alert: AlertTriangle,
  issues: OctagonAlert,
  exposure: Gem,
  updates: Home,
} as const;

const TONE_COLOR: Record<string, string | undefined> = {
  red: CC_COLORS.red,
  amber: CC_COLORS.amber,
  green: CC_COLORS.green,
  teal: CC_COLORS.teal,
  neutral: undefined,
};

interface Component {
  label: string;
  /** 0-100, higher is healthier. */
  value: number;
  weight: number;
}

export default function HealthScoreCard() {
  const orgId = useCommandCenterOrgId();
  const ticketsQ = useWidgetData<CcTicketsSummary>(
    orgId ? `/api/organizations/${orgId}/tickets-summary?period=all` : null, 5 * 60_000);
  const aopQ = useWidgetData<CcAopSummary>(
    orgId ? `/api/aop/summary?org_id=${orgId}` : null, 5 * 60_000);

  const t = ticketsQ.data;
  const aop = aopQ.data?.provisioned ? aopQ.data : null;
  // orgId resolves in an effect, so treat "scope not known yet" as loading rather than
  // letting the card flash an error for a fetch that was never started.
  const loading = !orgId || ticketsQ.loading;
  const live = !!t;

  let score = 0;
  let caption = '';
  let stats: HealthStat[] = [];
  let components: Component[] = [];

  if (t) {
    const active = Math.max(1, t.open_tickets + t.in_progress + t.pending_validation);
    components = [
      { label: 'SLA health', value: Math.max(0, 100 * (1 - t.sla_breached / active)), weight: 40 },
      { label: 'Resolution rate', value: t.total_tickets > 0 ? (100 * t.resolved) / t.total_tickets : 100, weight: 30 },
      { label: 'Urgency', value: Math.max(0, 100 - 2 * t.urgent_open), weight: 30 },
    ];
    const util = aop?.current?.utilisation_pct;
    if (util != null) {
      components.push({ label: 'Budget adherence', value: Math.max(0, 100 - Math.max(0, util - 100)), weight: 20 });
    }

    const wSum = components.reduce((s, c) => s + c.weight, 0);
    score = Math.round(components.reduce((s, c) => s + c.value * c.weight, 0) / wSum);

    const siteScores = (t.properties ?? []).map(siteScore);
    const needAttention = siteScores.filter(s => s < 85).length;
    const healthy = siteScores.filter(s => s >= 95).length;
    const exposure = aop?.current ? Math.max(0, -Number(aop.current.saving || 0)) : null;

    caption = needAttention === 0
      ? 'All buildings are within tolerance'
      : `${needAttention} of ${siteScores.length} buildings need attention`;

    stats = [
      { value: String(needAttention), label: 'Buildings need attention', tone: 'red', icon: 'alert' },
      { value: String(t.urgent_open), label: 'Urgent open tickets', tone: 'neutral', icon: 'issues' },
      {
        value: exposure === null ? '—' : inr(exposure, { compact: true }),
        label: 'Est. financial exposure', tone: 'teal', icon: 'exposure',
      },
      { value: String(healthy), label: 'Healthy buildings', tone: 'green', icon: 'updates' },
    ];
  }

  return (
    <section className="cc-card">
      <div className="cc-card-head">
        <span className="cc-chip cc-chip--green">
          <Heart />
        </span>
        <span className="cc-title">Operations Health Score</span>
        <span className="cc-head-meta">
          {!loading && <SourceTag live={live} />}
        </span>
      </div>

      {loading ? (
        <CardSkeleton hero lines={4} />
      ) : !t ? (
        <CardEmpty reason={fetchErrorReason(ticketsQ.error)} />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            {/* Metric column */}
            <div style={{ flex: 'none', paddingTop: 2 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="cc-metric cc-metric--lg">
                  {score}
                  <small>/100</small>
                </span>
              </div>
              <div className="cc-sub" style={{ marginTop: 8 }}>
                {caption}
              </div>
              <div className="cc-sub" style={{ marginTop: 4, fontSize: 10, color: 'var(--cc-ink-3)' }}>
                No historical score data — showing today&apos;s component breakdown.
              </div>
            </div>

            {/* Component breakdown bars (higher = healthier). */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 4 }}>
                {components.map(c => (
                  <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 96, fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.label}
                    </span>
                    <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(30,42,48,0.06)', overflow: 'hidden' }}>
                      <span
                        style={{
                          display: 'block',
                          height: '100%',
                          width: `${Math.max(0, Math.min(100, c.value))}%`,
                          borderRadius: 3,
                          background: c.value >= 85 ? CC_COLORS.green : c.value >= 60 ? CC_COLORS.amber : CC_COLORS.red,
                        }}
                      />
                    </span>
                    <span style={{ width: 48, textAlign: 'right', fontSize: 10, fontWeight: 600, color: 'var(--cc-ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(c.value)} · w{c.weight}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="cc-statstrip" style={{ marginTop: 14 }}>
            {stats.map((s: HealthStat) => {
              const Icon = STAT_ICONS[s.icon];
              const color = TONE_COLOR[s.tone];
              return (
                <div key={s.label} className={`cc-stat${s.tone !== 'neutral' ? ` cc-stat--${s.tone}` : ''}`}>
                  <span className="cc-stat-val" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Icon size={12} strokeWidth={2.2} style={{ color }} />
                    {s.value}
                  </span>
                  <span className="cc-stat-label">{s.label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
