'use client';

import React from 'react';
import { Target, Building2, TrendingUp, MessageSquare, AlertCircle, Inbox } from 'lucide-react';

/**
 * ABM Tracker — account-based outbound.
 *
 * Reads /api/crm/abm, which federates to the ABM project's own Supabase
 * (see docs/abm/CRM_ALIGNMENT.md). The columns mirror what ABM actually
 * tracks: stage, day in the 8-day sequence, channel touches and reply intent.
 */

interface AbmAccount {
    company: string;
    target_area: string | null;
    industry: string | null;
    campaign: string | null;
    people: number;
    stage: string;
    score: string;
    day: number | null;
    personas: string[];
    touches: { li_invited: number; li_accepted: number; wa_sent: number; called: number };
    replied: number;
    reply_intent: string | null;
    live: number;
}

interface AbmTotals {
    leads: number;
    companies: number;
    in_sequence: number;
    replied: number;
    interested: number;
    visits_booked: number;
    truncated: boolean;
}

interface AbmResponse {
    configured: boolean;
    reason?: string;
    totals: AbmTotals | null;
    accounts: AbmAccount[];
}

const SCORE_STYLES: Record<string, string> = {
    HOT: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    WARM: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    COLD: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const STAGE_LABELS: Record<string, string> = {
    new: 'New',
    contacted: 'Contacted',
    replied: 'Replied',
    called: 'Called',
    visit_booked: 'Visit booked',
    proposal: 'Proposal',
    closed_won: 'Won',
    closed_lost: 'Lost',
    dnc: 'Do not contact',
};

function Tile({ icon: Icon, tone, value, label }: {
    icon: React.ElementType; tone: string; value: React.ReactNode; label: string;
}) {
    return (
        <div className="bg-surface rounded-2xl border border-border p-5">
            <Icon className={`w-5 h-5 ${tone} mb-2`} />
            <p className="text-2xl font-black text-text-primary">{value}</p>
            <p className="text-xs text-text-tertiary font-medium">{label}</p>
        </div>
    );
}

export default function AbmTrackerPage() {
    const [data, setData] = React.useState<AbmResponse | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/crm/abm', { cache: 'no-store' });
                const body = await res.json();
                if (cancelled) return;
                if (!res.ok) {
                    setError(body?.error || `Request failed (${res.status})`);
                } else {
                    setData(body as AbmResponse);
                }
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Request failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const totals = data?.totals;
    const accounts = data?.accounts || [];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-black text-text-primary tracking-tight">ABM Tracker</h1>
                <p className="text-sm text-text-secondary mt-1">
                    Account-based outbound — the 8-day LinkedIn, WhatsApp and call sequence
                </p>
            </div>

            {loading && (
                <div className="bg-surface rounded-2xl border border-border p-8 text-center">
                    <p className="text-sm text-text-secondary">Loading ABM accounts…</p>
                </div>
            )}

            {!loading && error && (
                <div className="bg-surface rounded-2xl border border-border p-6 flex gap-3">
                    <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-text-primary">Could not load ABM data</p>
                        <p className="text-xs text-text-secondary mt-1">{error}</p>
                    </div>
                </div>
            )}

            {!loading && !error && data && !data.configured && (
                <div className="bg-surface rounded-2xl border border-border p-6 flex gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-text-primary">ABM is not connected yet</p>
                        <p className="text-xs text-text-secondary mt-1">
                            The ABM outbound system runs in its own database. This deployment needs
                            <code className="mx-1 px-1 py-0.5 rounded bg-surface-elevated font-mono text-[11px]">ABM_SUPABASE_URL</code>
                            and
                            <code className="mx-1 px-1 py-0.5 rounded bg-surface-elevated font-mono text-[11px]">ABM_SUPABASE_SERVICE_ROLE_KEY</code>
                            before accounts appear here. See <span className="font-mono text-[11px]">docs/abm/CRM_ALIGNMENT.md</span>.
                        </p>
                    </div>
                </div>
            )}

            {!loading && !error && data?.configured && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <Tile icon={Building2} tone="text-blue-500" value={totals?.companies ?? 0} label="Target Accounts" />
                        <Tile icon={Target} tone="text-violet-500" value={totals?.in_sequence ?? 0} label="Live in Sequence" />
                        <Tile icon={MessageSquare} tone="text-amber-500" value={totals?.replied ?? 0} label="Replied" />
                        <Tile icon={TrendingUp} tone="text-emerald-500" value={totals?.visits_booked ?? 0} label="Visits Booked" />
                    </div>

                    <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                            <h2 className="text-sm font-black text-text-primary">Target Accounts</h2>
                            <span className="text-[11px] text-text-tertiary font-medium">
                                {totals?.leads ?? 0} contacts across {totals?.companies ?? 0} companies
                            </span>
                        </div>

                        {accounts.length === 0 ? (
                            <div className="p-8 text-center">
                                <Inbox className="w-6 h-6 text-text-tertiary mx-auto mb-2" />
                                <p className="text-sm font-bold text-text-primary">No ABM leads yet</p>
                                <p className="text-xs text-text-secondary mt-1 max-w-md mx-auto">
                                    The ABM database is connected but empty. Leads enter it through the
                                    <span className="font-mono text-[11px] mx-1">abm_intake</span>
                                    RPC, run from Oppora. Nothing will show here until that import runs.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-[10px] text-text-tertiary uppercase tracking-wider">
                                            <th className="text-left font-bold py-3 px-4">Account</th>
                                            <th className="text-left font-bold py-3 px-4">Area</th>
                                            <th className="text-left font-bold py-3 px-4">Score</th>
                                            <th className="text-left font-bold py-3 px-4">Stage</th>
                                            <th className="text-right font-bold py-3 px-4">Day</th>
                                            <th className="text-right font-bold py-3 px-4">People</th>
                                            <th className="text-left font-bold py-3 px-4">Touches</th>
                                            <th className="text-left font-bold py-3 px-4">Reply</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {accounts.map((a) => (
                                            <tr key={a.company} className="hover:bg-surface-elevated transition-colors">
                                                <td className="py-3 px-4 font-bold text-text-primary">
                                                    {a.company}
                                                    {a.industry && (
                                                        <span className="block text-[11px] font-medium text-text-tertiary">{a.industry}</span>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4 text-text-secondary">{a.target_area || '—'}</td>
                                                <td className="py-3 px-4">
                                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded ${SCORE_STYLES[a.score] || SCORE_STYLES.COLD}`}>
                                                        {a.score}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-text-secondary">{STAGE_LABELS[a.stage] || a.stage}</td>
                                                <td className="py-3 px-4 text-right text-text-secondary">
                                                    {a.day === null ? '—' : a.day > 8 ? `${a.day} (past)` : a.day}
                                                </td>
                                                <td className="py-3 px-4 text-right text-text-secondary">{a.people}</td>
                                                <td className="py-3 px-4 text-[11px] text-text-secondary whitespace-nowrap">
                                                    {`LI ${a.touches.li_accepted}/${a.touches.li_invited} · WA ${a.touches.wa_sent} · Call ${a.touches.called}`}
                                                </td>
                                                <td className="py-3 px-4 text-text-secondary">
                                                    {a.replied === 0 ? '—' : (a.reply_intent || 'unknown')}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {totals?.truncated && (
                        <p className="text-[11px] text-text-tertiary">
                            Showing the first 2000 contacts. Narrow by campaign to see the rest.
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
