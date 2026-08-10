'use client';

import React, { useEffect } from 'react';
import type { WidgetProps } from '@/frontend/lib/dashboard/types';
import { useWidgetData, inr } from '@/frontend/lib/dashboard/useWidgetData';
import { Metric, Delta, ProgressBar, RankRow, WidgetEmpty, WidgetSetup, WidgetSkeleton } from './WidgetShell';

/**
 * AOP Budget vs Actual — the internal spend hub.
 *
 * Story: "Are we inside the operating plan this month, and which site is bleeding?"
 *
 * The headline is utilisation (actual as a share of budget) rather than raw spend, because
 * raw spend alone cannot be judged — Rs 1.67cr is excellent against a Rs 1.87cr plan and
 * alarming against Rs 1.2cr. Cleveland & McGill put position-along-a-common-scale above
 * angle for quantitative comparison, so budget consumption is a bar, never a donut.
 */

interface Roll {
    month: string; budget: number; actual: number; saving: number;
    utilisation_pct: number | null; cost_per_seat: number | null;
    sites_total: number; sites_over_budget: number;
}

interface Payload {
    provisioned: boolean;
    current: Roll | null;
    previous: Roll | null;
    trend: { actual_delta_pct: number | null; sites_over_budget_delta: number } | null;
    overspending: Array<{ site_id: string; site_name: string; overspend: number; overspend_pct: number | null }>;
    categories: Array<{ code: string; name: string; budget: number; actual: number; saving: number }>;
    warnings: Array<{ id: string; severity: string; message: string }>;
}

const monthLabel = (m: string) =>
    new Date(m + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function AopSpendWidget({ orgId, size, onSeverity, onHeadline, onFetchedAt }: WidgetProps) {
    const { data, loading, error, fetchedAt } = useWidgetData<Payload>(
        orgId ? `/api/aop/summary?org_id=${orgId}` : null, 5 * 60_000);

    const cur = data?.current ?? null;
    const overspend = cur ? Math.max(0, -cur.saving) : 0;


    useEffect(() => { onFetchedAt?.(fetchedAt); }, [fetchedAt, onFetchedAt]);
    useEffect(() => {
        if (!data?.provisioned || !cur) { onSeverity('ok'); onHeadline?.(null); return; }

        // Bands are wide on purpose. Ops budgets routinely run a few per cent either side of
        // plan; alarming at 101% would make this light meaningless within a week.
        const u = cur.utilisation_pct ?? 0;
        const sev = u >= 110 ? 'critical' : u >= 100 ? 'warn' : cur.sites_over_budget > 0 ? 'info' : 'ok';
        onSeverity(data.warnings?.length ? (sev === 'ok' ? 'info' : sev) : sev);

        onHeadline?.(
            overspend > 0
                ? `${inr(overspend, { compact: true })} over plan · ${cur.sites_over_budget} of ${cur.sites_total} sites over budget.`
                : `${inr(cur.saving, { compact: true })} under plan across ${cur.sites_total} sites.`,
        );
    }, [data, cur, overspend, onSeverity, onHeadline]);

    if (loading) return <WidgetSkeleton />;
    if (error === 'forbidden') return null;
    if (!data?.provisioned) {
        return <WidgetSetup label="Not connected yet" hint="Apply the AOP migration, then run the import." />;
    }
    if (!cur) return <WidgetEmpty>No budget data imported yet.</WidgetEmpty>;

    const util = cur.utilisation_pct ?? 0;
    const tone = util >= 100 ? 'danger' : util >= 92 ? 'warn' : 'success';

    // sm — one question: are we inside the plan?
    if (size === 'sm') {
        return (
            <div className="h-full flex flex-col justify-between">
                <Metric value={`${util.toFixed(0)}%`} sub="of budget used" size="sm" />
                <ProgressBar pct={util} tone={tone} />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col min-h-0">
            <div className="flex items-end justify-between gap-2">
                <Metric value={inr(cur.actual, { compact: true })} sub={`of ${inr(cur.budget, { compact: true })} · ${monthLabel(cur.month)}`} size={size} />
                <Delta pct={data.trend?.actual_delta_pct} higherIsBetter={false} />
            </div>

            <div className="mt-2.5">
                <ProgressBar pct={util} tone={tone} />
                <div className="flex justify-between mt-1">
                    <span className="text-[10px] font-bold text-text-tertiary">{util.toFixed(1)}% used</span>
                    <span className="text-[10px] font-bold" style={{ color: overspend > 0 ? 'var(--error)' : 'var(--success)' }}>
                        {overspend > 0 ? `${inr(overspend, { compact: true })} over` : `${inr(cur.saving, { compact: true })} under`}
                    </span>
                </div>
            </div>

            {(size === 'lg' || size === 'xl') && (
                <div className="mt-3 flex-1 min-h-0 overflow-hidden">
                    <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                        Sites over budget
                    </p>
                    {data.overspending.length === 0 ? (
                        <p className="text-[11px] font-semibold text-text-tertiary">Every site is inside plan.</p>
                    ) : (
                        <div className="divide-y divide-border-subtle">
                            {data.overspending.slice(0, size === 'xl' ? 5 : 3).map(s => (
                                <RankRow
                                    key={s.site_id}
                                    label={s.site_name}
                                    hint={s.overspend_pct !== null ? `${s.overspend_pct.toFixed(0)}%` : undefined}
                                    value={inr(s.overspend, { compact: true })}
                                    tone="danger"
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {size === 'xl' && data.categories.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border-subtle">
                    <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                        Categories driving it
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {data.categories.filter(c => c.saving < 0).slice(0, 6).map(c => (
                            <span key={c.code}
                                className="px-2 py-0.5 rounded-lg bg-[var(--error)]/10 text-[10px] font-bold text-[var(--error)]">
                                {c.name} {inr(-c.saving, { compact: true })}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {data.warnings?.length > 0 && (
                <p className="mt-2 text-[10px] font-semibold text-[var(--warning)] line-clamp-2">
                    {data.warnings.length} import warning{data.warnings.length === 1 ? '' : 's'} — figures may be misfiled.
                </p>
            )}
        </div>
    );
}
