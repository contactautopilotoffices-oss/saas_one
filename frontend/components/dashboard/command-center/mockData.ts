// Mock data for Command Center Row 1 cards.
// Isolated here so it can be swapped 1:1 with real fetches later.

import { useEffect, useState } from 'react';

/**
 * Resolve the org id of the Command Center instance this card is rendered inside.
 * CommandCenterShell stamps it onto its root element as `data-org` (the real dashboard
 * passes the session org, the cc-preview pages pass the preview org), so any card can
 * read it from the DOM without prop drilling through components it does not own.
 */
export function useCommandCenterOrgId(): string | null {
  const [orgId, setOrgId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const v = document.querySelector('[data-org]')?.getAttribute('data-org') || '';
      return /^[0-9a-f-]{36}$/i.test(v) ? v : null;
    };

    const first = read();
    if (first) { setOrgId(first); return; }

    // The host stamps `data-org` from an ASYNC org fetch, so on first paint the attribute
    // is still the empty-string placeholder. A one-shot read here therefore stuck at null
    // forever — the effect never runs again — and every card without an orgId prop then
    // passed `null` to useWidgetData, which starts no request and reports loading:false.
    // The cards read that as "loaded, no data" and showed a fetch error for a fetch that
    // was never attempted. Watch until the real id lands instead.
    const observer = new MutationObserver(() => {
      const v = read();
      if (v) { setOrgId(v); observer.disconnect(); }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-org'],
    });
    return () => observer.disconnect();
  }, []);
  return orgId;
}

/* ---- shared payload shapes for the endpoints the Row 1 / bottom cards read -------- */

export interface CcPropertyTickets {
  property_id: string;
  property_name: string;
  property_code: string;
  total: number;
  open: number;
  waitlist: number;
  in_progress: number;
  resolved: number;
  pending_validation: number;
  urgent_open: number;
  trends: { total: number[]; resolved: number[]; active: number[]; pending: number[] };
}

export interface CcTicketsSummary {
  total_tickets: number;
  open_tickets: number;
  in_progress: number;
  resolved: number;
  pending_validation: number;
  sla_breached: number;
  urgent_open: number;
  properties: CcPropertyTickets[];
}

export interface CcAopSummary {
  provisioned: boolean;
  current: {
    month: string;
    budget: number;
    actual: number;
    saving: number;
    utilisation_pct: number | null;
  } | null;
  overspending?: Array<{ site_name: string; overspend: number; overspend_pct: number | null }>;
}

export interface CcMailboxSummary {
  provisioned: boolean;
  totals: {
    unactioned_request: number;
    awaiting_reply: number;
    oldest_days: number;
  } | null;
}

export interface CcGenerator {
  id: string;
  name: string | null;
  status: string | null; // lifecycle: 'active' | 'standby' | 'maintenance'
  capacity_kva: number | null;
}

export interface CcDieselSummary {
  total_litres: number;
  total_kwh: number;
  refill_count: number;
  total_capacity_litres: number;
  properties_count: number;
}

/** Active ticket load for a property or org rollup (everything not resolved/closed). */
export function activeTicketsOf(p: {
  open: number; in_progress: number; pending_validation: number; waitlist?: number;
}): number {
  return p.open + p.in_progress + p.pending_validation + (p.waitlist ?? 0);
}

/**
 * Per-site health score from the tickets summary (documented in PortfolioOverviewCard):
 * the site's resolution rate, minus 5 points per urgent open ticket, clamped to 0-100.
 */
export function siteScore(p: CcPropertyTickets): number {
  const rate = p.total > 0 ? (p.resolved / p.total) * 100 : 100;
  return Math.round(Math.max(0, Math.min(100, rate - p.urgent_open * 5)));
}

export type HealthStat = {
  value: string;
  label: string;
  tone: 'red' | 'amber' | 'green' | 'teal' | 'neutral';
  icon: 'alert' | 'issues' | 'exposure' | 'updates';
};

export const healthScore = {
  score: 94,
  max: 100,
  deltaPts: 3,
  deltaLabel: 'vs yesterday',
  caption: 'Your portfolio is performing well',
  // 10 daily points, 0–100 scale (26 Jul → Today)
  trend: [82, 88, 85, 91, 86, 93, 88, 92, 90, 94],
  xLabels: ['26 Jul', '28 Jul', '30 Jul', '1 Aug', 'Today'],
  stats: [
    { value: '4', label: 'Buildings need attention', tone: 'red', icon: 'alert' },
    { value: '2', label: 'Critical issues', tone: 'neutral', icon: 'issues' },
    { value: '₹2.4L', label: 'Est. financial exposure', tone: 'teal', icon: 'exposure' },
    { value: '18', label: 'Positive updates', tone: 'green', icon: 'updates' },
  ] as HealthStat[],
};

export const aiBrief = {
  updatedLabel: 'Updated 10 min ago',
  ctaLabel: 'View full brief',
};

export type BuildingRow = {
  name: string;
  city: string;
  score: number;
  status: 'red' | 'amber' | 'green';
  trend: number[];
};

export const portfolioBuildings: BuildingRow[] = [
  { name: 'Whitefield Tower', city: 'Bangalore', score: 82, status: 'red', trend: [88, 86, 87, 84, 85, 83, 82] },
  { name: 'BKC Center', city: 'Mumbai', score: 98, status: 'green', trend: [93, 94, 95, 95, 96, 97, 98] },
  { name: 'Hyderabad Hub', city: 'Hyderabad', score: 95, status: 'green', trend: [91, 93, 92, 94, 93, 95, 95] },
  { name: 'Pune Tech Park', city: 'Pune', score: 90, status: 'amber', trend: [92, 91, 90, 92, 89, 91, 90] },
  { name: 'Noida One', city: 'Noida', score: 97, status: 'green', trend: [92, 93, 94, 94, 95, 96, 97] },
];

export const CC_COLORS = {
  red: '#EF4444',    // --error
  amber: '#F59E0B',  // --warning
  green: '#10B981',  // --success
  teal: '#708F96',   // --primary
  blue: '#3B82F6',   // --info
  purple: '#AA895F', // --secondary (warm tan; AI Brief chip)
  ink3: '#8a99a1',
} as const;

/** Build a smooth (Catmull-Rom → cubic bezier) SVG path for a series of points. */
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Map a data series into svg points within a box. */
export function toPoints(
  series: number[],
  width: number,
  height: number,
  pad = 2,
  min?: number,
  max?: number,
): { x: number; y: number }[] {
  const lo = min ?? Math.min(...series);
  const hi = max ?? Math.max(...series);
  const span = hi - lo || 1;
  return series.map((v, i) => ({
    x: pad + (i / (series.length - 1)) * (width - pad * 2),
    y: pad + (1 - (v - lo) / span) * (height - pad * 2),
  }));
}

/* ---- PRIORITY ACTIONS (PriorityActions.tsx) -------------------------------- */

export const priorityActionsMeta = {
  label: 'Priority Actions',
  count: 5,
};

/** Red sparkline for the Electricity Alert card (rising trend). */
export const electricityAlertSparkline = [
  34, 38, 36, 44, 41, 50, 47, 56, 60, 57, 66, 72,
];

export const budgetHealth = {
  utilizedPct: 89,
  forecastPct: 94,
  overspendRisk: '₹13.8L',
};
