'use client';

import React from 'react';
import Link from 'next/link';
import { Gauge } from 'lucide-react';
import { useWidgetData } from '@/frontend/lib/dashboard/useWidgetData';
import { LEVEL_COLORS } from '@/frontend/components/org-efficiency/levelPalette';
import { buildNavMap } from './navMap';
import SourceTag from './SourceTag';
import { CardSkeleton, CardEmpty, fetchErrorReason } from './CardStates';

/**
 * ORGANIZATION PROGRESS — a glance at the Org Efficiency Meter, not a second copy of it.
 *
 * Source: /api/org-efficiency/meter?orgId= — the same endpoint OrgProgressTracker reads.
 * Everything shown here is a field the route already computed; no scoring, weighting or
 * pace logic is reimplemented. The full tracker (filters, editable weights, simulate mode,
 * the goal drill-in) stays where it is and the card links to it.
 *
 * ONE NUMBER DELIBERATELY DIFFERS FROM THE TRACKER, so say so on the card: the route's
 * `overall_progress` is the plain mean of the levels that have a measurement, while the
 * tracker re-weights those levels with per-user weights it keeps in localStorage. A glance
 * card has no business carrying someone's private weighting, so it shows the unweighted
 * figure and labels it — otherwise the two screens disagree and look broken.
 *
 * Unmeasured levels are drawn as an empty track, never as 0%. A level with no fresh
 * measurement has not scored zero; it has not reported.
 */

/* Payload shape of app/api/org-efficiency/meter. Kept beside the reader, the way
   AgentActivityCard owns the agents-summary shapes — change both together. */
type OemLevelKey = 'agent' | 'employee' | 'department' | 'tech' | 'org';

interface OemMeterLevel {
  level: OemLevelKey;
  goal_count: number;
  measured_count: number;
  progress_pct: number | null;
}

export interface OemMeterPayload {
  overall_progress: number | null;
  levels: OemMeterLevel[];
  counts: {
    total_goals: number;
    completing: number;
    behind: number;
    not_in_chain: number;
  };
}

/** Innermost -> outermost, matching the full dial's ring order. */
const LEVEL_ORDER: OemLevelKey[] = ['agent', 'employee', 'department', 'tech', 'org'];

const LEVEL_LABEL: Record<OemLevelKey, string> = {
  agent: 'Agent',
  employee: 'Employee',
  department: 'Department',
  tech: 'Tech',
  org: 'Organization',
};

/* --- Mini dial ------------------------------------------------------------------
   A 5-ring semicircle at card scale. The full-size ConcentricDial instrument this was
   derived from is deleted (1000x544 on a dark bezel with pointer arms, a linkage polyline
   and drag handles, none of which survive being shrunk to 130px). Only its geometry
   convention is kept — 0% at 180deg (left), 100% at 0deg (right), agent innermost — so
   this and the radar sweep the same way, and the palette is imported from
   ../../org-efficiency/levelPalette rather than restated. */
const VB_W = 132;
const VB_H = 70;
const CX = 66;
const CY = 64;
const R_INNER = 21;
const R_STEP = 9;
const BAND = 5;

function polar(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}

const angleOf = (v: number) => 180 - (Math.max(0, Math.min(100, v)) / 100) * 180;

function arcPath(r: number, value: number): string {
  const v = Math.max(0, Math.min(100, value));
  if (v <= 0.01) return '';
  const start = polar(r, 180);
  const end = polar(r, angleOf(v));
  // The sweep from 0% never exceeds 180deg, so large-arc-flag stays 0.
  return `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`;
}

function MiniDial({ levels, overall }: { levels: OemMeterLevel[]; overall: number | null }) {
  const byLevel = new Map(levels.map((l) => [l.level, l]));
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={132}
      height={70}
      role="img"
      aria-label={
        `Organization progress dial. Overall ${overall == null ? 'not measured' : `${overall}%`}. ` +
        LEVEL_ORDER.map((k) => {
          const l = byLevel.get(k);
          return `${LEVEL_LABEL[k]} ${l?.progress_pct == null ? 'not measured' : `${l.progress_pct}%`}`;
        }).join(', ') + '.'
      }
    >
      {LEVEL_ORDER.map((key, i) => {
        const r = R_INNER + i * R_STEP;
        const pct = byLevel.get(key)?.progress_pct ?? null;
        return (
          <g key={key}>
            <path
              d={arcPath(r, 100)}
              fill="none"
              stroke="rgba(30,42,48,0.08)"
              strokeWidth={BAND}
              strokeLinecap="round"
            />
            {pct != null && (
              <path
                d={arcPath(r, pct)}
                fill="none"
                stroke={LEVEL_COLORS[key]}
                strokeWidth={BAND}
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function OrgProgressCard({ orgId }: { orgId: string | null }) {
  const q = useWidgetData<OemMeterPayload>(
    orgId ? `/api/org-efficiency/meter?orgId=${orgId}` : null, 5 * 60_000);

  // orgId lands after the host's async org fetch, so treat "scope not known yet" as
  // loading rather than flashing an error for a fetch that was never started.
  const loading = !orgId || q.loading;
  const m = q.data && Array.isArray(q.data.levels) ? q.data : null;
  const live = !!m;
  const href = orgId ? buildNavMap(orgId).cardLinks.orgProgress : null;

  const counts = m?.counts;
  const measuredLevels = m ? m.levels.filter((l) => l.progress_pct != null).length : 0;

  return (
    <section className="cc-card" style={{ gridColumn: 'span 2', padding: '14px 16px' }}>
      <div className="cc-card-head" style={{ marginBottom: 10, gap: 8 }}>
        <span className="cc-chip cc-chip--teal">
          <Gauge />
        </span>
        <span className="cc-title">Organization Progress</span>
        <span className="cc-head-meta">
          {/* Tag only when the feed answered. This card has no mock fallback, so an amber
              "Demo" beside its empty state would claim invented numbers are on screen when
              none are — the empty state already says what went wrong. A green "Live" over
              "no goals yet" is still correct: the emptiness is itself a live fact. */}
          {!loading && live && <SourceTag live />}
          {href ? <Link href={href}>Open tracker</Link> : null}
        </span>
      </div>

      {loading ? (
        <CardSkeleton hero lines={4} />
      ) : !m ? (
        <CardEmpty reason={fetchErrorReason(q.error)} />
      ) : counts && counts.total_goals === 0 ? (
        <CardEmpty reason="No active goals are defined for this organisation yet." />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ flex: 'none' }}>
              <MiniDial levels={m.levels} overall={m.overall_progress} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="cc-metric">
                {m.overall_progress == null ? '—' : m.overall_progress}
                {m.overall_progress == null ? null : <small>%</small>}
              </span>
              <div className="cc-sub" style={{ marginTop: 4 }}>
                {m.overall_progress == null
                  ? `No level has a fresh measurement across ${counts?.total_goals ?? 0} active goals.`
                  : `Mean of ${measuredLevels} measured level${measuredLevels === 1 ? '' : 's'}, over ${counts?.total_goals ?? 0} active goals.`}
              </div>
              <div className="cc-sub" style={{ marginTop: 4, fontSize: 10, color: 'var(--cc-ink-3)' }}>
                Unweighted — the tracker applies your own level weights.
              </div>
            </div>

            {/* Level legend: the dial's rings, named, so a colour is never the only key. */}
            <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 2 }}>
              {[...LEVEL_ORDER].reverse().map((key) => {
                const l = m.levels.find((x) => x.level === key);
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                    <span
                      style={{
                        width: 8, height: 8, borderRadius: 2, flex: 'none',
                        background: LEVEL_COLORS[key],
                      }}
                    />
                    <span style={{ width: 74, fontWeight: 500, color: 'var(--cc-ink-2)' }}>
                      {LEVEL_LABEL[key]}
                    </span>
                    <span
                      style={{
                        width: 30, textAlign: 'right', fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        color: l?.progress_pct == null ? 'var(--cc-ink-3)' : 'var(--cc-ink)',
                      }}
                    >
                      {l?.progress_pct == null ? '—' : `${l.progress_pct}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {counts && (
            <div className="cc-statstrip" style={{ marginTop: 12 }}>
              <div className="cc-stat cc-stat--green">
                <span className="cc-stat-val">{counts.completing}</span>
                <span className="cc-stat-label">On pace</span>
              </div>
              <div className="cc-stat cc-stat--red">
                <span className="cc-stat-val">{counts.behind}</span>
                <span className="cc-stat-label">Behind pace</span>
              </div>
              <div className="cc-stat cc-stat--amber">
                <span className="cc-stat-val">{counts.not_in_chain}</span>
                <span className="cc-stat-label">No fresh measurement</span>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
