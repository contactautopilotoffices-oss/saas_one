'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
    DollarSign, Plus, Trash2, Loader2, AlertCircle, CheckCircle2,
    Calendar, TrendingUp, TrendingDown,
} from 'lucide-react';

interface Campaign {
    id: string;
    name: string;
    status: string;
    channel: string | null;
    budget_total: number | null;
    budget_period: string | null;
    start_date: string | null;
    end_date: string | null;
}

interface SpendRow {
    id: string;
    campaign_id: string;
    spend_date: string;
    amount: number;
    source: string;
    notes: string | null;
    created_at: string;
}

export default function CampaignSpendManager({ orgId }: { orgId: string }) {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [rows, setRows] = useState<SpendRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingRows, setIsLoadingRows] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // New-spend form state
    const [spendDate, setSpendDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [spendAmount, setSpendAmount] = useState('');
    const [spendNotes, setSpendNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Budget-edit state
    const [budget, setBudget] = useState('');
    const [budgetPeriod, setBudgetPeriod] = useState<'monthly' | 'quarterly' | 'one_time'>('monthly');
    const [channel, setChannel] = useState<string>('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [isSavingBudget, setIsSavingBudget] = useState(false);

    const q = useCallback((path: string) => `${path}${path.includes('?') ? '&' : '?'}org_id=${orgId}`, [orgId]);

    // Load campaigns
    useEffect(() => {
        (async () => {
            setIsLoading(true);
            try {
                const res = await fetch(q('/api/crm/campaigns'));
                if (res.ok) {
                    const data = await res.json();
                    const list: Campaign[] = data.campaigns || [];
                    setCampaigns(list);
                    if (list.length > 0) setSelectedId(list[0].id);
                }
            } catch {
                setError('Failed to load campaigns');
            } finally {
                setIsLoading(false);
            }
        })();
    }, [q]);

    const selectedCampaign = campaigns.find((c) => c.id === selectedId) || null;

    // Sync budget-edit state with the selected campaign
    useEffect(() => {
        if (!selectedCampaign) return;
        setBudget(String(selectedCampaign.budget_total || ''));
        setBudgetPeriod((selectedCampaign.budget_period as any) || 'monthly');
        setChannel(selectedCampaign.channel || '');
        setStartDate(selectedCampaign.start_date || '');
        setEndDate(selectedCampaign.end_date || '');
    }, [selectedCampaign]);

    // Load spend rows for the selected campaign
    useEffect(() => {
        if (!selectedId) return;
        let cancelled = false;
        (async () => {
            setIsLoadingRows(true);
            const res = await fetch(q(`/api/crm/campaigns/spend?campaign_id=${selectedId}`));
            if (!cancelled) {
                if (res.ok) {
                    const data = await res.json();
                    setRows(data.rows || []);
                } else {
                    setRows([]);
                }
                setIsLoadingRows(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedId, q]);

    const submitSpend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedId || !spendAmount) return;
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await fetch('/api/crm/campaigns/spend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaign_id: selectedId,
                    spend_date: spendDate,
                    amount: Number(spendAmount),
                    source: 'manual',
                    notes: spendNotes || null,
                }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j.error || 'Failed to log spend');
            }
            const { row } = await res.json();
            setRows((prev) => [row, ...prev]);
            setSpendAmount('');
            setSpendNotes('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    const deleteSpend = async (id: string) => {
        if (!confirm('Delete this spend entry?')) return;
        const res = await fetch(`/api/crm/campaigns/spend/${id}`, { method: 'DELETE' });
        if (res.ok) {
            setRows((prev) => prev.filter((r) => r.id !== id));
        } else {
            const j = await res.json().catch(() => ({}));
            setError(j.error || 'Delete failed');
        }
    };

    const saveBudget = async () => {
        if (!selectedId) return;
        setIsSavingBudget(true);
        setError(null);
        try {
            const res = await fetch(`/api/crm/campaigns/${selectedId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channel: channel || null,
                    budget_total: budget ? Number(budget) : 0,
                    budget_period: budgetPeriod,
                    start_date: startDate || null,
                    end_date: endDate || null,
                }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j.error || 'Failed to save');
            }
            // Refresh campaigns
            const cRes = await fetch(q('/api/crm/campaigns'));
            if (cRes.ok) {
                const data = await cRes.json();
                setCampaigns(data.campaigns || []);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed');
        } finally {
            setIsSavingBudget(false);
        }
    };

    // Aggregates for the selected campaign
    const totalLogged = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const budgetTotal = selectedCampaign?.budget_total ? Number(selectedCampaign.budget_total) : 0;
    const remaining = budgetTotal > 0 ? budgetTotal - totalLogged : 0;
    const utilization = budgetTotal > 0 ? Math.min(100, (totalLogged / budgetTotal) * 100) : 0;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
                {/* Campaign list */}
                <div className="rounded-2xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3">
                        <h3 className="text-sm font-semibold text-text-primary">
                            Campaigns ({campaigns.length})
                        </h3>
                    </div>
                    <div className="max-h-[600px] overflow-y-auto">
                        {campaigns.length === 0 ? (
                            <div className="p-6 text-center text-sm text-text-secondary">
                                No campaigns yet. Create one from the Campaigns page first.
                            </div>
                        ) : (
                            campaigns.map((c) => (
                                <button
                                    key={c.id}
                                    onClick={() => setSelectedId(c.id)}
                                    className={`w-full border-b border-slate-100 p-3 text-left transition-colors hover:bg-slate-50 ${
                                        selectedId === c.id ? 'bg-primary/5' : ''
                                    }`}
                                >
                                    <div className="text-sm font-medium text-text-primary truncate">
                                        {c.name}
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-2 text-xs text-text-secondary">
                                        {c.channel && (
                                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase font-semibold">
                                                {c.channel}
                                            </span>
                                        )}
                                        {c.budget_total ? (
                                            <span>{formatCurrency(c.budget_total)} budget</span>
                                        ) : (
                                            <span className="text-text-tertiary">No budget set</span>
                                        )}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Detail */}
                <div className="space-y-4">
                    {!selectedCampaign ? (
                        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
                            <DollarSign className="h-8 w-8 text-text-tertiary" />
                            <p className="mt-2 text-sm text-text-secondary">
                                Select a campaign on the left to manage its budget and spend log.
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Budget card */}
                            <div className="rounded-2xl border border-slate-200 bg-white p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h3 className="text-base font-bold text-text-primary">
                                            {selectedCampaign.name}
                                        </h3>
                                        <p className="text-xs text-text-secondary">
                                            Channel: <span className="font-semibold">{selectedCampaign.channel || 'Not set'}</span>
                                            {selectedCampaign.start_date && (
                                                <> · {formatDate(selectedCampaign.start_date)} → {formatDate(selectedCampaign.end_date || selectedCampaign.start_date)}</>
                                            )}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-text-secondary">Logged vs Budget</div>
                                        <div className="text-xl font-bold text-text-primary">
                                            {formatCurrency(totalLogged)}
                                            <span className="text-sm font-normal text-text-secondary"> / {formatCurrency(budgetTotal)}</span>
                                        </div>
                                        {budgetTotal > 0 && (
                                            <div className={`text-xs font-semibold mt-0.5 ${remaining < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                {remaining < 0
                                                    ? <span className="flex items-center gap-1 justify-end"><TrendingUp className="h-3 w-3" /> {formatCurrency(Math.abs(remaining))} over budget</span>
                                                    : <span className="flex items-center gap-1 justify-end"><TrendingDown className="h-3 w-3" /> {formatCurrency(remaining)} remaining</span>
                                                }
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {budgetTotal > 0 && (
                                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                        <div
                                            className={`h-full transition-all ${utilization >= 100 ? 'bg-red-500' : utilization >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                            style={{ width: `${utilization}%` }}
                                        />
                                    </div>
                                )}

                                {/* Budget edit */}
                                <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3 border-t border-slate-100 pt-4">
                                    <div>
                                        <label className="block text-[10px] font-semibold text-text-secondary uppercase mb-1">Channel</label>
                                        <select
                                            value={channel}
                                            onChange={(e) => setChannel(e.target.value)}
                                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                        >
                                            <option value="">— Set —</option>
                                            <option value="meta_ads">Meta Ads</option>
                                            <option value="google_ads">Google Ads</option>
                                            <option value="whatsapp">WhatsApp</option>
                                            <option value="email">Email</option>
                                            <option value="referral">Referral</option>
                                            <option value="organic">Organic</option>
                                            <option value="manual">Manual</option>
                                            <option value="other">Other</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-semibold text-text-secondary uppercase mb-1">Budget (₹)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={budget}
                                            onChange={(e) => setBudget(e.target.value)}
                                            placeholder="0"
                                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-semibold text-text-secondary uppercase mb-1">Period</label>
                                        <select
                                            value={budgetPeriod}
                                            onChange={(e) => setBudgetPeriod(e.target.value as any)}
                                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                        >
                                            <option value="monthly">Monthly</option>
                                            <option value="quarterly">Quarterly</option>
                                            <option value="one_time">One-time</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-semibold text-text-secondary uppercase mb-1">Start date</label>
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={(e) => setStartDate(e.target.value)}
                                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-semibold text-text-secondary uppercase mb-1">End date</label>
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="mt-3 flex justify-end">
                                    <button
                                        onClick={saveBudget}
                                        disabled={isSavingBudget}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                                    >
                                        {isSavingBudget && <Loader2 className="h-3 w-3 animate-spin" />}
                                        Save budget & channel
                                    </button>
                                </div>
                            </div>

                            {/* Log spend */}
                            <div className="rounded-2xl border border-slate-200 bg-white p-5">
                                <h4 className="text-sm font-semibold text-text-primary">Log a spend entry</h4>
                                <p className="text-xs text-text-secondary">
                                    Add individual spend entries as the campaign runs. The report aggregates these for ROI calculations.
                                </p>
                                <form onSubmit={submitSpend} className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
                                    <div>
                                        <label className="block text-[10px] font-semibold text-text-secondary uppercase mb-1">Date</label>
                                        <input
                                            type="date"
                                            required
                                            value={spendDate}
                                            onChange={(e) => setSpendDate(e.target.value)}
                                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-semibold text-text-secondary uppercase mb-1">Amount (₹)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            required
                                            value={spendAmount}
                                            onChange={(e) => setSpendAmount(e.target.value)}
                                            placeholder="0"
                                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-semibold text-text-secondary uppercase mb-1">Notes (optional)</label>
                                        <input
                                            type="text"
                                            value={spendNotes}
                                            onChange={(e) => setSpendNotes(e.target.value)}
                                            placeholder="e.g. Diwali boost — Bangalore"
                                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                                        />
                                    </div>
                                    <div className="md:col-span-4 flex justify-end">
                                        <button
                                            type="submit"
                                            disabled={isSubmitting || !spendAmount}
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                        >
                                            {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                                            Log spend
                                        </button>
                                    </div>
                                </form>
                            </div>

                            {/* Recent entries */}
                            <div className="rounded-2xl border border-slate-200 bg-white p-5">
                                <h4 className="text-sm font-semibold text-text-primary">Recent spend entries</h4>
                                {isLoadingRows ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
                                    </div>
                                ) : rows.length === 0 ? (
                                    <div className="py-8 text-center text-sm text-text-secondary">
                                        No entries yet. Log your first spend above.
                                    </div>
                                ) : (
                                    <div className="mt-3 divide-y divide-slate-100">
                                        {rows.map((r) => (
                                            <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                                    <Calendar className="h-4 w-4 text-text-secondary flex-shrink-0" />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-sm font-medium text-text-primary">
                                                            {formatDate(r.spend_date)} · {formatCurrency(r.amount)}
                                                        </div>
                                                        {r.notes && (
                                                            <div className="text-xs text-text-secondary truncate">{r.notes}</div>
                                                        )}
                                                    </div>
                                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase font-semibold text-text-secondary">
                                                        {r.source}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => deleteSpend(r.id)}
                                                    className="p-1.5 text-text-secondary hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    aria-label="Delete"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function formatCurrency(n: number | null | undefined): string {
    if (!n && n !== 0) return '₹0';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function formatDate(s: string): string {
    return new Date(s + (s.includes('T') ? '' : 'T00:00:00Z')).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
    });
}
