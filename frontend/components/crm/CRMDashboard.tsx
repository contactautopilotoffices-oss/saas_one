'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
    Users, Phone, Calendar, TrendingUp, ArrowRight, Plus,
    Flame, CheckCircle2, Check, Clock, MapPin, ChevronRight, ChevronDown,
    MessageSquare, Sparkles, PhoneCall, Mail, Send, CalendarDays,
    AlertTriangle, Eye, FileText, UserPlus, Target, BarChart3,
    BellRing, ClipboardList, ExternalLink, PlusCircle,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useAuth } from '@/frontend/context/AuthContext';
import { useSound } from '@/frontend/context/SoundContext';
import { useCountUp } from '@/frontend/hooks/useCountUp';
import { TextShimmer } from '@/frontend/components/ui/text-shimmer';
import LatestLeadsCard, { type LatestLead } from '@/frontend/components/crm/LatestLeadsCard';

interface DashboardStats {
    total_leads: number;
    hot_leads: number;
    warm_leads: number;
    lost_leads: number;
    deals_open: number;
    deals_in_progress: number;
    deals_closed: number;
    overdue_followups: number;
    action_required: number;
    meetings_today: number;
    new_leads: number;
    new_leads_by_campaign: { campaign: string; count: number }[];
    followups_needed: number;
    priority_leads: PriorityLead[];
    action_leads: ActionLead[];
    todays_followups?: FollowupLead[];
    latest_leads?: LatestLead[];
    stale_leads?: StaleLead[];
}

interface StaleLead {
    id: string;
    full_name: string;
    company_name: string | null;
    status_name: string;
    last_activity: string | null;
    next_followup_date: string | null;
}

interface PriorityLead {
    id: string;
    full_name: string;
    company_name: string;
    location: string | null;
    campaign: string | null;
    status_name: string;
    last_update: string | null;
    next_followup_date: string | null;
    poc?: string | null;
}

interface ActionLead {
    id: string;
    full_name: string;
    company_name: string;
    location: string | null;
    status_name: string;
    last_update: string | null;
    next_followup_date: string | null;
}

interface FollowupLead {
    id: string;
    full_name: string;
    company_name: string;
    next_followup_date: string;
    followup_notes: string | null;
}

const CITIES = ['Mumbai', 'Bangalore', 'Noida'];

function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function formatTimeAgo(d: string | null) {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function StatCard({ icon: Icon, iconBg, label, value, sub, accent, href }: {
    icon: React.ElementType; iconBg: string; label: string; value: string | number;
    sub?: string; accent?: string; href?: string;
}) {
    const reduce = useReducedMotion();
    const animatedValue = useCountUp(String(value), !reduce);
    const inner = (
        <>
            <div className="flex items-center justify-between">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBg}`}>
                    <Icon className="w-4.5 h-4.5" />
                </div>
                <span className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{label}</span>
            </div>
            <div>
                <p className="text-2xl font-black text-text-primary tabular-nums">{animatedValue}</p>
                {sub && <p className={`text-xs font-medium mt-0.5 ${accent || 'text-text-secondary'}`}>{sub}</p>}
            </div>
        </>
    );
    const cls = `crm-card bg-surface rounded-2xl border border-border p-5 flex flex-col gap-3${href ? ' hover:border-primary cursor-pointer' : ''}`;
    return href
        ? <Link href={href} className={cls}>{inner}</Link>
        : <div className={cls}>{inner}</div>;
}

type StatPeriod = 'today' | 'week' | 'month' | 'all';
const STAT_PERIODS: { key: StatPeriod; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
    { key: 'all', label: 'Total' },
];

export default function CRMDashboard() {
    const { user, membership } = useAuth();
    const params = useParams();
    const router = useRouter();
    const orgId = params?.orgId as string;
    const isBdRep = membership?.org_role === 'bd_rep';
    const isBdAdmin = membership?.org_role === 'bd_admin';
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedCity, setSelectedCity] = useState('all');
    const [isCityOpen, setIsCityOpen] = useState(false);
    const [statPeriod, setStatPeriod] = useState<StatPeriod>('today');
    const cityRef = useRef<HTMLDivElement>(null);
    const reduceMotion = useReducedMotion();
    const { play } = useSound();

    // Pending-task tick-off: optimistically clear a row and mark the lead
    // contacted (and clear its follow-up if it was a follow-up task).
    const [dismissedTasks, setDismissedTasks] = useState<Set<string>>(new Set());
    const completeTask = async (leadId: string, clearFollowup: boolean) => {
        play('success');
        setDismissedTasks((prev) => new Set(prev).add(leadId));
        try {
            const body: Record<string, any> = { last_contacted: new Date().toISOString() };
            if (clearFollowup) body.next_followup_date = null;
            await fetch(`/api/crm/leads/${leadId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch {
            /* keep the optimistic removal; the next stats refresh reconciles */
        }
    };

    const firstName = (user?.user_metadata?.full_name || user?.email || 'User').split(' ')[0];

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (cityRef.current && !cityRef.current.contains(e.target as Node)) setIsCityOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    useEffect(() => {
        setIsLoading(true);
        const cityParam = selectedCity !== 'all' ? `&city=${encodeURIComponent(selectedCity)}` : '';
        fetch(`/api/crm/stats?type=rep&period=${statPeriod}${cityParam}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { setStats(data); setIsLoading(false); })
            .catch(() => setIsLoading(false));
    }, [selectedCity, statPeriod]);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center animate-pulse">
                    <TrendingUp className="w-6 h-6 text-primary" />
                </div>
                <TextShimmer duration={1.2} className="text-sm font-bold" baseColor="#64748b" gradientColor="#cbd5e1">
                    Loading dashboard…
                </TextShimmer>
            </div>
        );
    }

    const s = stats || {
        total_leads: 0, hot_leads: 0, warm_leads: 0, lost_leads: 0,
        deals_open: 0, deals_in_progress: 0, deals_closed: 0,
        overdue_followups: 0, action_required: 0, meetings_today: 0,
        new_leads: 0, new_leads_by_campaign: [], followups_needed: 0,
        priority_leads: [], action_leads: [], todays_followups: [],
        latest_leads: [], stale_leads: [],
    };

    const todaysFollowups = s.todays_followups || [];

    // Follow-ups feed: leads whose follow-up is due/overdue, plus status-action
    // leads needing attention. This is where a lead surfaces once its follow-up is
    // set/updated. Tick-off marks the lead contacted and clears the row.
    type TaskItem = { id: string; title: string; sub: string | null; tag: string; tagClass: string; clearFollowup: boolean };
    const followupTasks: TaskItem[] = (() => {
        const out: TaskItem[] = [];
        const seen = new Set<string>();
        const push = (t: TaskItem) => { if (!seen.has(t.id) && !dismissedTasks.has(t.id)) { seen.add(t.id); out.push(t); } };
        // Follow-ups due (today / this period)
        todaysFollowups.forEach((fu) => push({ id: fu.id, title: fu.company_name || fu.full_name, sub: fu.followup_notes || 'Follow-up due', tag: 'Due', tagClass: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40', clearFollowup: true }));
        // Status-action leads — overdue follow-ups flagged
        (s.action_leads || []).forEach((l) => {
            const overdue = !!l.next_followup_date && new Date(l.next_followup_date) < new Date();
            push({ id: l.id, title: l.company_name || l.full_name, sub: l.status_name || 'Needs attention', tag: overdue ? 'Overdue' : 'Open', tagClass: overdue ? 'text-rose-600 bg-rose-50 dark:bg-rose-950/40' : 'text-text-secondary bg-muted', clearFollowup: true });
        });
        return out;
    })();

    const callsRemaining = Math.max(0, s.total_leads - s.deals_closed - s.lost_leads);
    const hotLeads = s.priority_leads.filter(l => /hot/i.test(l.status_name));
    const topHotLead = hotLeads[0];

    return (
        <div className="space-y-6">
            {/* Greeting Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-text-primary tracking-tight">
                        {getGreeting()}, {firstName}!
                    </h1>
                    <p className="text-sm text-text-secondary mt-0.5">
                        Let's crush your goals today.
                    </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Quick Stats */}
                    <div className="flex items-center gap-4 px-4 py-2 bg-surface-elevated rounded-xl border border-border">
                        <Link href={`/${orgId}/crm/leads`} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                            <PhoneCall className="w-4 h-4 text-text-tertiary" />
                            <div>
                                <p className="text-lg font-black text-text-primary leading-none">{callsRemaining}</p>
                                <p className="text-[9px] text-text-tertiary font-medium">Calls Remaining</p>
                            </div>
                        </Link>
                        <div className="w-px h-8 bg-border" />
                        <Link href={`/${orgId}/crm/followups`} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                            <Clock className="w-4 h-4 text-text-tertiary" />
                            <div>
                                <p className="text-lg font-black text-text-primary leading-none">{s.followups_needed}</p>
                                <p className="text-[9px] text-text-tertiary font-medium">Follow-ups Due</p>
                            </div>
                        </Link>
                        <div className="w-px h-8 bg-border" />
                        <Link href={`/${orgId}/crm/calendar`} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                            <Calendar className="w-4 h-4 text-text-tertiary" />
                            <div>
                                <p className="text-lg font-black text-text-primary leading-none">{s.meetings_today}</p>
                                <p className="text-[9px] text-text-tertiary font-medium">Meetings Scheduled</p>
                            </div>
                        </Link>
                    </div>

                    {/* Add Lead */}
                    <Link
                        href={`/${orgId}/crm/leads`}
                        data-tour="crm-add-lead"
                        className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors"
                    >
                        <PlusCircle className="w-4 h-4" />
                        <span>Add Lead</span>
                    </Link>

                    {/* City Filter */}
                    {!isBdRep && (
                        <div ref={cityRef} className="relative">
                            <button
                                onClick={() => setIsCityOpen(!isCityOpen)}
                                className="flex items-center gap-2 px-4 py-2.5 bg-surface-elevated border border-border rounded-xl hover:border-primary transition-all text-sm font-bold text-text-primary"
                            >
                                <MapPin className="w-4 h-4 text-primary" />
                                <span>{selectedCity === 'all' ? 'All Cities' : selectedCity}</span>
                                <ChevronDown className={`w-4 h-4 text-text-tertiary transition-transform ${isCityOpen ? 'rotate-180' : ''}`} />
                            </button>
                            <AnimatePresence>
                                {isCityOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -4 }}
                                        className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-xl shadow-xl z-50 min-w-[160px] overflow-hidden"
                                    >
                                        {['all', ...CITIES].map(c => (
                                            <button
                                                key={c}
                                                onClick={() => { setSelectedCity(c); setIsCityOpen(false); }}
                                                className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${selectedCity === c ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-muted'}`}
                                            >
                                                <MapPin className="w-3.5 h-3.5" />
                                                {c === 'all' ? 'All Cities' : c}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </div>

            {/* Next Best Actions Banner */}
            {(topHotLead || todaysFollowups.length > 0 || s.meetings_today > 0) && (
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 rounded-2xl border border-amber-200/50 dark:border-amber-800/30 px-5 py-3 overflow-x-auto">
                    <div className="flex items-center gap-6 min-w-max">
                        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                            <Sparkles className="w-4 h-4" />
                            <span className="text-xs font-black uppercase tracking-wider">Next Best Actions</span>
                        </div>
                        {topHotLead && (
                            <Link href={`/${orgId}/crm/leads?lead=${topHotLead.id}`} className="flex items-center gap-2 px-3 py-1.5 bg-white/60 dark:bg-white/10 rounded-lg hover:bg-white/80 dark:hover:bg-white/20 transition-colors">
                                <PhoneCall className="w-3.5 h-3.5 text-rose-500" />
                                <span className="text-xs font-bold text-text-primary">Call {topHotLead.company_name || topHotLead.full_name}</span>
                                <span className="text-[10px] text-text-tertiary">High intent lead</span>
                                <ChevronRight className="w-3 h-3 text-text-tertiary" />
                            </Link>
                        )}
                        {s.overdue_followups > 0 && (
                            <Link href={`/${orgId}/crm/followups`} className="flex items-center gap-2 px-3 py-1.5 bg-white/60 dark:bg-white/10 rounded-lg hover:bg-white/80 dark:hover:bg-white/20 transition-colors">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                <span className="text-xs font-bold text-text-primary">{s.overdue_followups} Follow-ups overdue</span>
                                <span className="text-[10px] text-rose-500 font-bold">View now</span>
                                <ChevronRight className="w-3 h-3 text-text-tertiary" />
                            </Link>
                        )}
                        {s.meetings_today > 0 && (
                            <Link href={`/${orgId}/crm/calendar`} className="flex items-center gap-2 px-3 py-1.5 bg-white/60 dark:bg-white/10 rounded-lg hover:bg-white/80 dark:hover:bg-white/20 transition-colors">
                                <Calendar className="w-3.5 h-3.5 text-blue-500" />
                                <span className="text-xs font-bold text-text-primary">Meeting in today's schedule</span>
                                <ChevronRight className="w-3 h-3 text-text-tertiary" />
                            </Link>
                        )}
                    </div>
                </div>
            )}

            {/* Stat Tiles — period picker + 3 cards */}
            <div data-tour="crm-stat-tiles" className="space-y-3">
                {/* Period pills */}
                <div className="flex items-center gap-1 bg-surface-elevated rounded-xl p-1 w-fit max-w-full overflow-x-auto no-scrollbar border border-border">
                    {STAT_PERIODS.map(p => (
                        <button
                            key={p.key}
                            onClick={() => { setStatPeriod(p.key); play('toggle'); }}
                            className={`shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${statPeriod === p.key ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                        >{p.label}</button>
                    ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <StatCard
                        icon={Users}
                        iconBg="bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400"
                        label="Total Leads"
                        value={s.total_leads}
                        sub={`${s.hot_leads} hot · ${s.warm_leads} warm`}
                        href={`/${orgId}/crm/leads`}
                    />
                    <StatCard
                        icon={TrendingUp}
                        iconBg="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400"
                        label="New Leads"
                        value={s.new_leads}
                        sub={statPeriod === 'all' ? 'All time' : statPeriod === 'today' ? 'Last 24h' : `This ${statPeriod}`}
                        href={`/${orgId}/crm/leads`}
                    />
                    <StatCard
                        icon={BellRing}
                        iconBg="bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400"
                        label="Follow-ups Needed"
                        value={s.followups_needed}
                        sub={statPeriod === 'all' ? 'All time' : `Due this ${statPeriod}`}
                        href={`/${orgId}/crm/followups`}
                    />
                </div>
            </div>

            {/* Three Column Grid: AI Copilot, Latest Leads, Follow-ups */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* AI Deal Copilot */}
                <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-primary" />
                            <h2 className="text-sm font-black text-text-primary">AI Deal Copilot</h2>
                        </div>
                        <Link href={`/${orgId}/crm/ai`} className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1">
                            View all <ArrowRight className="w-3 h-3" />
                        </Link>
                    </div>
                    <div className="px-5 py-2">
                        <p className="text-[11px] text-text-tertiary mb-3">Smart recommendations to help you close more deals</p>
                        {hotLeads.length === 0 ? (
                            <div className="py-8 text-center">
                                <Sparkles className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
                                <p className="text-xs text-text-secondary font-medium">No AI suggestions right now</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {hotLeads.slice(0, 3).map((lead, i) => (
                                    <div key={lead.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-elevated hover:bg-muted transition-colors cursor-pointer" onClick={() => router.push(`/${orgId}/crm/leads?lead=${lead.id}`)}>
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black text-white ${i === 0 ? 'bg-rose-500' : i === 1 ? 'bg-amber-500' : 'bg-blue-500'}`}>
                                            {(lead.company_name || lead.full_name).charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-text-primary truncate">Call {lead.company_name || lead.full_name}</p>
                                            <p className="text-[10px] text-text-tertiary truncate">{lead.campaign || 'High intent lead'}</p>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            <button className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors">
                                                <PhoneCall className="w-3 h-3" />
                                            </button>
                                            <button className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 transition-colors">
                                                <Mail className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Latest Leads — newest first, so reps catch fresh leads fast */}
                <LatestLeadsCard orgId={orgId} leads={s.latest_leads || []} userId={user?.id} />

                {/* Follow-ups — leads surface here once a follow-up is set/updated */}
                <div data-tour="crm-followups" className="bg-surface rounded-2xl border border-border overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <BellRing className="w-4 h-4 text-primary" />
                                <h2 className="text-sm font-black text-text-primary">Follow-ups</h2>
                            </div>
                            <span className="text-xs font-bold text-text-secondary">{followupTasks.length} <span className="text-[10px] text-text-tertiary">Due</span></span>
                            {s.overdue_followups > 0 && (
                                <span className="text-xs font-bold text-rose-500">{s.overdue_followups} <span className="text-[10px]">Overdue</span></span>
                            )}
                        </div>
                        <Link href={`/${orgId}/crm/followups`} className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1">
                            View all <ArrowRight className="w-3 h-3" />
                        </Link>
                    </div>
                    <div className="divide-y divide-border max-h-[320px] overflow-y-auto">
                        {followupTasks.length === 0 ? (
                            <div className="py-8 text-center">
                                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">No follow-ups due</p>
                            </div>
                        ) : (
                            <AnimatePresence initial={false}>
                                {followupTasks.map((t) => (
                                    <motion.div
                                        key={t.id}
                                        layout={!reduceMotion}
                                        initial={false}
                                        exit={reduceMotion ? undefined : { opacity: 0, x: 24, height: 0, marginTop: 0, marginBottom: 0 }}
                                        transition={{ duration: 0.25, ease: 'easeOut' }}
                                        className="group flex items-start gap-3 px-5 py-3 hover:bg-surface-elevated transition-colors overflow-hidden"
                                    >
                                        {/* Tick-off: marks the lead contacted and clears the row */}
                                        <motion.button
                                            type="button"
                                            aria-label="Mark done"
                                            onClick={() => completeTask(t.id, t.clearFollowup)}
                                            whileTap={reduceMotion ? undefined : { scale: 0.8 }}
                                            className="w-4 h-4 rounded border-2 border-border mt-0.5 flex-shrink-0 flex items-center justify-center text-transparent hover:border-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                                        >
                                            <Check className="w-3 h-3" />
                                        </motion.button>
                                        <Link href={`/${orgId}/crm/leads?lead=${t.id}`} className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-text-primary truncate">{t.title}</p>
                                            {t.sub && <p className="text-[10px] text-text-tertiary truncate mt-0.5">{t.sub}</p>}
                                        </Link>
                                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0 ${t.tagClass}`}>{t.tag}</span>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Row: Recent Activity + Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Recent Lead Activity */}
                <div className="lg:col-span-2 bg-surface rounded-2xl border border-border overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <h2 className="text-sm font-black text-text-primary">Recent Lead Activity</h2>
                        <Link href={`/${orgId}/crm/leads`} className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1">
                            View all <ArrowRight className="w-3 h-3" />
                        </Link>
                    </div>
                    <div className="divide-y divide-border max-h-[280px] overflow-y-auto">
                        {[...s.priority_leads, ...s.action_leads].slice(0, 6).map((lead, i) => (
                            <div key={lead.id + i} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-elevated transition-colors cursor-pointer" onClick={() => router.push(`/${orgId}/crm/leads?lead=${lead.id}`)}>
                                <span className="text-[10px] text-text-tertiary font-medium w-14 flex-shrink-0">{formatTimeAgo(lead.last_update)}</span>
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                    {/hot/i.test((lead as PriorityLead).status_name) ? <Eye className="w-3.5 h-3.5 text-rose-500" /> :
                                     /warm|mql/i.test((lead as PriorityLead).status_name) ? <UserPlus className="w-3.5 h-3.5 text-amber-500" /> :
                                     <MessageSquare className="w-3.5 h-3.5 text-primary" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-text-primary truncate">
                                        <span className="font-bold">{lead.company_name || lead.full_name}</span>
                                        {' '}<span className="text-text-tertiary">· {(lead as PriorityLead).status_name}</span>
                                    </p>
                                </div>
                                <ChevronRight className="w-3 h-3 text-text-tertiary flex-shrink-0" />
                            </div>
                        ))}
                        {s.priority_leads.length === 0 && s.action_leads.length === 0 && (
                            <div className="py-8 text-center text-xs text-text-tertiary">No recent activity</div>
                        )}
                    </div>
                </div>

                {/* Performance This Week */}
                <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <h2 className="text-sm font-black text-text-primary">Performance This Week</h2>
                        <Link href={`/${orgId}/crm/performance`} className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1">
                            Full report <ArrowRight className="w-3 h-3" />
                        </Link>
                    </div>
                    <div className="px-5 py-4 space-y-4">
                        <PerformanceBar label="Total Leads" current={s.total_leads} max={Math.max(s.total_leads, 100)} color="bg-primary" />
                        <PerformanceBar label="Hot Leads" current={s.hot_leads} max={Math.max(s.total_leads, 20)} color="bg-rose-500" />
                        <PerformanceBar label="Warm Leads" current={s.warm_leads} max={Math.max(s.total_leads, 20)} color="bg-amber-500" />
                        <PerformanceBar label="Deals Closed" current={s.deals_closed} max={Math.max(s.total_leads, 10)} color="bg-emerald-500" />
                        <PerformanceBar label="Follow-ups Done" current={Math.max(0, s.total_leads - s.followups_needed)} max={Math.max(s.total_leads, 50)} color="bg-blue-500" />
                    </div>
                </div>
            </div>

            {/* AI Insight Card */}
            {s.hot_leads > 0 && (
                <div className="bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20 rounded-2xl border border-violet-200/50 dark:border-violet-800/30 p-5 flex items-start gap-4">
                    <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-text-primary">AI Insight</h3>
                        <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                            You have {s.hot_leads} high intent lead{s.hot_leads > 1 ? 's' : ''} ready to move forward.
                            Keep focusing on follow-ups — {s.followups_needed > 0 ? `${s.followups_needed} follow-ups are pending action.` : 'all follow-ups are up to date!'}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

function PerformanceBar({ label, current, max, color }: { label: string; current: number; max: number; color: string }) {
    const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-text-secondary">{label}</span>
                <span className="text-[11px] font-black text-text-primary">{current}</span>
            </div>
            <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}
