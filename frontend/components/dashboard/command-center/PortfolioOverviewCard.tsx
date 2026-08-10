'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { useWidgetData } from '@/frontend/lib/dashboard/useWidgetData';
import {
  smoothPath, toPoints, CC_COLORS, siteScore, activeTicketsOf,
  useCommandCenterOrgId, type BuildingRow, type CcTicketsSummary,
} from './mockData';
import { buildNavMap } from './navMap';
import SourceTag from './SourceTag';
import { CardSkeleton, CardEmpty, fetchErrorReason } from './CardStates';

const SPARK_W = 64;
const SPARK_H = 22;

/** Map a health score onto the red/amber/green dot. */
function statusOf(score: number): BuildingRow['status'] {
  if (score >= 95) return 'green';
  if (score >= 85) return 'amber';
  return 'red';
}

function MiniSpark({ row }: { row: BuildingRow }) {
  const color = CC_COLORS[row.status];
  if (row.trend.length < 2) return null;
  const pts = toPoints(row.trend, SPARK_W, SPARK_H, 2);
  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width={SPARK_W} height={SPARK_H} aria-hidden>
      <path
        d={smoothPath(pts)}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r={2}
        fill={color}
      />
    </svg>
  );
}

/**
 * Portfolio Overview — LIVE.
 *
 * Source: /api/organizations/{orgId}/tickets-summary?period=all — the real property list
 * with per-property ticket rollups and 30-day daily trends.
 *
 * SCORE PER SITE (see siteScore in mockData.ts): the site's ticket resolution rate
 * (resolved / total, as a percentage), minus 5 points per URGENT open ticket, clamped to
 * 0-100. >=95 green, 85-94 amber, below 85 red. The sparkline is the site's daily ACTIVE
 * ticket count over the last 7 days (trends.active) — real backlog, not decoration.
 * Worst-scoring sites first.
 *
 * Skeleton while the fetch is in flight; an honest message if it errors or the org simply
 * has no properties yet — never the row list below with invented figures.
 */
export default function PortfolioOverviewCard() {
  const orgId = useCommandCenterOrgId();
  const propertyId = useSearchParams().get('propertyId') ?? undefined;
  const q = useWidgetData<CcTicketsSummary>(
    orgId ? `/api/organizations/${orgId}/tickets-summary?period=all` : null, 5 * 60_000);

  const loading = q.loading;
  const live = !!q.data?.properties?.length;

  const rows: BuildingRow[] = live
    ? q.data!.properties
        .map((p) => ({
          name: p.property_name,
          city: `${activeTicketsOf(p)} active · ${p.urgent_open} urgent`,
          score: siteScore(p),
          status: statusOf(siteScore(p)),
          trend: (p.trends?.active ?? []).slice(-7),
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 5)
    : [];

  return (
    <section className="cc-card">
      <div className="cc-card-head" style={{ marginBottom: 4 }}>
        <span className="cc-chip cc-chip--teal">
          <Building2 />
        </span>
        <span className="cc-title">Portfolio Overview</span>
        <span className="cc-head-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {!loading && <SourceTag live={live} />}
          {orgId ? (
            <Link href={buildNavMap(orgId, propertyId).cardLinks.viewAllBuildings}>View All Buildings</Link>
          ) : (
            <a href="#" onClick={(e) => e.preventDefault()}>View All Buildings</a>
          )}
        </span>
      </div>

      {loading ? (
        <CardSkeleton rows={5} />
      ) : !live ? (
        <CardEmpty reason={q.data ? 'No properties with ticket data in this organisation yet.' : fetchErrorReason(q.error)} />
      ) : (
        <>
          <div>
            {rows.map((b) => (
              <div key={b.name} className="cc-listrow">
                <span className={`cc-dot cc-dot--${b.status}`} />
                <div className="cc-listrow-main">
                  <div className="cc-listrow-name">{b.name}</div>
                  <div className="cc-listrow-sub">{b.city}</div>
                </div>
                <div className="cc-listrow-right">
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 14,
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      color: CC_COLORS[b.status],
                    }}
                  >
                    {b.score}
                  </span>
                  <MiniSpark row={b} />
                </div>
              </div>
            ))}
          </div>
          <div className="cc-sub" style={{ marginTop: 6 }}>
            Score = resolution rate − 5 pts per urgent ticket. Sparkline: active tickets, last 7 days.
          </div>
        </>
      )}
    </section>
  );
}
