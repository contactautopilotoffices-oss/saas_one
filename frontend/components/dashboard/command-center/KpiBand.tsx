'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Bot, Ticket, UserCheck, Users } from 'lucide-react';
import { useWidgetData, type WidgetDataState } from '@/frontend/lib/dashboard/useWidgetData';
import { buildNavMap } from './navMap';
import KpiTile, { kpiCount, type KpiTileState } from './KpiTile';
import type { AgentPulsePayload } from './AgentActivityCard';

/**
 * "At a glance" KPI band, phase 1 (docs/COMMAND_CENTER_KPI_PLAN.md): Agents, Requests, Visitors, Attendance.
 * Mounted in place of AgentActivityCard by the SHOW_KPI_BAND switch in CommandCenter.tsx.
 *
 * Agents, Visitors and Attendance read the SAME URL + TTL as the cards that already show those figures
 * (AgentActivityCard, MoreAtAGlance's Visitors card, PriorityActions' Workforce tile), so the shared widget cache
 * serves one request to both and the numbers always match. Requests reads the new /api/command-center/kpis route.
 */

type Section<T> = ({ provisioned: true } & T) | { provisioned: false; reason?: string } | { error: string };

interface KpisPayload {
  provisioned: boolean;
  as_of?: string;
  requests?: Section<{
    raised_today: number;
    closed_today: number;
    median_complete_hours: number | null;
    slow_count: number;
    slow_force_closed: number;
    avg_closing_hours: number | null;
    closed_in_window: number;
    window_days: number;
  }>;
}

interface VmsSummaryPayload {
  total_visitors: number;
  total_today?: number;
  total_checked_in: number;
  total_checked_out: number;
  properties: unknown[];
}

interface RosterCoveragePayload {
  provisioned: boolean;
  reason?: string;
  present?: number;
  late?: number;
  absent?: number;
  coverage_pct?: number | null;
}

/** "X h" under 48 hours, else "X.Y days"; "—" when there is nothing to average. */
function closingTime(hours: number | null | undefined): string {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return '—';
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

/** Shared head of every tile's state: loading (also while the org is unknown) or a failed fetch. */
function feedState<T>(orgId: string | null, q: WidgetDataState<T>): KpiTileState | null {
  if (!orgId || q.loading || (!q.data && !q.error)) return { kind: 'loading' };
  if (q.error || !q.data) return { kind: 'error', error: q.error };
  return null;
}

export default function KpiBand({ orgId, propertyId }: { orgId: string | null; propertyId?: string | null }) {
  // Same href logic as AgentActivityCard's "Open agent console" button (useOpenConsole): current path + tab.
  const pathname = usePathname();
  const links = orgId ? buildNavMap(orgId, propertyId ?? undefined).cardLinks : null;

  const pulseQ = useWidgetData<AgentPulsePayload>(orgId ? `/api/agents/pulse?orgId=${orgId}` : null, 60_000);
  const kpisQ = useWidgetData<KpisPayload>(orgId ? `/api/command-center/kpis?org_id=${orgId}` : null, 5 * 60_000);
  const vmsQ = useWidgetData<VmsSummaryPayload>(
    orgId ? `/api/organizations/${orgId}/vms-summary?period=today` : null, 5 * 60_000);
  const rosterQ = useWidgetData<RosterCoveragePayload>(
    orgId ? `/api/organizations/${orgId}/roster-coverage` : null, 2 * 60_000);

  /* ---- Agents ---- */
  const agents: KpiTileState = feedState(orgId, pulseQ) ?? (() => {
    const p = pulseQ.data!;
    if (p.provisioned === false) return { kind: 'unprovisioned', reason: p.reason };
    const t = p.totals;
    if (!t) return { kind: 'error', error: null };
    return {
      kind: 'live',
      stats: [
        { label: 'Agents live', value: kpiCount(t.live_agents), tone: t.live_agents > 0 ? 'good' : undefined },
        { label: 'Runs today', value: kpiCount(t.runs_today) },
        { label: 'Failed today', value: kpiCount(t.failures_today), tone: t.failures_today > 0 ? 'bad' : undefined },
        { label: 'Modules moved', value: kpiCount(t.modules_with_movement) },
      ],
    };
  })();

  /* ---- Requests ---- */
  const requests: KpiTileState = feedState(orgId, kpisQ) ?? (() => {
    const s = kpisQ.data!.requests;
    if (!s || 'error' in s) return { kind: 'error', error: null };
    if (!s.provisioned) return { kind: 'unprovisioned', reason: s.reason };
    return {
      kind: 'live',
      stats: [
        { label: 'Raised today', value: kpiCount(s.raised_today) },
        { label: 'Completed today', value: kpiCount(s.closed_today) },
        // Typical (median), not average: a few old tickets closed in a clean-up made the average read 4.7 days when
        // half were done within a day (docs/COMMAND_CENTER_KPI_PLAN.md).
        { label: 'Typical time to complete', value: closingTime(s.median_complete_hours) },
      ],
      footnote: s.slow_count > 0
        ? `Last ${s.window_days ?? 7} days · ${s.slow_count} took over a week${s.slow_force_closed ? ` (${s.slow_force_closed} force-closed)` : ''}`
        : `Last ${s.window_days ?? 7} days · none took over a week`,
    };
  })();

  /* ---- Visitors ---- */
  const visitors: KpiTileState = feedState(orgId, vmsQ) ?? (() => {
    const v = vmsQ.data!;
    if (!Array.isArray(v.properties)) return { kind: 'error', error: null };
    // Same rule as the Visitors card: an org with no buildings has nothing to count.
    if (v.properties.length === 0) return { kind: 'unprovisioned', reason: 'No buildings in this organisation yet.' };
    return {
      kind: 'live',
      stats: [
        { label: 'Checked in today', value: kpiCount(v.total_today ?? v.total_visitors) },
        { label: 'On site now', value: kpiCount(v.total_checked_in) },
        { label: 'Checked out', value: kpiCount(v.total_checked_out) },
      ],
    };
  })();

  /* ---- Attendance ---- */
  const attendance: KpiTileState = feedState(orgId, rosterQ) ?? (() => {
    const r = rosterQ.data!;
    if (!r.provisioned) return { kind: 'unprovisioned', reason: r.reason };
    const absent = r.absent ?? 0;
    return {
      kind: 'live',
      stats: [
        { label: 'Present', value: kpiCount(r.present) },
        { label: 'Late', value: kpiCount(r.late) },
        { label: 'Absent', value: kpiCount(r.absent), tone: absent > 0 ? 'bad' : undefined },
        {
          label: 'Coverage',
          value: typeof r.coverage_pct === 'number' && Number.isFinite(r.coverage_pct) ? `${Math.round(r.coverage_pct)}%` : '—',
        },
      ],
    };
  })();

  return (
    <div className="cc-band cc-band-kpi" aria-label="At a glance">
      <KpiTile
        title="Agents" icon={<Bot />} chipClass="cc-chip--purple"
        href={orgId ? `${pathname || ''}?tab=agent_console` : null}
        state={agents}
      />
      <KpiTile title="Requests" icon={<Ticket />} chipClass="cc-chip--teal" href={links?.viewAllTickets ?? null} state={requests} />
      <KpiTile title="Visitors" icon={<UserCheck />} chipClass="cc-chip--blue" href={links?.viewVisitors ?? null} state={visitors} />
      <KpiTile title="Attendance" icon={<Users />} chipClass="cc-chip--green" href={links?.viewRoster ?? null} state={attendance} />
    </div>
  );
}
