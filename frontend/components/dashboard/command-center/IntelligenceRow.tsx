'use client';

import React from 'react';
import { Zap, Droplets, ClipboardCheck, Package, ShoppingCart } from 'lucide-react';
import {
  ELECTRICITY,
  WATER,
  PPM,
  MATERIAL_REQUESTS,
  PURCHASE_ORDERS,
} from './mockData-intel';
import type { MrStats, PoStats } from './useCommandCenterData';
import SourceTag from './SourceTag';
import { CardSkeleton, CardEmpty, fetchErrorReason } from './CardStates';
import type { WaterResponse, Unprovisioned } from '@/backend/lib/commandCenter/types';
import { useWidgetData, inr } from '@/frontend/lib/dashboard/useWidgetData';

/* ---------- shared bits ---------- */

function FooterGrid({ items, cols }: { items: { label: string; value: string; color?: string }[]; cols: number }) {
  return (
    <div
      style={{
        marginTop: 'auto',
        paddingTop: 10,
        borderTop: '1px solid var(--cc-hairline)',
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        rowGap: 10,
        columnGap: 8,
      }}
    >
      {items.map((it) => (
        <div key={it.label} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: -0.3,
              color: it.color || 'var(--cc-ink)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function CardHead({
  chipClass,
  icon,
  title,
  meta,
}: {
  chipClass: string;
  icon: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="cc-card-head" style={{ marginBottom: 10, gap: 6 }}>
      <span className={`cc-chip ${chipClass}`} style={{ width: 24, height: 24, borderRadius: 7 }}>
        {icon}
      </span>
      <span
        className="cc-title"
        style={{
          fontSize: 9,
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {title}
      </span>
      {meta ? <span className="cc-head-meta">{meta}</span> : null}
    </div>
  );
}

function MiniPill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`cc-pill ${className}`} style={{ fontSize: 9, padding: '2px 7px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

/* ---------- charts (inline SVG, no deps) ---------- */

function AreaSpark({ data, ticks, color }: { data: number[]; ticks: string[]; color: string }) {
  const W = 220;
  const H = 56;
  const max = 100;
  const step = W / (data.length - 1);
  const pts = data.map((v, i) => [i * step, H - 6 - (v / max) * (H - 14)] as const);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 56, display: 'block' }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="cc-elec-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#cc-elec-fill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8.5, color: 'var(--cc-ink-3)', marginTop: 2 }}>
        {ticks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function BarMini({ data, ticks, color }: { data: number[]; ticks: string[]; color: string }) {
  const W = 220;
  const H = 56;
  const bw = W / data.length;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 56, display: 'block' }} preserveAspectRatio="none">
        {data.map((v, i) => {
          const h = Math.max(2, (v / 100) * (H - 6));
          return (
            <rect
              key={i}
              x={i * bw + 1}
              y={H - h}
              width={bw - 2.5}
              height={h}
              rx={1}
              fill={color}
              opacity={0.85}
            />
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8.5, color: 'var(--cc-ink-3)', marginTop: 2 }}>
        {ticks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function LineSpark({ data, color }: { data: number[]; color: string }) {
  const W = 110;
  const H = 30;
  const step = W / (data.length - 1);
  const pts = data.map((v, i) => [i * step, H - 3 - (v / 100) * (H - 8)] as const);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 110, height: 30, display: 'block', flex: 'none' }} preserveAspectRatio="none">
      <path d={area} fill={color} opacity="0.14" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Donut({ pct, color }: { pct: number; color: string }) {
  const R = 36;
  const C = 2 * Math.PI * R;
  return (
    <div style={{ position: 'relative', width: 88, height: 88, flex: 'none' }}>
      <svg viewBox="0 0 76 76" style={{ width: 88, height: 88, display: 'block' }}>
        <circle cx="44" cy="44" r={R} fill="none" stroke="var(--cc-hairline)" strokeWidth="7" />
        <circle
          cx="38"
          cy="38"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * C} ${C}`}
          transform="rotate(-90 44 44)"
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
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, letterSpacing: -0.3, color: 'var(--cc-ink)' }}>
          {pct}%
        </span>
        <span style={{ fontSize: 8.5, fontWeight: 500, color: 'var(--cc-ink-3)' }}>Completed</span>
      </div>
    </div>
  );
}

/* ---------- side stat (label above value) ---------- */

function SideStat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)', lineHeight: 1.3 }}>{label}</div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: -0.3,
          color: color || 'var(--cc-ink)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.25,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ---------- live payload shapes ---------- */

interface ElecPacePayload {
  provisioned: boolean;
  as_of?: string;
  day_of_month?: number;
  current?: { units: number; cost: number; readings: number; meters: number } | null;
  previous?: { units: number; cost: number; readings: number; meters: number } | null;
  current_all_meters?: { units: number; cost: number; readings: number; meters: number };
  comparable?: boolean;
  delta_pct?: number | null;
  projected_month_units?: number | null;
  verdict?: string | null;
  data_quality?: {
    excluded_readings: number;
    anomalies?: Array<{
      id: string; meter_name: string | null; property_name: string | null;
      reading_date: string; units: number; times_typical: number | null; anomaly_kind: string | null;
    }>;
  };
  properties?: Array<{ property_id: string; name: string; current: number; previous: number; delta_pct: number | null }>;
}

interface PpmSummaryPayload {
  provisioned: boolean;
  total?: number;
  completed_pct?: number;
  due_today?: number;
  overdue?: number;
  next_7_days?: number;
  target_pct?: number;
  most_overdue_system?: { name: string; count: number } | null;
  last_serviced_days_ago?: number | null;
}

/** Pace payload shape shared with the Electricity Alert card (exported, not duplicated). */
export type { ElecPacePayload };

/* ---------- row ---------- */

export default function IntelligenceRow({
  mr, mrState,
  po, accountsState,
  orgId,
}: {
  mr?: MrStats | null;
  mrState?: { loading: boolean; error: string | null };
  po?: PoStats | null;
  accountsState?: { loading: boolean; error: string | null };
  orgId?: string | null;
}) {
  const paceQ = useWidgetData<ElecPacePayload>(
    orgId ? `/api/electricity/pace?org_id=${orgId}` : null, 5 * 60_000);
  const waterQ = useWidgetData<WaterResponse | Unprovisioned>(
    orgId ? `/api/command-center/water?org_id=${orgId}` : null, 5 * 60_000);
  const water = waterQ.data && waterQ.data.provisioned ? waterQ.data : null;

  const ppmQ = useWidgetData<PpmSummaryPayload>(
    orgId ? `/api/organizations/${orgId}/ppm-summary` : null, 5 * 60_000);

  /* Electricity Intelligence — /api/electricity/pace (readings + bills, anomaly-adjusted) */
  const pace = paceQ.data?.provisioned && paceQ.data.current && paceQ.data.previous ? paceQ.data : null;
  let EL = {
    live: false,
    delta: ELECTRICITY.delta,
    deltaColor: 'var(--cc-green)',
    todayLabel: ELECTRICITY.todayLabel,
    todayValue: ELECTRICITY.todayValue,
    status: ELECTRICITY.status,
    statusPill: 'cc-pill--ok',
    verdict: null as string | null,
    excluded: 0,
    footer: ELECTRICITY.footer as { label: string; value: string; color?: string }[],
  };
  if (pace) {
    const cur = pace.current_all_meters || pace.current!;
    const deltaPct = pace.delta_pct ?? null;
    const dayOfMonth = pace.day_of_month || 1;
    const anchor = pace.as_of ? new Date(pace.as_of + 'T00:00:00Z') : new Date();
    const daysInMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
    const projectedCost = Math.round((cur.cost / dayOfMonth) * daysInMonth);
    const likeDelta = pace.previous!.cost > 0 ? pace.current!.cost - pace.previous!.cost : null;
    const top = [...(pace.properties || [])].sort((a, b) => b.current - a.current)[0];
    const topShare = top && cur.units > 0 ? Math.round((top.current / cur.units) * 100) : null;
    const up = deltaPct !== null && deltaPct > 0;
    EL = {
      live: true,
      delta: deltaPct !== null ? `${up ? '↑' : '↓'} ${Math.abs(deltaPct)}%` : '—',
      deltaColor: deltaPct === null ? 'var(--cc-ink)' : up ? 'var(--cc-red)' : 'var(--cc-green)',
      todayLabel: 'Month to date',
      todayValue: `${Math.round(cur.units).toLocaleString('en-IN')} kWh`,
      status: up && deltaPct! >= 12 ? 'Watch' : 'Healthy',
      statusPill: up && deltaPct! >= 12 ? 'cc-pill--medium' : 'cc-pill--ok',
      verdict: pace.verdict ?? null,
      excluded: pace.data_quality?.excluded_readings ?? 0,
      footer: [
        { label: 'Projected Bill', value: inr(projectedCost, { compact: true }) },
        { label: 'Last Mo. (same days)', value: inr(pace.previous!.cost, { compact: true }) },
        likeDelta !== null
          ? likeDelta <= 0
            ? { label: 'Savings', value: inr(-likeDelta, { compact: true }), color: 'var(--cc-green)' }
            : { label: 'Overrun', value: inr(likeDelta, { compact: true }), color: 'var(--cc-red)' }
          : { label: 'Savings', value: '—' },
        top ? { label: 'Top Consumer', value: topShare !== null ? `${top.name} (${topShare}%)` : top.name } : { label: 'Top Consumer', value: '—' },
        { label: 'Meters', value: String(cur.meters) },
      ],
    };
  }

  /* PPM Compliance — /api/organizations/[orgId]/ppm-summary */
  const ppm = ppmQ.data?.provisioned ? ppmQ.data : null;
  const PPML = {
    live: !!ppm,
    completedPct: ppm ? Math.round(ppm.completed_pct ?? 0) : PPM.completedPct,
    dueToday: ppm?.due_today ?? PPM.dueToday,
    overdue: ppm?.overdue ?? PPM.overdue,
    footer: ppm
      ? [
          { label: 'Target', value: `${ppm.target_pct ?? 95}%` },
          { label: 'Next 7 Days', value: String(ppm.next_7_days ?? 0) },
          { label: 'Most Overdue System', value: ppm.most_overdue_system?.name ?? 'None' },
          {
            label: 'Last Serviced',
            value: ppm.last_serviced_days_ago != null
              ? ppm.last_serviced_days_ago === 0 ? 'Today' : `${ppm.last_serviced_days_ago}d ago`
              : '—',
          },
        ]
      : PPM.footer,
  };

  // Real fetch when available; mock values from mockData-intel.ts otherwise.
  const MR = {
    total: mr?.total ?? MATERIAL_REQUESTS.total,
    delayed: mr?.delayed ?? MATERIAL_REQUESTS.delayed,
    critical: mr?.critical ?? MATERIAL_REQUESTS.critical,
    avgFulfilment: mr?.avgWait ?? MATERIAL_REQUESTS.avgFulfilment,
  };
  const PO = {
    total: po?.total ?? PURCHASE_ORDERS.total,
    awaitingApproval: po?.awaitingApproval ?? PURCHASE_ORDERS.awaitingApproval,
    awaitingVendor: po?.awaitingVendor ?? PURCHASE_ORDERS.awaitingVendor,
    pipelineValue: po?.pipelineValue ?? PURCHASE_ORDERS.pipelineValue,
    pipelinePct: po?.pipelinePct ?? PURCHASE_ORDERS.pipelinePct,
    completedThisMonth: po?.completedThisMonth ?? 355,
    cancelled: PURCHASE_ORDERS.footer[1].value, // no cancelled source yet — mock
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 16 }}>
      {/* 1 — Electricity Intelligence */}
      <div className="cc-card">
        <CardHead
          chipClass="cc-chip--green"
          icon={<Zap />}
          title="Electricity Intelligence"
          meta={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <MiniPill className={EL.statusPill}>{EL.status}</MiniPill>
              <SourceTag live={EL.live} />
            </span>
          }
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, letterSpacing: -0.3, color: EL.deltaColor }}>
              {EL.delta}
            </div>
            <div className="cc-sub" style={{ fontSize: 10 }}>{ELECTRICITY.deltaLabel}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)' }}>{EL.todayLabel}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: -0.3, fontVariantNumeric: 'tabular-nums' }}>
              {EL.todayValue}
            </div>
          </div>
        </div>
        {EL.live ? (
          <div style={{ minHeight: 56, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '6px 0' }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--cc-ink-2)', lineHeight: 1.4 }}>
              {EL.verdict || 'Consumption tracked across all meters.'}
            </div>
            {EL.excluded > 0 ? (
              <div style={{ fontSize: 9.5, color: 'var(--cc-amber)' }}>
                {EL.excluded} corrupt reading{EL.excluded === 1 ? '' : 's'} excluded from these figures.
              </div>
            ) : null}
          </div>
        ) : (
          <AreaSpark data={ELECTRICITY.spark} ticks={ELECTRICITY.ticks} color="var(--cc-green)" />
        )}
        <FooterGrid items={EL.footer.slice(0, 3)} cols={3} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', columnGap: 8, marginTop: 10 }}>
          {EL.footer.slice(3).map((it) => (
            <div key={it.label}>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: -0.3 }}>{it.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 2 — Water Intelligence */}
      <div className="cc-card">
        <CardHead
          chipClass="cc-chip--blue"
          icon={<Droplets />}
          title="Water Intelligence"
          meta={<SourceTag live={!!water} />}
        />
        {waterQ.loading ? (
          <CardSkeleton lines={4} />
        ) : !water ? (
          <CardEmpty reason={
            waterQ.error ? fetchErrorReason(waterQ.error) : 'No water readings logged yet.'} />
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, letterSpacing: -0.3, color: 'var(--cc-blue)' }}>
                  {water.delta_pct == null ? '—'
                    : `${water.delta_pct > 0 ? '↑' : '↓'} ${Math.abs(water.delta_pct).toFixed(0)}%`}
                </div>
                <div className="cc-sub" style={{ fontSize: 10 }}>vs same day last week</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)' }}>
                  {water.basis === 'litres' ? 'Latest usage' : 'Latest deliveries'}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: -0.3, fontVariantNumeric: 'tabular-nums' }}>
                  {water.basis === 'litres' && water.today.litres != null
                    ? `${Math.round(water.today.litres).toLocaleString('en-IN')} L`
                    : `${water.today.units} units`}
                </div>
              </div>
            </div>

            <BarMini
              data={water.series.map((pt) => pt.value ?? 0)}
              ticks={[]}
              color="var(--cc-blue)"
            />

            <FooterGrid
              cols={3}
              items={[
                { label: 'Expected bill', value: inr(water.billing.expected_bill) },
                { label: 'Last week', value: inr(water.billing.last_week_bill) },
                { label: 'Saving', value: inr(water.billing.saving) },
              ]}
            />

            {/* Leak probability is deliberately absent. water_readings stores discrete
                daily deliveries, not a continuous flow signal, so a leak cannot be
                inferred — and "Low Risk" is exactly the kind of reassurance that must
                never be invented. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', columnGap: 8, marginTop: 10 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Highest use</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: -0.3 }}>
                  {water.highest_use_source
                    ? `${water.highest_use_source.name}${water.highest_use_source.share_pct != null ? ` (${Math.round(water.highest_use_source.share_pct)}%)` : ''}`
                    : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)', lineHeight: 1.3 }}>Granularity</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: -0.3 }}>Daily</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 3 — PPM Compliance */}
      <div className="cc-card">
        <CardHead chipClass="cc-chip--blue" icon={<ClipboardCheck />} title="PPM Compliance" meta={<SourceTag live={PPML.live} />} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
          <Donut pct={PPML.completedPct} color="var(--cc-blue)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SideStat label="Due Today" value={PPML.dueToday} />
            <SideStat label="Overdue" value={PPML.overdue} color="var(--cc-red)" />
          </div>
        </div>
        <FooterGrid items={PPML.footer.slice(0, 2)} cols={2} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', columnGap: 8, marginTop: 10 }}>
          {PPML.footer.slice(2).map((it) => (
            <div key={it.label}>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 4 — Material Requests */}
      <div className="cc-card">
        <CardHead chipClass="cc-chip--amber" icon={<Package />} title="Material Requests" meta={<SourceTag live={!!mr} />} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <SideStat label="Total requests" value={MR.total} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'right' }}>
            <SideStat label="Delayed" value={MR.delayed} color="var(--cc-amber)" />
            <SideStat label="Critical" value={MR.critical} color="var(--cc-red)" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flex: 1 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)' }}>Avg. Fulfilment Time</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: -0.3, fontVariantNumeric: 'tabular-nums' }}>
              {MR.avgFulfilment}
            </div>
          </div>
          <LineSpark data={MATERIAL_REQUESTS.spark} color="var(--cc-amber)" />
        </div>
        <FooterGrid items={MATERIAL_REQUESTS.footer} cols={2} />
      </div>

      {/* 5 — Purchase Orders */}
      <div className="cc-card">
        <CardHead chipClass="cc-chip--teal" icon={<ShoppingCart />} title="Purchase Orders" meta={<SourceTag live={!!po} />} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <SideStat label="Total POs" value={PO.total} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'right' }}>
            <SideStat label="Awaiting Approval" value={PO.awaitingApproval} />
            <SideStat label="Awaiting Vendor" value={PO.awaitingVendor} />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--cc-ink-3)' }}>PO Value Pipeline</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: -0.3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {PO.pipelineValue}
            </span>
            <div style={{ flex: 1, height: 5, borderRadius: 999, background: 'color-mix(in srgb, var(--cc-green) 14%, transparent)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${PO.pipelinePct}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: 'var(--cc-green)',
                }}
              />
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--cc-ink-2)', fontVariantNumeric: 'tabular-nums' }}>
              {PO.pipelinePct}%
            </span>
          </div>
        </div>
        <FooterGrid items={[
          { label: 'Completed This Month', value: String(PO.completedThisMonth) },
          { label: 'Cancelled', value: PO.cancelled },
        ]} cols={2} />
      </div>
    </div>
  );
}
