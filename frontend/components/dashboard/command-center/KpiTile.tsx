'use client';

import React, { useId } from 'react';
import Link from 'next/link';
import SourceTag from './SourceTag';
import { CardSkeleton, CardEmpty, fetchErrorReason } from './CardStates';

/**
 * One "At a glance" KPI tile (docs/COMMAND_CENTER_KPI_PLAN.md): chip icon, title, LIVE tag, then 2–4 figures with a
 * small label each, and an optional one-line footnote. The whole tile is one link to its module.
 *
 * States, decided by the caller and passed as `state`:
 *   loading      -> CardSkeleton
 *   error        -> CardEmpty with fetchErrorReason(error)
 *   unprovisioned-> muted "Not set up" (+ optional reason)
 *   live         -> the figures
 *
 * Styles: .cc-kpi-* in app/globals.css; the card chrome, hover lift and chip are the board's own .cc-card / .cc-chip.
 */

export type KpiTone = 'good' | 'bad';

export type KpiStat = {
  label: string;
  /** Already formatted (en-IN digits, units). */
  value: string;
  tone?: KpiTone;
};

export type KpiTileState =
  | { kind: 'loading' }
  | { kind: 'error'; error: string | null }
  | { kind: 'unprovisioned'; reason?: string }
  | { kind: 'live'; stats: KpiStat[]; footnote?: string };

/** Integer counts in Indian digit grouping. */
export function kpiCount(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-IN') : '—';
}

export default function KpiTile({
  title,
  icon,
  chipClass,
  href,
  state,
}: {
  title: string;
  icon: React.ReactNode;
  /** One of the board's chip tints, e.g. 'cc-chip--blue'. */
  chipClass: string;
  /** Null while the org is not known yet: the tile renders without a link. */
  href: string | null;
  state: KpiTileState;
}) {
  const bodyId = useId();

  const body = (() => {
    switch (state.kind) {
      case 'loading':
        return <CardSkeleton lines={2} />;
      case 'error':
        return <CardEmpty reason={fetchErrorReason(state.error)} />;
      case 'unprovisioned':
        return (
          <div className="cc-kpi-off">
            <strong>Not set up</strong>
            {state.reason ? <span>{state.reason}</span> : null}
          </div>
        );
      case 'live':
        return (
          <>
            <dl className="cc-kpi-stats" style={{ ['--cc-kpi-n' as string]: state.stats.length }}>
              {state.stats.map((s) => (
                // dt before dd (valid <dl>, read as "label, value"); CSS shows the figure on top.
                <div key={s.label} className="cc-kpi-stat">
                  <dt className="cc-kpi-label">{s.label}</dt>
                  <dd className="cc-kpi-val" data-tone={s.tone}>{s.value}</dd>
                </div>
              ))}
            </dl>
            {state.footnote ? <p className="cc-kpi-foot">{state.footnote}</p> : null}
          </>
        );
    }
  })();

  const inner = (
    <>
      <div className="cc-card-head">
        <span className={`cc-chip ${chipClass}`} aria-hidden>{icon}</span>
        <span className="cc-title">{title}</span>
        <span className="cc-head-meta">{state.kind === 'live' ? <SourceTag live /> : null}</span>
      </div>
      <div id={bodyId} className="cc-kpi-body">{body}</div>
    </>
  );

  if (!href) {
    return <section className="cc-card cc-kpi" aria-label={title}>{inner}</section>;
  }
  return (
    <Link href={href} className="cc-card cc-kpi" aria-label={title} aria-describedby={bodyId}>
      {inner}
    </Link>
  );
}
