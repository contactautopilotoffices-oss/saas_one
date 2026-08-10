'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, ListChecks, Table2, TrendingDown, Scale, Inbox, ClipboardCheck, Flag, Wallet, FileDown, Timer } from 'lucide-react';
import ElectricityBillDeadlines from '@/frontend/components/electricity/ElectricityBillDeadlines';
import ElectricityBillRegister from '@/frontend/components/electricity/ElectricityBillRegister';
import ElectricityDiscountPerformance from '@/frontend/components/electricity/ElectricityDiscountPerformance';
import ElectricityReconciliation from '@/frontend/components/electricity/ElectricityReconciliation';
import ElectricityBillInbox from '@/frontend/components/electricity/ElectricityBillInbox';
import ElectricityValidationQueue from '@/frontend/components/electricity/ElectricityValidationQueue';
import ElectricityDisputeTracker from '@/frontend/components/electricity/ElectricityDisputeTracker';
import ElectricityPaymentScenarioForm from '@/frontend/components/electricity/ElectricityPaymentScenarioForm';
import ElectricityCycleTracker from '@/frontend/components/electricity/ElectricityCycleTracker';
import { inr, type TrackerPayload } from '@/frontend/lib/electricity/trackerTypes';
import { useAuth } from '@/frontend/context/AuthContext';
import { useAppSession } from '@/frontend/hooks/useAppSession';

/**
 * Electricity Tracker — replaces "Electricity Tracker Excel.xlsx".
 *
 * The Excel sheet recorded 15 billing accounts x 7 monthly blocks of bill/due/early-
 * payment dates and amounts, and nothing ever chased the money it described: across the
 * period on file only Rs 16,497 of a possible Rs 1,70,823 early-payment discount is
 * provably captured, and the bill tracker's own May total disagrees with the AOP sheet's
 * booked actual by Rs 9.2L (15.7%) — a gap nobody could have spotted eyeballing two
 * workbooks. This tab exists to surface both, not just log dates.
 *
 * Sits inside Procurement (ProcurementModule.tsx) because procurement is the team that
 * actually pays these bills day to day; access is gated one level up, at
 * backend/lib/electricity/access.ts (super admins, master admins, accounts, procurement).
 */

type View = 'cycle' | 'deadlines' | 'register' | 'discount' | 'reconciliation' | 'inbox' | 'validation' | 'disputes' | 'payments';

const VIEWS: { key: View; label: string; icon: typeof ListChecks }[] = [
    // Cycle leads: the walkthrough is explicit that the whole pipeline "is a run against
    // time", so the countdown and the savings target are what the tab opens on.
    { key: 'cycle', label: 'Cycle & target', icon: Timer },
    { key: 'deadlines', label: 'Deadlines', icon: ListChecks },
    { key: 'register', label: 'Register', icon: Table2 },
    { key: 'inbox', label: 'Inbox', icon: Inbox },
    { key: 'validation', label: 'Validation', icon: ClipboardCheck },
    { key: 'disputes', label: 'Disputes', icon: Flag },
    { key: 'payments', label: 'Payments', icon: Wallet },
    { key: 'discount', label: 'Discount performance', icon: TrendingDown },
    { key: 'reconciliation', label: 'Reconciliation', icon: Scale },
];

interface Props {
    orgId: string;
}

export default function ElectricityTrackerTab({ orgId }: Props) {
    const { user } = useAuth();
    const { session } = useAppSession();
    // Resolved session first: user_metadata.role is null for invite-flow accounts, so
    // reading it alone mis-identifies real roles (see ProcurementModule for the same fix).
    // Mirrors the server check in app/api/electricity/targets POST — the button is hidden
    // for everyone else, but the 403 there is what actually enforces it.
    const role = (session?.role || user?.user_metadata?.role || '').toLowerCase();
    const canSetTarget = role === 'org_super_admin' || role === 'master_admin';

    const [view, setView] = useState<View>('cycle');
    const [data, setData] = useState<TrackerPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));

    const load = useCallback(async (quiet = false) => {
        if (!orgId) return;
        if (quiet) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/electricity/tracker?org_id=${orgId}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not load the electricity tracker');
            setData(payload as TrackerPayload);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the electricity tracker');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [orgId]);

    useEffect(() => { void load(); }, [load]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24 text-text-tertiary">
                <Loader2 className="w-6 h-6 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">{error}</p>
                <button onClick={() => void load()} className="mt-3 text-xs font-bold text-primary">Try again</button>
            </div>
        );
    }

    if (!data?.provisioned) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-10 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">The electricity tracker is not set up yet</p>
                <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                    {data?.reason || 'Apply supabase/migrations/20260802000002_electricity_bills.sql, then run node scripts/import_electricity_bills.js --commit to load the workbook.'}
                </p>
            </div>
        );
    }

    if (data.months.length === 0) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-10 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">No bills imported yet</p>
                <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                    The tables exist but hold no bills. Run node scripts/import_electricity_bills.js --commit
                    to load &ldquo;Electricity Tracker Excel.xlsx&rdquo;.
                </p>
            </div>
        );
    }

    const risk = data.deadlines.money_at_risk;
    const flagged = data.reconciliation.rows.filter(r => r.flagged).length;

    return (
        <div className="space-y-4">
            {/* ---- Header --------------------------------------------------------- */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">Electricity Tracker</p>
                    <h1 className="text-xl lg:text-2xl font-bold text-text-primary">Bills, discounts &amp; reconciliation</h1>
                    <p className="text-xs font-semibold text-text-tertiary mt-0.5">
                        {data.accounts.length} billing accounts · {inr(risk.discount_at_risk, true)} discount at risk
                        {flagged > 0 && <span style={{ color: 'var(--error)' }}> · {flagged} month{flagged === 1 ? '' : 's'} off-book by &gt;5%</span>}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {/* The report month is NOT a data filter — it only picks which month's PDF
                        to generate. It used to sit as a bare month input beside the views'
                        own month filters, which read as a second, contradictory filter.
                        Grouping it inside the download control makes its scope obvious. */}
                    <div className="flex items-stretch rounded-xl border border-border overflow-hidden">
                        <label className="flex items-center gap-1.5 pl-3 pr-2 bg-muted/60 text-[10px] font-black uppercase tracking-wider text-text-tertiary">
                            Report
                            <input
                                type="month"
                                value={reportMonth}
                                onChange={e => setReportMonth(e.target.value)}
                                aria-label="Month to generate the PDF report for"
                                className="bg-transparent py-1.5 text-[11px] font-bold text-text-primary outline-none normal-case tracking-normal"
                            />
                        </label>
                        <a
                            href={`/api/electricity/report?org_id=${orgId}&month=${reportMonth}`}
                            className="flex items-center gap-1.5 px-3 text-xs font-bold text-text-secondary hover:text-text-primary hover:bg-muted transition-colors border-l border-border"
                        >
                            <FileDown className="w-4 h-4" /> Download
                        </a>
                    </div>
                    <button
                        onClick={() => void load(true)}
                        className="p-2 rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                        aria-label="Refresh"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* ---- Segmented control ------------------------------------------------ */}
            <div className="inline-flex flex-wrap items-center gap-1 bg-muted p-1 rounded-2xl">
                {VIEWS.map(v => (
                    <button
                        key={v.key}
                        onClick={() => setView(v.key)}
                        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                            view === v.key ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                        }`}
                    >
                        <v.icon className="w-3.5 h-3.5" />
                        {v.label}
                        {v.key === 'reconciliation' && flagged > 0 && (
                            <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black"
                                style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--error)' }}>
                                {flagged}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* ---- Sub-view ----------------------------------------------------------- */}
            {view === 'cycle' && <ElectricityCycleTracker orgId={orgId} canSetTarget={canSetTarget} />}

            {view === 'deadlines' && <ElectricityBillDeadlines deadlines={data.deadlines} />}

            {view === 'register' && (
                <ElectricityBillRegister
                    orgId={orgId}
                    rows={data.register.rows}
                    accounts={data.accounts}
                    months={data.months}
                    onCommitted={() => void load(true)}
                />
            )}

            {view === 'discount' && <ElectricityDiscountPerformance performance={data.discount_performance} />}

            {view === 'reconciliation' && (
                <ElectricityReconciliation
                    orgId={orgId}
                    reconciliation={data.reconciliation}
                    bills={data.register.rows}
                />
            )}

            {view === 'inbox' && <ElectricityBillInbox orgId={orgId} accounts={data.accounts} />}

            {view === 'validation' && <ElectricityValidationQueue orgId={orgId} />}

            {view === 'disputes' && <ElectricityDisputeTracker orgId={orgId} />}

            {view === 'payments' && <ElectricityPaymentScenarioForm orgId={orgId} />}
        </div>
    );
}
