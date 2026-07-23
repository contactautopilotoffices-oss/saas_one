'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';

export interface LatestLead {
    id: string;
    full_name: string;
    company_name?: string | null;
    requirement?: string | null;
    location?: string | null;
    status_name?: string | null;
    created_at: string;
    last_contacted?: string | null;
}

function agoLabel(iso?: string | null): string {
    if (!iso) return '';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

// Reusable "Latest Leads" card. The `leads` prop is the rep's own newest leads
// (from the dashboard stats). When `userId` is passed, a compact Mine/All toggle
// appears: "All" self-fetches the newest leads across the rep's whole market
// (server-side scope already limits this to their city/territory), so teammates
// in the same city can see each other's fresh leads. Leads < 24h are badged NEW.
export default function LatestLeadsCard({
    orgId,
    leads,
    userId,
}: {
    orgId: string;
    leads: LatestLead[];
    userId?: string;
}) {
    const showToggle = !!userId;
    const [scope, setScope] = useState<'mine' | 'all'>('mine');
    const [allLeads, setAllLeads] = useState<LatestLead[] | null>(null);
    const [loading, setLoading] = useState(false);

    // "All" → market-wide newest leads (fetched once). "Mine" reuses the prop.
    useEffect(() => {
        if (scope !== 'all' || allLeads) return;
        let active = true;
        setLoading(true);
        const params = new URLSearchParams({ sort_by: 'created_at', sort_order: 'desc', page_size: '6' });
        if (orgId) params.set('org_id', orgId);
        fetch(`/api/crm/leads?${params}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!active) return;
                const mapped: LatestLead[] = (data?.leads || []).map((l: any) => ({
                    id: l.id,
                    full_name: l.contact_person || l.company_name || 'Unnamed Lead',
                    company_name: l.company_name || null,
                    requirement: l.requirement || null,
                    location: l.location || l.city || null,
                    status_name: l.status_info?.name || null,
                    created_at: l.created_at,
                    last_contacted: l.last_contacted || null,
                }));
                setAllLeads(mapped);
            })
            .catch(() => {})
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [scope, allLeads, orgId]);

    const display = scope === 'all' ? (allLeads || []) : leads;

    return (
        <div className="crm-card bg-surface rounded-2xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border gap-2">
                <h2 className="text-sm font-black text-text-primary flex items-center gap-2 shrink-0">
                    <Sparkles className="w-4 h-4 text-primary" /> Latest Leads
                </h2>
                <div className="flex items-center gap-2">
                    {showToggle && (
                        <div className="flex items-center gap-0.5 bg-surface-elevated rounded-lg p-0.5 border border-border">
                            {([['mine', 'Mine'], ['all', 'All']] as const).map(([key, label]) => (
                                <button
                                    key={key}
                                    onClick={() => setScope(key)}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors ${
                                        scope === key ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                                    }`}
                                    title={key === 'mine' ? 'Leads assigned to me' : 'All leads in my market'}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                    <Link
                        href={`/${orgId}/crm/leads`}
                        className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1 shrink-0"
                    >
                        View all <ArrowRight className="w-3 h-3" />
                    </Link>
                </div>
            </div>
            {loading && display.length === 0 ? (
                <div className="py-8 text-center text-xs text-text-tertiary">Loading…</div>
            ) : display.length === 0 ? (
                <div className="py-8 text-center text-xs text-text-tertiary">No leads yet</div>
            ) : (
                <div className="divide-y divide-border">
                    {display.map((l) => {
                        const isNew =
                            !!l.created_at && Date.now() - new Date(l.created_at).getTime() < 24 * 3600 * 1000;
                        const sub = l.requirement
                            ? l.requirement.slice(0, 36)
                            : l.company_name || l.location || '—';
                        return (
                            <Link
                                key={l.id}
                                href={`/${orgId}/crm/leads?lead=${l.id}`}
                                className="px-5 py-2.5 flex items-center gap-3 hover:bg-surface-elevated transition-colors"
                            >
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-black text-primary flex-shrink-0">
                                    {(l.full_name || '?').charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-text-primary truncate">
                                        {l.full_name}
                                        {isNew && (
                                            <span className="ml-2 text-[9px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                                                NEW
                                            </span>
                                        )}
                                    </p>
                                    <p className="text-[10px] text-text-tertiary truncate">{sub}</p>
                                </div>
                                <span className="text-[10px] text-text-tertiary whitespace-nowrap">
                                    {agoLabel(l.created_at)}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
