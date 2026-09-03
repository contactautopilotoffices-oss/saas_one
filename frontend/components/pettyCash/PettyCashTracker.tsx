'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Building2, Phone, AlertTriangle } from 'lucide-react';
import { inr, PettyCashReconciliation } from '@/frontend/lib/pettyCash/roles';

/**
 * "What has gone out to this site, to whom, and did it come back accounted for."
 *
 * PRD §9's Pending Settlement and Employee-Wise Advance reports. Reads
 * /api/petty-cash/tracker, which aggregates petty_cash_settlement_status — so every
 * figure here is the same reconciliation the settlement drawer and the open-advance
 * gate use, never a second calculation that could disagree with them.
 */

interface Bucket {
    property_id?: string;
    property_name?: string;
    name?: string;
    phone?: string | null;
    requests: number;
    disbursed: number;
    accounted: number;
    unaccounted: number;
    open_count: number;
}

interface TrackerResponse {
    provisioned: boolean;
    rows: (PettyCashReconciliation & { property_name?: string | null })[];
    by_property: Bucket[];
    by_custodian: Bucket[];
    totals: {
        requests: number; disbursed: number; accounted: number; unaccounted: number;
        open_count: number; overdue_count: number; accounted_pct: number | null;
    } | null;
}

const pct = (b: Bucket) => (b.disbursed > 0 ? Math.round((b.accounted / b.disbursed) * 1000) / 10 : null);

function Bar({ value }: { value: number | null }) {
    const v = Math.min(100, Math.max(0, value ?? 0));
    return (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className={v >= 99.5 ? 'h-full bg-emerald-500' : 'h-full bg-amber-500'} style={{ width: `${v}%` }} />
        </div>
    );
}

export default function PettyCashTracker({ propertyId }: { propertyId?: string }) {
    const [data, setData] = useState<TrackerResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const qs = propertyId ? `?property_id=${propertyId}` : '';
            const res = await fetch(`/api/petty-cash/tracker${qs}`);
            if (!res.ok) throw new Error('Could not load the tracker');
            setData(await res.json());
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the tracker'); }
        finally { setLoading(false); }
    }, [propertyId]);

    useEffect(() => { load(); }, [load]);

    if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-text-tertiary" /></div>;
    if (error) return <p className="text-sm text-red-600 py-8 text-center">{error}</p>;
    if (!data) return null;

    if (!data.provisioned) {
        return (
            <div className="text-center py-16">
                <p className="text-sm font-bold text-text-primary">Tracker not set up yet</p>
                <p className="text-xs text-text-tertiary mt-1">
                    Apply migration 20260903000001_petty_cash_ledger.sql to enable petty cash reconciliation.
                </p>
            </div>
        );
    }

    const t = data.totals;

    return (
        <div className="space-y-6">
            {/* Portfolio position */}
            {t && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                        { label: 'Disbursed', value: inr(t.disbursed), sub: `${t.requests} request${t.requests === 1 ? '' : 's'}` },
                        { label: 'Accounted for', value: t.accounted_pct == null ? '—' : `${t.accounted_pct}%`, sub: inr(t.accounted) },
                        { label: 'Unaccounted', value: inr(t.unaccounted), sub: 'no bills or return yet', warn: t.unaccounted > 0 },
                        { label: 'Open advances', value: String(t.open_count), sub: `${t.overdue_count} over 7 days`, warn: t.overdue_count > 0 },
                    ].map(c => (
                        <div key={c.label} className="bg-surface-elevated rounded-xl p-3 border border-border">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary">{c.label}</p>
                            <p className={`text-xl font-black mt-0.5 tabular-nums ${c.warn ? 'text-amber-600' : 'text-text-primary'}`}>{c.value}</p>
                            <p className="text-[11px] text-text-tertiary mt-0.5">{c.sub}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* By site */}
            <div>
                <p className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">By property</p>
                <div className="space-y-1.5">
                    {data.by_property.map(b => (
                        <div key={b.property_id} className="bg-surface-elevated rounded-xl px-3 py-2.5 border border-border">
                            <div className="flex items-center justify-between gap-3 mb-1.5">
                                <span className="flex items-center gap-2 text-sm font-semibold text-text-primary min-w-0">
                                    <Building2 className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                                    <span className="truncate">{b.property_name}</span>
                                </span>
                                <span className="text-xs tabular-nums text-text-secondary shrink-0">
                                    {inr(b.disbursed)}
                                    {b.unaccounted > 0 && <span className="text-amber-600 font-bold"> · {inr(b.unaccounted)} open</span>}
                                </span>
                            </div>
                            <Bar value={pct(b)} />
                        </div>
                    ))}
                    {!data.by_property.length && <p className="text-sm text-text-tertiary py-6 text-center">No petty cash movement yet.</p>}
                </div>
            </div>

            {/* Who is holding the cash */}
            <div>
                <p className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">By custodian</p>
                <div className="space-y-1.5">
                    {data.by_custodian.map(b => (
                        <div key={b.name} className="bg-surface-elevated rounded-xl px-3 py-2.5 border border-border">
                            <div className="flex items-center justify-between gap-3 mb-1.5">
                                <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-text-primary truncate">{b.name}</span>
                                    {b.phone && (
                                        <a href={`tel:${b.phone}`} className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-primary">
                                            <Phone className="w-3 h-3" /> {b.phone}
                                        </a>
                                    )}
                                </span>
                                <span className="text-xs tabular-nums text-text-secondary shrink-0 text-right">
                                    <span className="block">{inr(b.disbursed)}</span>
                                    {b.unaccounted > 0 && (
                                        <span className="inline-flex items-center gap-1 text-amber-600 font-bold">
                                            <AlertTriangle className="w-3 h-3" /> {inr(b.unaccounted)} open
                                        </span>
                                    )}
                                </span>
                            </div>
                            <Bar value={pct(b)} />
                        </div>
                    ))}
                    {!data.by_custodian.length && <p className="text-sm text-text-tertiary py-6 text-center">No custodians recorded yet.</p>}
                </div>
            </div>
        </div>
    );
}
