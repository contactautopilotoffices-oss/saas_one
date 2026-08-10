'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Wallet, Fuel, Mail } from 'lucide-react';
import { useWidgetData, inr } from '@/frontend/lib/dashboard/useWidgetData';
import {
  useCommandCenterOrgId, type CcAopSummary, type CcDieselSummary, type CcGenerator,
} from './mockData';
import { buildNavMap } from './navMap';
import { BUDGET, DG, MAIL_DIGEST } from './mockData-intel';
import SourceTag from './SourceTag';
import type { MailRow, BudgetStats } from './useCommandCenterData';

/**
 * BOTTOM ROW — data sources.
 *
 * Budget vs Actual: LIVE actuals + budget from /api/aop/trend (pan-India ops cost, per
 * month; authenticated — the mock series renders, tagged Demo, when it 401s). The amber
 * FORECAST extension is NOT real — no forecasting model exists — so it is drawn dashed
 * and labeled demo. Month Progress is the real calendar progress of the current month;
 * Forecast Utilization and Projected Overspend come from /api/aop/summary.
 *
 * DG Monitoring: LIVE from the legacy org-scoped rollups
 * /api/organizations/{orgId}/generators + /diesel-summary?period=month. NOTE: "Running /
 * Standby / Fault" are the asset register's LIFECYCLE statuses (active / standby /
 * maintenance) — there is no live telemetry on the gensets.
 *
 * Mail Digest: LIVE via the mailbox summary rows passed down from useCommandCenterData.
 */

/* ---------- Budget line chart (actual solid, budget dashed, forecast dashed amber) ---------- */

interface ChartModel {
  labels: string[];
  /** normalized 0–100, y up */
  actual: number[];
  budget: number[];
  /** forecast tail: first point duplicates the last actual so the dashed line connects */
  forecast: number[];
  yLabels: string[];
}

function modelFromMock(): ChartModel {
  return {
    labels: BUDGET.dates,
    actual: BUDGET.actual,
    budget: BUDGET.budget,
    forecast: BUDGET.forecast,
    yLabels: BUDGET.yLabels,
  };
}

interface TrendPoint { month: string; budget: number; actual: number }
interface TrendPayload { provisioned: boolean; points: TrendPoint[] }

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function modelFromTrend(points: TrendPoint[]): ChartModel | null {
  const withData = points.filter(p => p.budget > 0 || p.actual > 0);
  if (withData.length < 2) return null;

  const maxV = Math.max(...withData.flatMap(p => [p.budget, p.actual])) || 1;
  const norm = (v: number) => (v / maxV) * 100;
  const actual = withData.map(p => norm(p.actual));
  const budget = withData.map(p => norm(p.budget));

  // Forecast placeholder: next month at the average utilisation of the actuals so far.
  // Purely illustrative — always rendered dashed.
  const utils = withData.map(p => (p.budget > 0 ? p.actual / p.budget : 1));
  const avgUtil = utils.reduce((a, b) => a + b, 0) / utils.length;
  const lastBudget = withData[withData.length - 1].budget || maxV;
  const forecast = [actual[actual.length - 1], norm(lastBudget * avgUtil)];

  const labels = [
    ...withData.map(p => MONTH_SHORT[Number(p.month.slice(5, 7)) - 1] || p.month),
    'Next',
  ];
  const yLabels = [1, 0.75, 0.5, 0.25, 0].map(f =>
    f === 0 ? '₹0' : inr(maxV * f, { compact: true }));

  return { labels, actual, budget, forecast, yLabels };
}

function BudgetChart({ model }: { model: ChartModel }) {
  const W = 400;
  const H = 130;
  const PAD_L = 34;
  const PAD_B = 16;
  const PAD_R = 16;
  const iw = W - PAD_L - PAD_R;
  const ih = H - PAD_B - 8;
  const y = (v: number) => 8 + ih - (v / 100) * ih;

  const total = model.labels.length;
  const pt = (i: number, v: number) => [PAD_L + (i / (total - 1)) * iw, y(v)] as const;
  const actual = model.actual.map((v, i) => pt(i, v));
  const budget = model.budget.map((v, i) => pt(i, v));
  const forecastStart = model.actual.length - 1;
  const forecast = model.forecast.map((v, i) => pt(forecastStart + i, v));

  const lineOf = (pts: readonly (readonly [number, number])[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

  const area = `${lineOf(actual)} L${actual[actual.length - 1][0]},${8 + ih} L${actual[0][0]},${8 + ih} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="cc-budget-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cc-green)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--cc-green)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* y labels */}
      {model.yLabels.map((l, i) => {
        const yy = 8 + (i / (model.yLabels.length - 1)) * ih;
        return (
          <g key={l}>
            <line x1={PAD_L} x2={W - 6} y1={yy} y2={yy} stroke="var(--cc-hairline)" strokeWidth="1" />
            <text x={PAD_L - 5} y={yy + 3} textAnchor="end" fontSize="7.5" fill="var(--cc-ink-3)">
              {l}
            </text>
          </g>
        );
      })}
      <path d={area} fill="url(#cc-budget-fill)" />
      {/* budget dashed grey */}
      <path d={lineOf(budget)} fill="none" stroke="#9aa8ae" strokeWidth="1.2" strokeDasharray="4 3" />
      {/* forecast dashed amber — illustrative only */}
      <path d={lineOf(forecast)} fill="none" stroke="var(--cc-amber)" strokeWidth="1.4" strokeDasharray="4 3" />
      {forecast.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="var(--cc-amber)" />
      ))}
      {/* actual green */}
      <path d={lineOf(actual)} fill="none" stroke="var(--cc-green)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {/* x dates */}
      {model.labels.map((d, i) => (
        <text key={`${d}-${i}`} x={pt(i, 0)[0]} y={H - 4} textAnchor="middle" fontSize="7.5" fill="var(--cc-ink-3)">
          {d}
        </text>
      ))}
    </svg>
  );
}

/* ---------- Genset illustration (inline SVG, muted) ---------- */

function GensetSvg() {
  return (
    <svg viewBox="0 0 150 90" style={{ width: '100%', maxWidth: 150, height: 'auto', display: 'block', margin: '0 auto' }}>
      {/* skid */}
      <rect x="10" y="74" width="130" height="6" rx="3" fill="#3a4f58" />
      {/* body */}
      <rect x="18" y="22" width="114" height="54" rx="6" fill="#4d6b74" />
      <rect x="18" y="22" width="114" height="54" rx="6" fill="url(#cc-dg-sheen)" />
      <defs>
        <linearGradient id="cc-dg-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* canopy top */}
      <rect x="24" y="16" width="102" height="8" rx="4" fill="#5f7f89" />
      {/* vents */}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={30 + i * 12} y="34" width="7" height="28" rx="2" fill="#31454d" />
      ))}
      {/* control panel */}
      <rect x="96" y="32" width="28" height="32" rx="3" fill="#22333a" />
      <circle cx="104" cy="41" r="3" fill="var(--cc-green)" />
      <rect x="99" y="50" width="22" height="3" rx="1.5" fill="#4d6b74" />
      <rect x="99" y="56" width="16" height="3" rx="1.5" fill="#4d6b74" />
      {/* exhaust */}
      <rect x="112" y="6" width="6" height="12" rx="2" fill="#31454d" />
    </svg>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export default function BottomRow({
  mailRows,
  mailboxState,
  budget,
}: {
  mailRows?: MailRow[] | null;
  mailboxState?: { loading: boolean; error: string | null };
  budget?: BudgetStats | null;
}) {
  const orgId = useCommandCenterOrgId();
  const propertyId = useSearchParams().get('propertyId') ?? undefined;
  const links = orgId ? buildNavMap(orgId, propertyId).cardLinks : null;

  /* Budget vs Actual — live trend + summary, mock fallback. */
  const trendQ = useWidgetData<TrendPayload>(
    orgId ? `/api/aop/trend?org_id=${orgId}` : null, 5 * 60_000);
  const aopQ = useWidgetData<CcAopSummary>(
    orgId ? `/api/aop/summary?org_id=${orgId}` : null, 5 * 60_000);
  const liveBudget = !!trendQ.data && trendQ.data.provisioned && trendQ.data.points.length >= 2;
  const chartModel = liveBudget ? (modelFromTrend(trendQ.data!.points) ?? modelFromMock()) : modelFromMock();

  const now = new Date();
  const monthProgress = `${Math.round((now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()) * 100)}%`;
  const util = aopQ.data?.provisioned && aopQ.data.current?.utilisation_pct != null
    ? `${Math.round(aopQ.data.current.utilisation_pct)}%`
    : BUDGET.forecastUtilization;
  const projectedOverspend = budget?.overspendRisk ?? BUDGET.projectedOverspend;

  /* DG Monitoring — live from the legacy org-scoped generator + diesel rollups. */
  const gensQ = useWidgetData<CcGenerator[]>(
    orgId ? `/api/organizations/${orgId}/generators` : null, 5 * 60_000);
  const dieselQ = useWidgetData<CcDieselSummary>(
    orgId ? `/api/organizations/${orgId}/diesel-summary?period=month` : null, 5 * 60_000);
  const gens = Array.isArray(gensQ.data) ? gensQ.data : null;
  const dgLive = !!gens?.length;
  const dgCounts = dgLive
    ? [
        { label: 'Running', value: gens!.filter(g => g.status === 'active').length, color: 'var(--cc-green)' },
        { label: 'Standby', value: gens!.filter(g => g.status === 'standby').length, color: 'var(--cc-blue)' },
        { label: 'Fault', value: gens!.filter(g => g.status !== 'active' && g.status !== 'standby').length, color: 'var(--cc-red)' },
      ]
    : DG.counts;
  const dgStatus = !dgLive
    ? DG.status
    : dgCounts[2].value > 0 ? 'Attention' : 'Normal';
  const diesel = dieselQ.data ?? null;

  /* Mail Digest — rows arrive already mapped from useCommandCenterData. */
  const mailLive = !!mailRows?.length;
  const mail = mailLive ? mailRows! : MAIL_DIGEST;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '5fr 3fr 4fr', gap: 16 }}>
      {/* 1 — Budget vs Actual */}
      <div className="cc-card">
        <div className="cc-card-head" style={{ marginBottom: 8 }}>
          <span className="cc-chip cc-chip--amber">
            <Wallet />
          </span>
          <span className="cc-title">Budget vs Actual</span>
          <span className="cc-head-meta">
            <SourceTag live={liveBudget} />
          </span>
        </div>
        <div style={{ display: 'flex', gap: 14, marginBottom: 6 }}>
          {BUDGET.legend.map((l) => (
            <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-2)' }}>
              <span className="cc-dot" style={{ ['--cc-dot-c' as string]: l.color, boxShadow: 'none' }} />
              {l.label === 'Forecast' ? 'Forecast (demo)' : l.label}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, alignSelf: 'center' }}>
            <BudgetChart model={chartModel} />
          </div>
          <div
            style={{
              flex: 'none',
              width: 118,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderLeft: '1px solid var(--cc-hairline)',
              paddingLeft: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)' }}>Month Progress</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>{monthProgress}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)' }}>Forecast Utilization</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>{util}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)' }}>Projected Overspend</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: -0.3, color: 'var(--cc-red)' }}>
                {projectedOverspend}
              </div>
            </div>
            {links ? (
              <Link href={links.viewFullReport} className="cc-btn" style={{ alignSelf: 'flex-start', marginTop: 'auto', whiteSpace: 'nowrap', padding: '7px 12px', fontSize: 10.5 }}>
                View Full Report
              </Link>
            ) : (
              <button type="button" className="cc-btn" style={{ alignSelf: 'flex-start', marginTop: 'auto', whiteSpace: 'nowrap', padding: '7px 12px', fontSize: 10.5 }}>
                View Full Report
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2 — DG Monitoring */}
      <div className="cc-card">
        <div className="cc-card-head" style={{ marginBottom: 8 }}>
          <span className="cc-chip cc-chip--teal">
            <Fuel />
          </span>
          <span className="cc-title">DG Monitoring</span>
          <span className="cc-head-meta">
            <SourceTag live={dgLive} />
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--cc-ink-2)' }}>
              {dgLive ? `${gens!.length} Generator${gens!.length === 1 ? '' : 's'}` : DG.statusLabel}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, letterSpacing: -0.3,
                color: dgStatus === 'Normal' ? 'var(--cc-green)' : 'var(--cc-red)',
              }}
            >
              {dgStatus}
            </div>
            {dgLive && diesel && (
              <div style={{ fontSize: 10, color: 'var(--cc-ink-3)', marginTop: 2 }}>
                {diesel.total_litres.toLocaleString('en-IN')} L this month · {diesel.refill_count} refills · {diesel.total_capacity_litres.toLocaleString('en-IN')} L capacity
              </div>
            )}
            {dgLive && (
              <div style={{ fontSize: 9, color: 'var(--cc-ink-3)', marginTop: 2 }}>
                Lifecycle status from the asset register — no live telemetry.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {dgCounts.map((c) => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--cc-ink-2)' }}>
                <span className="cc-dot" style={{ ['--cc-dot-c' as string]: c.color, boxShadow: 'none', width: 6, height: 6 }} />
                <span style={{ width: 44 }}>{c.label}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--cc-ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {c.value}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '8px 0' }}>
          <GensetSvg />
        </div>
        {links ? (
          <Link href={links.viewDg} className="cc-btn" style={{ alignSelf: 'center', marginTop: 'auto' }}>
            View DG Dashboard
          </Link>
        ) : (
          <button type="button" className="cc-btn" style={{ alignSelf: 'center', marginTop: 'auto' }}>
            View DG Dashboard
          </button>
        )}
      </div>

      {/* 3 — Mail Digest */}
      <div className="cc-card">
        <div className="cc-card-head" style={{ marginBottom: 6 }}>
          <span className="cc-chip cc-chip--blue">
            <Mail />
          </span>
          <span className="cc-title">Mail Digest (Top Unresolved)</span>
          <span className="cc-head-meta">
            <SourceTag live={mailLive} />
          </span>
        </div>
        <div style={{ flex: 1 }}>
          {mail.map((m) => (
            <div className="cc-listrow" key={m.vendor}>
              <span className="cc-listrow-avatar">{initials(m.vendor)}</span>
              <div className="cc-listrow-main">
                <div className="cc-listrow-name">{m.vendor}</div>
                <div className="cc-listrow-sub">{m.issue}</div>
              </div>
              <div className="cc-listrow-right" style={{ gap: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)', whiteSpace: 'nowrap' }}>{m.time}</span>
                <span className={`cc-pill ${m.pill}`}>{m.severity}</span>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="cc-btn"
          style={{ alignSelf: 'center', marginTop: 'auto', opacity: 0.5, cursor: 'not-allowed' }}
          disabled
          title="No mailbox page exists yet — the purchase mailbox is API/digest only"
        >
          Open Purchase Mailbox
        </button>
      </div>
    </div>
  );
}
