'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { BellRing, Clock, CheckCircle2, ChevronRight, Phone, MapPin, MessageSquare } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { TextShimmer } from '@/frontend/components/ui/text-shimmer';

interface FollowupLead {
    id: string;
    company_name: string;
    contact_person: string;
    contact_number: string | null;
    location: string | null;
    next_followup_date: string;
    followup_notes: string | null;
    status: string;
    assigned_user?: { full_name: string } | null;
}

export default function FollowUpsPage() {
    const params = useParams();
    const router = useRouter();
    const orgId = params?.orgId as string;
    const { membership } = useAuth();
    const isBdAdmin = membership?.org_role === 'bd_admin' || membership?.org_role === 'bd_super_admin';
    const [leads, setLeads] = useState<FollowupLead[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'today' | 'overdue' | 'upcoming'>('today');

    useEffect(() => {
        setLoading(true);
        fetch(`/api/crm/leads?has_followup=true&sort=next_followup_date&order=asc&limit=100`)
            .then(r => r.ok ? r.json() : { leads: [] })
            .then(data => { setLeads(data.leads || []); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    const today = new Date().toISOString().split('T')[0];
    const todayLeads = leads.filter(l => l.next_followup_date?.startsWith(today));
    const overdueLeads = leads.filter(l => l.next_followup_date && l.next_followup_date < today);
    const upcomingLeads = leads.filter(l => l.next_followup_date && l.next_followup_date > today);

    const displayLeads = tab === 'today' ? todayLeads : tab === 'overdue' ? overdueLeads : upcomingLeads;

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center animate-pulse">
                    <BellRing className="w-6 h-6 text-amber-600" />
                </div>
                <TextShimmer duration={1.2} className="text-sm font-bold" baseColor="#64748b" gradientColor="#cbd5e1">
                    Loading follow-ups…
                </TextShimmer>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-black text-text-primary tracking-tight">Follow Ups</h1>
                <p className="text-sm text-text-secondary mt-1">Track and manage all your scheduled follow-ups</p>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 bg-surface-elevated rounded-xl p-1 w-fit">
                {[
                    { key: 'today' as const, label: 'Today', count: todayLeads.length },
                    { key: 'overdue' as const, label: 'Overdue', count: overdueLeads.length },
                    { key: 'upcoming' as const, label: 'Upcoming', count: upcomingLeads.length },
                ].map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${
                            tab === t.key ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                        }`}
                    >
                        {t.label}
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                            t.key === 'overdue' && t.count > 0 ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400' :
                            'bg-surface-elevated text-text-tertiary'
                        }`}>{t.count}</span>
                    </button>
                ))}
            </div>

            {/* Follow-up List */}
            <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                {displayLeads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
                        <p className="text-sm font-bold text-text-secondary">
                            {tab === 'today' ? 'No follow-ups due today' : tab === 'overdue' ? 'No overdue follow-ups!' : 'No upcoming follow-ups'}
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {displayLeads.map(lead => (
                            <div
                                key={lead.id}
                                onClick={() => router.push(`/${orgId}/crm/leads?lead=${lead.id}`)}
                                className="flex items-center gap-4 px-5 py-4 hover:bg-surface-elevated cursor-pointer transition-colors"
                            >
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                    tab === 'overdue' ? 'bg-rose-500' : tab === 'today' ? 'bg-amber-500' : 'bg-blue-500'
                                }`} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-text-primary truncate">
                                        {lead.company_name || lead.contact_person}
                                    </p>
                                    <div className="flex items-center gap-3 mt-0.5">
                                        {lead.location && (
                                            <span className="text-[10px] text-text-tertiary flex items-center gap-1">
                                                <MapPin className="w-2.5 h-2.5" /> {lead.location}
                                            </span>
                                        )}
                                        {lead.followup_notes && (
                                            <span className="text-[10px] text-text-secondary flex items-center gap-1 truncate max-w-[200px]">
                                                <MessageSquare className="w-2.5 h-2.5" /> {lead.followup_notes}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {isBdAdmin && lead.assigned_user && (
                                    <span className="text-[10px] text-text-tertiary font-medium flex-shrink-0">
                                        {lead.assigned_user.full_name}
                                    </span>
                                )}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className={`text-[10px] font-bold ${
                                        tab === 'overdue' ? 'text-rose-500' : 'text-text-tertiary'
                                    }`}>
                                        {new Date(lead.next_followup_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                    </span>
                                    <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
