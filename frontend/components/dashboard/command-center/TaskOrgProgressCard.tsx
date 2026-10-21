'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gauge } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { useWidgetData } from '@/frontend/lib/dashboard/useWidgetData';
import TaskProgressGauge, { type ProgressMetric } from '@/frontend/components/task-manager/TaskProgressGauge';
import { localDay, shiftDay, rangeLabel, ALL_TIME_FROM, type DateRange } from '@/frontend/components/task-manager/DateRangePicker';
import SourceTag from './SourceTag';
import { CardSkeleton, CardEmpty, fetchErrorReason } from './CardStates';

/** Switch (owner 2026-10-17): true = compact range selector in the header; false = no selector, always today. */
const SHOW_ORG_PROGRESS_RANGE = true;

/**
 * ORGANIZATION PROGRESS — the Task Manager's own progress gauge, on the board.
 *
 * Source: /api/task-manager/progress?actorId=&from=&to=&carry=1 — the exact request
 * TaskAssignmentDashboard makes for its default "today" range. The gauge component is
 * reused unchanged; only its outer chrome is flattened by .cc-taskprog-* CSS so it sits
 * inside this card instead of as a card-in-a-card.
 *
 * Only a Task Manager superuser gets the organisation rollup (level 3). Everyone else gets
 * their own / their department's figures from the same route, which are not an
 * organisation number — so the card says so instead of mislabelling them.
 */

interface EmployeeProg { total: number; completed: number }
interface DeptProg { departmentId: string; departmentName: string; total: number; completed: number; percentage: number; employeeProgress?: EmployeeProg[] }
export interface OrgProgressData {
  percentage: number;
  total: number;
  completed: number;
  pending: number;
  totalDepartments: number;
  departmentProgress: DeptProg[];
}
interface ProgressResponse { success: boolean; level?: number; data?: OrgProgressData; error?: string }

/**
 * The three gauge metrics, computed exactly as TaskAssignmentDashboard.tsx:544-647 does
 * for a superuser with no filters (selectedDeptId === 'all', selectedEmployeeId === 'all').
 * Its task-list fallbacks are not available here, so the "no progress data" branches use
 * zero tasks — which is what those fallbacks yield on an empty list. Change both together.
 */
export function orgGaugeMetrics(d: OrgProgressData): { org: ProgressMetric; dept: ProgressMetric; employee: ProgressMetric } {
  const orgCompleted = d.completed ?? 0;
  const orgTotal = d.total ?? 0;
  const orgPct = d.percentage !== undefined
    ? d.percentage
    : (orgTotal > 0 ? Math.round((orgCompleted / orgTotal) * 100) : 100);

  const depts = d.departmentProgress ?? [];
  let deptTotal = 0, deptCompleted = 0, deptPct = 100;
  let deptLabel = 'Department Scope';
  let deptSublabel = `${depts.length} Departments`;
  if (depts.length > 0) {
    const withTasks = depts.filter(dp => dp.total > 0);
    if (withTasks.length > 0) {
      deptTotal = withTasks.reduce((s, dp) => s + dp.total, 0);
      deptCompleted = withTasks.reduce((s, dp) => s + dp.completed, 0);
      deptPct = Math.round((deptCompleted / deptTotal) * 100);
    }
    deptLabel = 'All Departments';
    deptSublabel = `Avg across ${depts.length} depts`;
  }

  const allEmp = depts.flatMap(dp => dp.employeeProgress || []);
  const activeEmp = allEmp.filter(ep => ep.total > 0);
  let empTotal = 0, empCompleted = 0, empPct = 100;
  let empSublabel = `${allEmp.length} Staff Members`;
  if (activeEmp.length > 0) {
    empTotal = activeEmp.reduce((s, ep) => s + ep.total, 0);
    empCompleted = activeEmp.reduce((s, ep) => s + ep.completed, 0);
    empPct = Math.round((empCompleted / empTotal) * 100);
    empSublabel = `Avg across ${activeEmp.length} active staff`;
  }

  return {
    org: { percentage: orgPct, completed: orgCompleted, total: orgTotal, label: 'Organisation Progress', sublabel: 'Company-wide Rollup' },
    dept: { percentage: deptPct, completed: deptCompleted, total: deptTotal, label: deptLabel, sublabel: deptSublabel },
    employee: { percentage: empPct, completed: empCompleted, total: empTotal, label: 'Employee Scope', sublabel: empSublabel },
  };
}

const n = (v: number) => (v ?? 0).toLocaleString('en-IN');

/*
 * Range presets — a COPY of presetRange() in frontend/components/task-manager/DateRangePicker.tsx
 * (not exported there). Same presets, same from/to strings, so a range here means exactly what it
 * means on the Task Manager page. The picker itself is not reused because its two date boxes do
 * not fit this card's header; there is no custom range here. Change both together.
 */
type RangePreset = 'today' | 'yesterday' | 'last7' | 'week' | 'month' | 'all';
const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];
function presetRange(p: RangePreset): DateRange {
  const t = localDay();
  if (p === 'today') return { from: t, to: t };
  if (p === 'yesterday') { const y = shiftDay(t, -1); return { from: y, to: y }; }
  if (p === 'last7') return { from: shiftDay(t, -6), to: t };
  if (p === 'all') return { from: ALL_TIME_FROM, to: t };
  if (p === 'week') { const d = new Date(`${t}T12:00:00`); const back = (d.getDay() + 6) % 7; return { from: shiftDay(t, -back), to: t }; }   // Monday → today
  return { from: `${t.slice(0, 8)}01`, to: t };                                                                                          // 1st → today
}

export default function TaskOrgProgressCard({ orgId }: { orgId: string | null }) {
  const { user } = useAuth();
  // The id is taken one render late on purpose. When the user arrives (null -> id on every
  // page load) DataCacheProvider, a parent, empties the widget cache in its own effect —
  // and parent effects run AFTER this card's, so a fetch started in the same commit is
  // discarded by useWidgetData's generation check and the card would sit in loading for
  // good. Setting state here makes the request start after that clear has happened.
  const [actorId, setActorId] = useState<string | null>(null);
  useEffect(() => { setActorId(user?.id ?? null); }, [user?.id]);
  const [preset, setPreset] = useState<RangePreset>('today');
  const activePreset: RangePreset = SHOW_ORG_PROGRESS_RANGE ? preset : 'today';
  const range = presetRange(activePreset);
  const presetLabel = PRESETS.find(p => p.id === activePreset)!.label;
  const q = useWidgetData<ProgressResponse>(
    actorId ? `/api/task-manager/progress?actorId=${actorId}&from=${range.from}&to=${range.to}&carry=1` : null,
    3 * 60_000,
  );

  // No signed-in user yet = the request has not started; that is loading, not an error.
  const loading = !actorId || q.loading;
  const res = q.data;
  const ok = !!res && res.success === true && !!res.data;
  const isOrg = ok && res!.level === 3;
  const d = isOrg ? res!.data! : null;
  const metrics = d ? orgGaugeMetrics(d) : null;
  // Same string buildNavMap's tab() helper produces (it is not exported).
  const href = orgId ? `/${orgId}/dashboard?tab=tasks` : null;

  return (
    <section className="cc-card cc-taskprog" style={{ padding: '14px 16px' }}>
      <div className="cc-card-head" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap', rowGap: 6 }}>
        <span className="cc-chip cc-chip--teal"><Gauge /></span>
        <span className="cc-title">Organization Progress</span>
        <span className="cc-head-meta">
          {SHOW_ORG_PROGRESS_RANGE && (
            <select
              aria-label="Date range"
              title={rangeLabel(range)}
              value={preset}
              onChange={e => setPreset(e.target.value as RangePreset)}
              style={{
                font: 'inherit', fontWeight: 600, color: 'var(--cc-ink-2)', background: 'transparent',
                border: '1px solid var(--cc-hairline)', borderRadius: 6, padding: '2px 4px', cursor: 'pointer', maxWidth: '100%',
              }}
            >
              {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
          {!loading && isOrg && <SourceTag live />}
          {href ? <Link href={href}>Open Task Manager</Link> : null}
        </span>
      </div>

      {loading ? (
        <CardSkeleton hero lines={4} />
      ) : !ok ? (
        <CardEmpty reason={fetchErrorReason(q.error)} />
      ) : !d || !metrics ? (
        <div className="cc-kpi-off">
          <span>Organisation progress is visible to Task Manager superusers.</span>
        </div>
      ) : (
        <div className="cc-taskprog-body">
          <div className="cc-taskprog-gauge">
            <TaskProgressGauge
              orgProgress={metrics.org}
              deptProgress={metrics.dept}
              employeeProgress={metrics.employee}
              active
            />
          </div>
          <p className="cc-taskprog-foot" title={rangeLabel(range)}>
            {presetLabel} · {n(d.completed)} of {n(d.total)} tasks done · {n(d.totalDepartments)} departments
          </p>
        </div>
      )}
    </section>
  );
}
