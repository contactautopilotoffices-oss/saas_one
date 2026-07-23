'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
    Search, Sparkles, Bell, ChevronDown, MapPin, ArrowUpRight, ArrowDownRight,
    Users, Megaphone, Wallet, CalendarCheck, TrendingUp, Target,
    Flame, ArrowRight, Building2, Bot, Command, PhoneCall, CalendarDays,
} from 'lucide-react';
import {
    PieChart, Pie, Cell, ResponsiveContainer,
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '@/frontend/context/AuthContext';
import { useSound } from '@/frontend/context/SoundContext';
import { useCountUp } from '@/frontend/hooks/useCountUp';
import { parentCity } from '@/backend/lib/crm/cityGroups';
import { TextShimmer } from '@/frontend/components/ui/text-shimmer';
import RepTimeGridCalendar from '@/frontend/components/crm/RepTimeGridCalendar';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function inrCompact(n: number | null | undefined): string {
    if (n == null || isNaN(n)) return '₹0';
    const abs = Math.abs(n);
    if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
    if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
    return `₹${Math.round(n)}`;
}

const compactNum = (n: number | null | undefined) => (n == null || isNaN(n)) ? '0' : n.toLocaleString('en-IN');
const pct = (c?: number, p?: number) => (c != null && p != null && p > 0) ? Math.round(((c - p) / p) * 100) : null;
const fmtDate = (d: Date) => (isNaN(d.getTime()) ? new Date() : d).toISOString().split('T')[0];

function periodRange(period: Period): { from: string; to: string } {
    const now = new Date();
    const to = fmtDate(now);
    if (period === 'Today') return { from: to, to };
    if (period === 'This Week') {
        const day = now.getDay(); const offset = day === 0 ? 6 : day - 1;
        return { from: fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)), to };
    }
    if (period === 'Last 15 Days') {
        return { from: fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14)), to };
    }
    // This Month / Custom → month-to-date
    return { from: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), to };
}

// The PREVIOUS equivalent window (same length, immediately before) so deltas are
// apples-to-apples: today vs yesterday, this week vs last week, MTD vs same-range
// last month. This keeps the headline value and its delta on the same basis.
function prevPeriodRange(period: Period): { from: string; to: string } {
    const now = new Date();
    if (period === 'Today') { const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); return { from: fmtDate(y), to: fmtDate(y) }; }
    if (period === 'This Week') {
        const day = now.getDay(); const offset = day === 0 ? 6 : day - 1;
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
        return { from: fmtDate(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 7)), to: fmtDate(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 1)) };
    }
    if (period === 'Last 15 Days') {
        // Prior 15-day window: day-29 .. day-15
        return { from: fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), to: fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 15)) };
    }
    // This Month / Custom → first of last month .. same day-of-month last month
    const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sameDayLast = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));
    return { from: fmtDate(firstLast), to: fmtDate(sameDayLast) };
}

const deltaLabelFor = (p: Period) => p === 'Today' ? 'vs yesterday' : p === 'This Week' ? 'vs last week' : p === 'Last 15 Days' ? 'vs prev 15 days' : 'vs last month';

function weekBounds() {
    const now = new Date();
    const day = now.getDay(); const offset = day === 0 ? 6 : day - 1;
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6, 23, 59, 59);
    return { start: mon.toISOString(), end: sun.toISOString(), mon };
}

const CHANNEL_BADGE: Record<string, { label: string; color: string; glyph: string }> = {
    meta_ads: { label: 'Meta Ads', color: '#1877F2', glyph: '∞' },
    linkedin_ads: { label: 'LinkedIn Ads', color: '#0A66C2', glyph: 'in' },
    google_ads: { label: 'Google Ads', color: '#16A34A', glyph: 'G' },
    other: { label: 'Other', color: '#64748B', glyph: '·' },
};

const PERIODS = ['Today', 'This Week', 'Last 15 Days', 'This Month', 'Custom'] as const;
type Period = typeof PERIODS[number];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Staggered entrance for the KPI grid (gated by reduced-motion at call sites).
const KPI_GRID_VARIANTS = {
    hidden: {},
    show: { transition: { staggerChildren: 0.06 } },
};
const KPI_ITEM_VARIANTS = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function BdSuperAdminDashboard() {
    const { user } = useAuth();
    const params = useParams();
    const orgId = params?.orgId as string;
    const reduceMotion = useReducedMotion();
    const { play } = useSound();

    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<Period>('This Month');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [city, setCity] = useState('All Cities');
    const [cityOpen, setCityOpen] = useState(false);
    const [trendKey, setTrendKey] = useState<'15d' | '3m' | '6m' | '12m' | 'custom'>('12m');
    const [trendCustom, setTrendCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });
    const [trendChannel, setTrendChannel] = useState<'blended' | 'meta' | 'linkedin'>('blended');
    const cityRef = useRef<HTMLDivElement>(null);

    const [impactPeriod, setImpactPeriod] = useState<any>(null);
    const [impactPrev, setImpactPrev] = useState<any>(null);
    const [impactYear, setImpactYear] = useState<any>(null);
    const [stats, setStats] = useState<any>(null);
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [latest, setLatest] = useState<any[]>([]);
    const [channelMix, setChannelMix] = useState<any[]>([]);
    const [events, setEvents] = useState<any[]>([]);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [cities, setCities] = useState<string[]>(['All Cities']);

    const firstName = (user?.user_metadata?.full_name || user?.email || 'there').split(' ')[0];

    useEffect(() => {
        const handler = (e: MouseEvent) => { if (cityRef.current && !cityRef.current.contains(e.target as Node)) setCityOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    useEffect(() => {
        let active = true;
        setLoading(true);
        const org = orgId ? `&org_id=${orgId}` : '';
        const cityParam = city !== 'All Cities' ? `&city=${encodeURIComponent(city)}` : '';
        const statsPeriod = period === 'Today' ? 'today' : period === 'This Week' ? 'week' : 'month';
        const pr = (period === 'Custom' && customFrom && customTo)
            ? { from: customFrom, to: customTo }
            : periodRange(period);
        const pp = prevPeriodRange(period);
        // Trend range + granularity. 15d → daily points; months → monthly;
        // custom → daily if ≤ 31 days else monthly.
        let trendFrom: string, trendTo = fmtDate(new Date()), trendGroup: 'day' | 'month' = 'month';
        if (trendKey === '15d') { trendFrom = fmtDate(new Date(Date.now() - 14 * 86400000)); trendGroup = 'day'; }
        else if (trendKey === 'custom' && trendCustom.from && trendCustom.to) {
            trendFrom = trendCustom.from; trendTo = trendCustom.to;
            trendGroup = (new Date(trendTo).getTime() - new Date(trendFrom).getTime()) <= 31 * 86400000 ? 'day' : 'month';
        } else {
            const m = trendKey === '3m' ? 3 : trendKey === '6m' ? 6 : 12;
            trendFrom = fmtDate(new Date(Date.now() - m * 30 * 86400000));
        }
        const wk = weekBounds();
        const j = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);

        Promise.all([
            j(`/api/crm/reports/impact?from=${pr.from}&to=${pr.to}&group_by=month${org}`),
            j(`/api/crm/reports/impact?from=${pp.from}&to=${pp.to}&group_by=month${org}`),
            j(`/api/crm/reports/impact?from=${trendFrom}&to=${trendTo}&group_by=${trendGroup}${org}`),
            j(`/api/crm/stats?type=admin&period=${statsPeriod}${cityParam}${org}`),
            j(`/api/crm/campaigns?${org.slice(1)}`),
            j(`/api/crm/leads?sort_by=created_at&sort_order=desc&page_size=8${org}`),
            j(`/api/crm/events?start_date=${encodeURIComponent(wk.start)}&end_date=${encodeURIComponent(wk.end)}${org}`),
            j(`/api/crm/accounts?limit=8${org}`),
            j(`/api/crm/campaigns/performance?from=${pr.from}&to=${pr.to}${org}`),
        ]).then(([ip, ipp, iy, s, c, l, ev, ac, perf]) => {
            if (!active) return;
            setImpactPeriod(ip); setImpactPrev(ipp); setImpactYear(iy); setStats(s);
            setCampaigns(Array.isArray(c?.campaigns) ? c.campaigns : []);
            setLatest(Array.isArray(l?.leads) ? l.leads : []);
            setChannelMix(Array.isArray(perf?.by_channel) ? perf.by_channel : []);
            setEvents(Array.isArray(ev?.events) ? ev.events : []);
            setAccounts(Array.isArray(ac?.accounts) ? ac.accounts : []);
            // Real city list from territory performance — only rebuild from the
            // UNFILTERED ("All Cities") dataset. When a specific city is selected the
            // stats are filtered to that one city, so territory_performance would
            // otherwise collapse the dropdown to just that city + All Cities.
            // Roll neighbourhood values (Lower Parel, Andheri…) up to their parent
            // metro (Mumbai) so the dropdown lists cities, and selecting one matches
            // all of its areas (the filter expands via cityFilterOr server-side).
            if (city === 'All Cities') {
                const tp = s?.territory_performance || [];
                if (tp.length) {
                    const parents = Array.from(new Set<string>(
                        tp.map((t: any) => parentCity(t.city)).filter(Boolean)
                    ));
                    setCities(['All Cities', ...parents]);
                }
            }
            setLoading(false);
        });
        return () => { active = false; };
    }, [orgId, period, city, customFrom, customTo, trendKey, trendCustom]);

    /* ---- Derived (100% real data) ---- */

    const kpis = useMemo(() => {
        // Deltas compare the CURRENT period to the PRIOR equivalent period (same
        // length) so the headline value and its % chip share the same basis.
        const k = impactPeriod?.kpis || {};
        const kp = impactPrev?.kpis || {};
        const meetings = (stats?.user_performance || []).reduce((a: number, u: any) => a + (u.meetings || 0), 0);
        return {
            leads_received: k.leads_received ?? stats?.total_leads ?? 0,
            leads_delta: pct(k.leads_received, kp.leads_received),
            campaigns_active: campaigns.filter((c: any) => (c.status || '').toLowerCase() === 'running').length,
            total_spend: k.total_spend ?? 0,
            spend_delta: pct(k.total_spend, kp.total_spend),
            meetings_booked: meetings,
            pipeline_generated: k.active_pipeline_value ?? 0,
            pipeline_delta: pct(k.active_pipeline_value, kp.active_pipeline_value),
            sqls: stats?.warm_leads ?? 0,
        };
    }, [impactPeriod, impactPrev, stats, campaigns]);

    const deltaLabel = deltaLabelFor(period);

    const campaignStatus = useMemo(() => {
        const count = (pred: (s: string) => boolean) => campaigns.filter((c: any) => pred((c.status || '').toLowerCase())).length;
        return [
            { label: 'Active', value: count(s => s === 'running'), color: '#22C55E' },
            { label: 'Scheduled', value: count(s => s === 'scheduled'), color: '#3B82F6' },
            { label: 'Draft', value: count(s => s === 'draft'), color: '#F59E0B' },
            { label: 'Completed', value: count(s => s === 'completed' || s === 'cancelled'), color: '#8B5CF6' },
        ];
    }, [campaigns]);
    const campaignTotal = campaigns.length;

    const trend = useMemo(() => {
        const mt = impactYear?.monthly_trend || [];
        const pick = (m: any) => {
            if (trendChannel === 'meta') return m.metaLeads || 0;
            if (trendChannel === 'linkedin') return m.linkedinLeads || 0;
            return m.leads || 0; // blended
        };
        return mt.map((m: any) => ({ d: m.label, v: pick(m) }));
    }, [impactYear, trendChannel]);
    const trendTotal = trend.reduce((a: number, b: any) => a + b.v, 0);
    const trendColor = trendChannel === 'meta' ? '#1877F2' : trendChannel === 'linkedin' ? '#0A66C2' : '#6366F1';

    const campaignSpend = useMemo(() => {
        const cb = impactPeriod?.campaign_breakdown || [];
        return cb.filter((c: any) => (c.spend || 0) > 0 || (c.leads || 0) > 0)
            .sort((a: any, b: any) => (b.spend || 0) - (a.spend || 0))
            .slice(0, 7)
            .map((c: any) => ({ name: c.name, spend: c.spend || 0, leads: c.leads || 0, cpl: c.cpl || (c.leads ? (c.spend || 0) / c.leads : 0) }));
    }, [impactPeriod]);

    // Color-grade CPL relative to the displayed rows' median, so "good/bad" is
    // judged against this dataset rather than a hardcoded INR threshold.
    const cplTone = useMemo(() => {
        const vals = campaignSpend.filter((c: any) => c.leads).map((c: any) => c.cpl).sort((a: number, b: number) => a - b);
        const median = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
        return (v: number) => {
            if (!median) return 'text-text-primary';
            if (v <= median * 0.75) return 'text-emerald-600';  // efficient — good
            if (v >= median * 1.5) return 'text-rose-500';      // expensive — bad
            if (v >= median * 1.15) return 'text-amber-600';    // slightly high — watch
            return 'text-text-primary';                          // around median
        };
    }, [campaignSpend]);

    const team = useMemo(() => {
        // Prefer current period data; fallback to year data if period is empty.
        // This ensures we show SOMETHING even if the selected period has no leads.
        const rp = (impactPeriod?.rep_performance && impactPeriod.rep_performance.length > 0)
            ? impactPeriod.rep_performance
            : (impactYear?.rep_performance || []);
        const meetingsByName: Record<string, number> = {};
        (stats?.user_performance || []).forEach((u: any) => { meetingsByName[(u.user_name || '').toLowerCase()] = u.meetings || 0; });
        let teamList = rp.filter((r: any) => r.name && r.name !== 'Unassigned')
            .sort((a: any, b: any) => (b.leads || 0) - (a.leads || 0) || (b.won || 0) - (a.won || 0))
            .map((r: any) => ({
                name: r.name, leads: r.leads || 0,
                meetings: meetingsByName[(r.name || '').toLowerCase()] ?? 0,
                sqls: r.won || 0, winRate: Math.round(r.win_rate || 0),
            }));

        // Add specific team members if not already in the list
        const existingNames = new Set(teamList.map((t: any) => t.name.toLowerCase()));
        const additionalReps = [
            { name: 'Harshini', leads: 0, meetings: 0, sqls: 0, winRate: 0 },
            { name: 'Neha', leads: 0, meetings: 0, sqls: 0, winRate: 0 },
        ];

        for (const rep of additionalReps) {
            if (!existingNames.has(rep.name.toLowerCase())) {
                teamList.push(rep);
            }
        }

        return teamList.slice(0, 6);
    }, [impactPeriod, impactYear, stats]);

    const signals = useMemo(() => {
        const pl = stats?.priority_leads || [];
        const now = Date.now();
        const agoLabel = (d?: string) => {
            if (!d) return null;
            const mins = Math.floor((now - new Date(d).getTime()) / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return `${mins}m ago`;
            const h = Math.floor(mins / 60); if (h < 24) return `${h}h ago`;
            return `${Math.floor(h / 24)}d ago`;
        };
        // No fabricated score — these are the org's real hot/warm (priority) leads,
        // ranked by the backend; we surface their real status tier + last activity.
        return pl.slice(0, 5).map((l: any) => {
            const hot = /hot/i.test(l.status_name || '');
            return {
                id: l.id, name: l.company_name || l.full_name,
                meta: l.location || '—', reason: l.campaign || 'High-intent signal',
                status: l.status_name || (hot ? 'Hot' : 'Warm'),
                tier: hot ? 'Very Hot' : 'Hot', lastAgo: agoLabel(l.last_update),
            };
        });
    }, [stats]);

    const latestLeads = useMemo(() => latest.slice(0, 5).map((l: any) => ({
        id: l.id,
        name: l.contact_person || l.company_name || 'Unnamed Lead',
        company: l.company_name || null,
        phone: l.contact_number || null,
        seats: l.seats ?? null,
        requirement: l.requirement || null,
        campaign: l.campaign || l.meta_form_name || null,
        priority: l.priority || 'Medium',
        created_at: l.created_at,
    })), [latest]);

    const calendar = useMemo(() => {
        const wk = weekBounds();
        const days = DAY_LABELS.map((label, i) => {
            const d = new Date(wk.mon.getFullYear(), wk.mon.getMonth(), wk.mon.getDate() + i);
            return { label, date: d.getDate(), key: fmtDate(d), events: [] as any[] };
        });
        const byKey: Record<string, any> = {}; days.forEach(d => byKey[d.key] = d);
        for (const e of events) {
            const dt = e.start_datetime ? new Date(e.start_datetime) : null;
            if (!dt) continue;
            const key = fmtDate(dt);
            if (byKey[key]) byKey[key].events.push({
                title: e.title || e.event_type || 'Event',
                time: dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }),
                color: e.event_type === 'meeting' ? 'violet' : e.event_type === 'call' ? 'blue' : e.event_type === 'site_visit' ? 'emerald' : 'amber',
                user: e.user_info,
            });
        }
        return days;
    }, [events]);
    const calendarHasEvents = calendar.some(d => d.events.length);

    // Extract unique reps from events for profile header
    const eventReps = useMemo(() => {
        const repsMap = new Map<string, any>();
        for (const e of events) {
            if (e.user_id && !repsMap.has(e.user_id)) {
                const userInfo = Array.isArray(e.user_info) ? e.user_info[0] : e.user_info;
                repsMap.set(e.user_id, {
                    id: e.user_id,
                    name: userInfo?.full_name || 'Unknown',
                    avatar: userInfo?.user_photo_url || userInfo?.avatar_url,
                    eventCount: 0,
                });
            }
        }
        // Count events per rep
        for (const e of events) {
            if (e.user_id && repsMap.has(e.user_id)) {
                repsMap.get(e.user_id)!.eventCount++;
            }
        }
        return Array.from(repsMap.values()).sort((a: any, b: any) => b.eventCount - a.eventCount);
    }, [events]);

    const aiInsights = useMemo(() => {
        const hot = stats?.hot_leads ?? 0;
        const topRep = team[0]?.name;
        const under = impactYear?.insights?.underperformer?.name || impactPeriod?.insights?.underperformer?.name;
        const topCampaign = impactYear?.insights?.top_campaign?.name;
        const bullets: string[] = [];
        if (topCampaign) bullets.push(`"${topCampaign}" is your best-performing campaign this period.`);
        if (under) bullets.push(`Campaign "${under}" is underperforming — review targeting/spend.`);
        if (topRep) bullets.push(`${topRep} is your top performer by pipeline.`);
        return { hot, bullets };
    }, [stats, team, impactYear, impactPeriod]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-3">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center animate-pulse">
                    <Command className="w-6 h-6 text-primary" />
                </div>
                <TextShimmer duration={1.2} className="text-sm font-bold" baseColor="#64748b" gradientColor="#cbd5e1">
                    Loading command center…
                </TextShimmer>
            </div>
        );
    }

    return (
        <div className="space-y-6 -mt-2 w-full min-w-0">
            {/* Top header strip */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0 sm:max-w-2xl relative order-2 sm:order-1 basis-full sm:basis-auto">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                    <input placeholder="Search leads, companies, campaigns..." className="w-full pl-11 pr-12 py-2.5 bg-surface-elevated border border-border rounded-full text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-text-tertiary bg-surface border border-border rounded px-1.5 py-0.5">⌘K</kbd>
                </div>
                <div className="flex items-center gap-3 ml-auto order-1 sm:order-2 shrink-0">
                    <Link href={`/${orgId}/crm/ai`} className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-gradient-to-r from-violet-500/10 to-indigo-500/10 border border-violet-300/40 dark:border-violet-700/40 text-violet-700 dark:text-violet-300 hover:from-violet-500/20 hover:to-indigo-500/20 transition-colors">
                        <Sparkles className="w-4 h-4" /><span className="text-xs font-bold hidden sm:inline">AI Agent</span>
                    </Link>
                    <button className="relative w-9 h-9 rounded-full bg-surface-elevated border border-border flex items-center justify-center hover:bg-muted transition-colors">
                        <Bell className="w-4 h-4 text-text-secondary" />
                        {kpis.leads_received > 0 && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{Math.min(99, stats?.overdue_followups || 0)}</span>}
                    </button>
                    <div className="flex items-center gap-2.5 pl-2">
                        {user?.user_metadata?.avatar_url || user?.user_metadata?.user_photo_url ? (
                            <img src={user.user_metadata.user_photo_url || user.user_metadata.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-border" />
                        ) : (
                            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-display font-bold text-xs">{firstName.charAt(0).toUpperCase()}</div>
                        )}
                        <div className="hidden lg:block leading-tight">
                            <p className="text-xs font-bold text-text-primary">{user?.user_metadata?.full_name || firstName}</p>
                            <p className="text-[10px] text-text-tertiary font-medium">BD Super Admin</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Greeting + filters */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-text-primary tracking-tight flex items-center gap-2">{getGreeting()}, {firstName} <span className="text-xl">👋</span></h1>
                    <p className="text-sm text-text-secondary mt-0.5">Here's what's happening across your GTM engine today.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 min-w-0">
                    <div ref={cityRef} className="relative shrink-0">
                        <button onClick={() => setCityOpen(o => !o)} className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-full hover:border-primary transition-all text-sm font-bold text-text-primary">
                            <MapPin className="w-4 h-4 text-primary" />{city}<ChevronDown className={`w-4 h-4 text-text-tertiary transition-transform ${cityOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {cityOpen && (
                            <div className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-xl shadow-xl z-50 min-w-[160px] overflow-hidden max-h-72 overflow-y-auto">
                                {cities.map(c => (
                                    <button key={c} onClick={() => { setCity(c); setCityOpen(false); play('toggle'); }} className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${city === c ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-muted'}`}>
                                        <MapPin className="w-3.5 h-3.5" /> {c}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-2 min-w-0 max-w-full">
                        <div className="flex items-center gap-0.5 bg-surface-elevated rounded-full p-1 border border-border max-w-full overflow-x-auto no-scrollbar">
                            {PERIODS.map(p => (
                                <button key={p} onClick={() => { setPeriod(p); play('toggle'); }} className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${period === p ? 'bg-amber-400 text-slate-900' : 'text-text-secondary hover:text-text-primary'}`}>{p}</button>
                            ))}
                        </div>
                        {period === 'Custom' && (
                            <div className="flex items-center gap-2 bg-surface border border-border rounded-xl px-3 py-2">
                                <span className="text-[11px] font-bold text-text-tertiary">From</span>
                                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="text-xs font-bold text-text-primary bg-transparent outline-none cursor-pointer" />
                                <span className="text-[11px] font-bold text-text-tertiary">To</span>
                                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="text-xs font-bold text-text-primary bg-transparent outline-none cursor-pointer" />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Data scope disclaimer */}
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
                <Megaphone className="w-3.5 h-3.5 shrink-0" />
                <span>All data shown is exclusive to <strong>Meta campaigns</strong> of <strong>Smart Office Builds</strong>. LinkedIn and Google spend/leads are not reflected here.</span>
            </div>

            {/* 6 KPI cards */}
            <motion.div
                className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4"
                variants={reduceMotion ? undefined : KPI_GRID_VARIANTS}
                initial={reduceMotion ? undefined : 'hidden'}
                animate={reduceMotion ? undefined : 'show'}
            >
                {[
                    <KpiCard key="leads" icon={Users} tint="violet" label="Leads Received" value={compactNum(kpis.leads_received)} delta={kpis.leads_delta} deltaLabel={deltaLabel} href={`/${orgId}/crm/leads`} />,
                    <KpiCard key="camp" icon={Megaphone} tint="rose" label="Campaigns Active" value={compactNum(kpis.campaigns_active)} delta={null} sub={`of ${campaignTotal} total`} href={`/${orgId}/crm/campaigns`} />,
                    <KpiCard key="spend" icon={Wallet} tint="amber" label="Total Spend" value={inrCompact(kpis.total_spend)} delta={kpis.spend_delta} deltaLabel={deltaLabel} href={`/${orgId}/crm/campaigns`} />,
                    <KpiCard key="mtg" icon={CalendarCheck} tint="blue" label="Meetings Booked" value={compactNum(kpis.meetings_booked)} delta={null} href={`/${orgId}/crm/calendar`} />,
                    <KpiCard key="pipe" icon={TrendingUp} tint="emerald" label="Pipeline Generated" value={inrCompact(kpis.pipeline_generated)} delta={kpis.pipeline_delta} deltaLabel={deltaLabel} href={`/${orgId}/crm/leads`} />,
                    <KpiCard key="sql" icon={Target} tint="pink" label="SQLs" value={compactNum(kpis.sqls)} delta={null} sub="warm + MQL" href={`/${orgId}/crm/leads`} />,
                ].map((card, i) => (
                    reduceMotion ? card : <motion.div key={i} variants={KPI_ITEM_VARIANTS} className="h-full">{card}</motion.div>
                ))}
            </motion.div>

            {/* Blended channel performance (Meta / LinkedIn / Google) */}
            {channelMix.length > 0 && (
                <Panel title="Channel Performance" href={`/${orgId}/crm/marketing`} linkLabel="Full marketing report">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[520px]">
                            <thead>
                                <tr className="text-left text-[11px] font-bold text-text-tertiary uppercase border-b border-border">
                                    <th className="px-4 py-2">Channel</th>
                                    <th className="px-4 py-2">Spend</th>
                                    <th className="px-4 py-2">Leads</th>
                                    <th className="px-4 py-2">CTR</th>
                                    <th className="px-4 py-2">CPL</th>
                                    <th className="px-4 py-2">Impressions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {channelMix.map((r: any) => {
                                    const meta = CHANNEL_BADGE[r.channel] || CHANNEL_BADGE.other;
                                    const maxSpend = Math.max(1, ...channelMix.map((x: any) => x.spend));
                                    return (
                                        <tr key={r.channel} className="border-b border-border last:border-0">
                                            <td className="px-4 py-2.5">
                                                <span className="inline-flex items-center gap-2 font-bold text-text-primary">
                                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-black text-white" style={{ backgroundColor: meta.color }}>{meta.glyph}</span>
                                                    {meta.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-text-primary whitespace-nowrap">{inrCompact(r.spend)}</span>
                                                    <div className="flex-1 h-1.5 bg-surface-elevated rounded-full overflow-hidden min-w-[40px]">
                                                        <div className="h-full rounded-full" style={{ width: `${Math.max(3, (r.spend / maxSpend) * 100)}%`, backgroundColor: meta.color }} />
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2.5 font-bold text-text-primary">{compactNum(r.leads)}</td>
                                            <td className="px-4 py-2.5 text-text-secondary">{r.ctr != null ? `${r.ctr.toFixed(2)}%` : '—'}</td>
                                            <td className="px-4 py-2.5 text-text-secondary">{r.cpl != null ? inrCompact(Math.round(r.cpl)) : '—'}</td>
                                            <td className="px-4 py-2.5 text-text-secondary">{compactNum(r.impressions)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Panel>
            )}

            {/* Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Panel title="New Leads" href={`/${orgId}/crm/leads`} linkLabel="View all leads">
                    {latestLeads.length === 0 ? <Empty msg="No leads yet" /> : (
                        <div className="divide-y divide-border">
                            {latestLeads.map((l: any) => {
                                const ago = (() => {
                                    const mins = Math.floor((Date.now() - new Date(l.created_at).getTime()) / 60000);
                                    if (mins < 60) return `${mins}m ago`;
                                    const h = Math.floor(mins / 60); if (h < 24) return `${h}h ago`;
                                    return `${Math.floor(h / 24)}d ago`;
                                })();
                                return (
                                    <Link key={l.id} href={`/${orgId}/crm/leads?lead=${l.id}`} className="px-4 py-2.5 flex items-center gap-3 hover:bg-surface-elevated transition-colors">
                                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-black text-primary flex-shrink-0">
                                            {(l.name || '?').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-text-primary truncate">{l.name}</p>
                                            <p className="text-[10px] text-text-tertiary truncate">
                                                {l.seats != null ? `${l.seats} seats` : l.requirement ? l.requirement.slice(0, 30) : l.campaign || '—'}
                                            </p>
                                        </div>
                                        <span className="text-[10px] text-text-tertiary whitespace-nowrap">{ago}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </Panel>

                <Panel
                    title="Leads Received Trend"
                    right={
                        <div className="flex items-center gap-2">
                            {trendKey === 'custom' && (
                                <span className="flex items-center gap-1">
                                    <input type="date" value={trendCustom.from} onChange={e => setTrendCustom(c => ({ ...c, from: e.target.value }))}
                                        className="border border-border rounded-lg px-2 py-1 text-[11px] bg-surface" />
                                    <span className="text-text-tertiary text-[11px]">–</span>
                                    <input type="date" value={trendCustom.to} onChange={e => setTrendCustom(c => ({ ...c, to: e.target.value }))}
                                        className="border border-border rounded-lg px-2 py-1 text-[11px] bg-surface" />
                                </span>
                            )}
                            <MiniSelect
                                label={{ '15d': 'Last 15 days', '3m': 'Last 3 mo', '6m': 'Last 6 mo', '12m': 'Last 12 mo', custom: 'Custom' }[trendKey]}
                                options={['Last 15 days', 'Last 3 mo', 'Last 6 mo', 'Last 12 mo', 'Custom']}
                                onSelect={v => setTrendKey(v === 'Last 15 days' ? '15d' : v === 'Last 3 mo' ? '3m' : v === 'Last 6 mo' ? '6m' : v === 'Custom' ? 'custom' : '12m')}
                            />
                        </div>
                    }
                >
                    <div className="px-5 py-3">
                        {/* Channel toggle: blended vs Meta-only vs LinkedIn-only */}
                        <div className="flex items-center gap-0.5 bg-surface-elevated rounded-full p-1 border border-border w-fit mb-3">
                            {([
                                { key: 'blended', label: 'Blended', color: '#6366F1' },
                                { key: 'meta', label: 'Meta', color: '#1877F2' },
                                { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
                            ] as const).map(c => (
                                <button
                                    key={c.key}
                                    onClick={() => { setTrendChannel(c.key); play('toggle'); }}
                                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${trendChannel === c.key ? 'text-white' : 'text-text-secondary hover:text-text-primary'}`}
                                    style={trendChannel === c.key ? { backgroundColor: c.color } : undefined}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: trendChannel === c.key ? '#fff' : c.color }} />
                                    {c.label}
                                </button>
                            ))}
                        </div>
                        {trend.length === 0 || trendTotal === 0 ? (
                            <Empty msg={trendChannel === 'blended' ? 'No lead history' : `No ${trendChannel === 'meta' ? 'Meta' : 'LinkedIn'} leads in this range`} />
                        ) : (
                            <>
                                <div className="flex items-baseline gap-2 mb-2">
                                    <span className="text-2xl font-black text-text-primary">{compactNum(trendTotal)}</span>
                                    <span className="text-[11px] text-text-tertiary font-medium">
                                        {trendChannel === 'blended' ? 'leads' : `${trendChannel === 'meta' ? 'Meta' : 'LinkedIn'} leads`} · {{ '15d': 'last 15 days', '3m': 'last 3 months', '6m': 'last 6 months', '12m': 'last 12 months', custom: 'custom range' }[trendKey]}
                                    </span>
                                </div>
                                <ResponsiveContainer width="100%" height={150}>
                                    <AreaChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                        <defs><linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={trendColor} stopOpacity={0.25} /><stop offset="100%" stopColor={trendColor} stopOpacity={0} /></linearGradient></defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                                        <XAxis dataKey="d" stroke="#94A3B8" tickLine={false} axisLine={false} style={{ fontSize: 10 }} interval="preserveStartEnd" />
                                        <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} style={{ fontSize: 10 }} width={36} />
                                        <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }} />
                                        <Area type="monotone" dataKey="v" stroke={trendColor} strokeWidth={2} fill="url(#leadFill)" dot={{ r: 2.5, fill: trendColor }} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </>
                        )}
                    </div>
                </Panel>

                <Panel title="Spend per Campaign" href={`/${orgId}/crm/campaigns`} linkLabel="View campaigns" right={<MiniSelect label={period} options={[...PERIODS]} onSelect={v => setPeriod(v as Period)} />}>
                    {campaignSpend.length === 0 ? <Empty msg="No spend in this period" /> : (
                        <div className="px-3 pb-2 overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead><tr className="text-text-tertiary">
                                    <th className="text-left font-bold py-2 px-2">Campaign</th>
                                    <th className="text-right font-bold py-2 px-2">Spend</th>
                                    <th className="text-right font-bold py-2 px-2">Leads</th>
                                    <th className="text-right font-bold py-2 px-2">CPL</th>
                                </tr></thead>
                                <tbody className="divide-y divide-border">
                                    {campaignSpend.map((c: any) => (
                                        <tr key={c.name}>
                                            <td className="py-2 px-2 font-bold text-text-primary truncate max-w-[150px]">{c.name}</td>
                                            <td className="py-2 px-2 text-right font-bold tabular-nums text-text-primary">{inrCompact(c.spend)}</td>
                                            <td className="py-2 px-2 text-right font-bold tabular-nums text-primary">{c.leads}</td>
                                            <td className={`py-2 px-2 text-right font-bold tabular-nums ${c.leads ? cplTone(c.cpl) : 'text-text-tertiary'}`}>{c.leads ? inrCompact(c.cpl) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Panel>
            </div>

            {/* Row 3 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-5">
                    <Panel title="Team Performance" href={`/${orgId}/crm/performance`} linkLabel="View full team report" right={<MiniSelect label={period} options={[...PERIODS]} onSelect={v => setPeriod(v as Period)} />}>
                        {team.length === 0 ? <Empty msg="No rep activity yet" /> : (
                            <div className="px-3 pb-2 overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead><tr className="text-text-tertiary">
                                        <th className="text-left font-bold py-2 px-2"> </th>
                                        <th className="text-right font-bold py-2 px-1">Leads</th>
                                        <th className="text-right font-bold py-2 px-1">Mtgs</th>
                                        <th className="text-right font-bold py-2 px-1">Won</th>
                                        <th className="text-right font-bold py-2 px-1">Win%</th>
                                    </tr></thead>
                                    <tbody className="divide-y divide-border">
                                        {team.map((t: any) => (
                                            <tr key={t.name}>
                                                <td className="py-2 px-2"><div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-black text-primary flex-shrink-0">{(t.name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}</div>
                                                    <span className="font-bold text-text-primary whitespace-nowrap">{t.name}</span>
                                                </div></td>
                                                <td className="py-2 px-1 text-right whitespace-nowrap font-bold tabular-nums text-primary">{t.leads}</td>
                                                <td className="py-2 px-1 text-right font-bold tabular-nums text-text-primary">{t.meetings}</td>
                                                <td className="py-2 px-1 text-right font-bold tabular-nums text-violet-600">{t.sqls}</td>
                                                <td className="py-2 px-1 text-right font-bold tabular-nums text-emerald-600">{t.winRate}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Panel>
                </div>

                <div className="lg:col-span-7 flex flex-col">
                    <RepTimeGridCalendar
                        events={events}
                        reps={eventReps}
                        orgId={orgId}
                    />
                </div>
            </div>

            {/* Row 4 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <Panel title="ABM Tracker — Top Accounts">
                        {accounts.length === 0 ? <Empty msg="No accounts yet" /> : (
                            <div className="px-3 pb-2 overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead><tr className="text-text-tertiary">
                                        <th className="text-left font-bold py-2 px-2">Account</th>
                                        <th className="text-left font-bold py-2 px-2">Tier</th>
                                        <th className="text-left font-bold py-2 px-2">Engagement</th>
                                        <th className="text-right font-bold py-2 px-2">People</th>
                                        <th className="text-right font-bold py-2 px-2">Activities</th>
                                        <th className="text-right font-bold py-2 px-2">Pipeline</th>
                                        <th className="text-left font-bold py-2 px-2">Status</th>
                                    </tr></thead>
                                    <tbody className="divide-y divide-border">
                                        {accounts.map((a: any) => (
                                            <tr key={a.account}>
                                                <td className="py-2.5 px-2 font-bold text-text-primary whitespace-nowrap max-w-[160px] truncate">{a.account}</td>
                                                <td className="py-2.5 px-2"><span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${a.tier === 1 ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>Tier {a.tier}</span></td>
                                                <td className="py-2.5 px-2"><div className="flex items-center gap-1.5"><div className="w-16 h-1.5 bg-surface-elevated rounded-full overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-rose-400 to-amber-400" style={{ width: `${a.engagement}%` }} /></div><span className="text-[10px] font-bold text-text-secondary">{a.engagement}</span></div></td>
                                                <td className="py-2.5 px-2 text-right text-text-secondary">{a.people}</td>
                                                <td className="py-2.5 px-2 text-right text-text-secondary">{a.activities}</td>
                                                <td className="py-2.5 px-2 text-right font-bold text-text-primary whitespace-nowrap">{inrCompact(a.pipeline)}</td>
                                                <td className="py-2.5 px-2 text-text-secondary whitespace-nowrap max-w-[120px] truncate">{a.top_status || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Panel>
                </div>

                <div className="bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/20 rounded-2xl border border-violet-200/50 dark:border-violet-800/30 p-5 flex flex-col">
                    <div className="flex items-center gap-2 mb-3"><Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" /><h2 className="text-sm font-black text-text-primary">AI Agent Insights</h2></div>
                    <div className="flex items-start gap-3 mb-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/30"><Bot className="w-6 h-6 text-white" /></div>
                        <p className="text-sm font-bold text-text-primary leading-snug">{aiInsights.hot > 0 ? `You have ${aiInsights.hot} high-intent lead${aiInsights.hot > 1 ? 's' : ''} ready for immediate outreach.` : 'No high-intent leads pending right now — pipeline is under control.'}</p>
                    </div>
                    <div className="space-y-2 flex-1">
                        {aiInsights.bullets.length === 0 ? (
                            <p className="text-xs text-text-tertiary">Insights appear as campaign and rep data accumulates.</p>
                        ) : aiInsights.bullets.map((b: string, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-text-secondary"><span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 flex-shrink-0" /><span className="leading-relaxed">{b}</span></div>
                        ))}
                    </div>
                    <Link href={`/${orgId}/crm/ai`} className="inline-flex items-center gap-1 text-xs font-bold text-violet-600 dark:text-violet-400 hover:underline mt-4">Ask AI Agent anything <ArrowRight className="w-3 h-3" /></Link>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                       */
/* ------------------------------------------------------------------ */

const TINTS: Record<string, string> = {
    violet: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
    rose: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',
    amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
    emerald: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
    pink: 'bg-pink-100 text-pink-600 dark:bg-pink-900/40 dark:text-pink-400',
};

function KpiCard({ icon: Icon, tint, label, value, delta, deltaLabel, sub, href }: { icon: React.ElementType; tint: string; label: string; value: string; delta: number | null; deltaLabel?: string; sub?: string; href?: string; }) {
    const reduce = useReducedMotion();
    const animatedValue = useCountUp(value, !reduce);
    const inner = (
        <>
            <div className="flex items-start justify-between mb-3">
                <p className="text-[11px] font-bold text-text-secondary">{label}</p>
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${TINTS[tint]}`}><Icon className="w-4 h-4" /></div>
            </div>
            <p className="text-2xl font-black text-text-primary tracking-tight tabular-nums">{animatedValue}</p>
            {delta != null ? (
                <div className="flex items-center gap-1 mt-1.5">
                    {delta >= 0 ? <ArrowUpRight className="w-3 h-3 text-emerald-500" /> : <ArrowDownRight className="w-3 h-3 text-rose-500" />}
                    <span className={`text-[11px] font-bold ${delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{Math.abs(delta)}%</span>
                    <span className="text-[10px] text-text-tertiary">{deltaLabel || 'vs last period'}</span>
                </div>
            ) : sub ? <p className="text-[10px] text-text-tertiary mt-1.5">{sub}</p> : <p className="text-[10px] text-text-tertiary mt-1.5 opacity-0">·</p>}
        </>
    );
    const cls = `crm-card bg-surface rounded-2xl border border-border p-4 h-full ${href ? 'hover:border-primary cursor-pointer' : ''}`;
    if (!href) return <div className={cls}>{inner}</div>;
    return (
        <motion.div whileTap={reduce ? undefined : { scale: 0.97 }} className="h-full">
            <Link href={href} className={`${cls} block`}>{inner}</Link>
        </motion.div>
    );
}

function Panel({ title, href, linkLabel, right, children }: { title: string; href?: string; linkLabel?: string; right?: React.ReactNode; children: React.ReactNode; }) {
    return (
        <div className="crm-card bg-surface rounded-2xl border border-border overflow-hidden flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                <h2 className="text-sm font-black text-text-primary">{title}</h2>
                {right || (href && (
                    <Link href={href} className="text-text-tertiary hover:text-primary transition-colors">
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                ))}
            </div>
            <div className="flex-1">{children}</div>
            {href && linkLabel && (
                <Link href={href} className="flex items-center gap-1 px-5 py-3 border-t border-border text-[11px] font-bold text-primary hover:underline">{linkLabel} <ArrowRight className="w-3 h-3" /></Link>
            )}
        </div>
    );
}

function MiniSelect({ label, options, onSelect }: { label: string; options?: string[]; onSelect?: (v: string) => void }) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [open]);
    if (!options || !onSelect) {
        return <div className="flex items-center gap-1 px-2.5 py-1 bg-surface-elevated border border-border rounded-lg text-[10px] font-bold text-text-secondary">{label} <ChevronDown className="w-3 h-3" /></div>;
    }
    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 px-2.5 py-1 bg-surface-elevated border border-border rounded-lg text-[10px] font-bold text-text-secondary hover:border-primary transition-colors">
                {label} <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-xl shadow-xl z-50 min-w-[130px] overflow-hidden">
                    {options.map(o => (
                        <button key={o} onClick={() => { onSelect(o); setOpen(false); }} className={`w-full text-left px-3 py-2 text-[11px] font-bold transition-colors ${o === label ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-muted'}`}>{o}</button>
                    ))}
                </div>
            )}
        </div>
    );
}

function PriorityChip({ priority }: { priority: string }) {
    const p = (priority || '').toLowerCase();
    const cls = /high|urgent/.test(p) ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300' : /medium/.test(p) ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300';
    return <span className={`text-[9px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ${cls}`}>{priority}</span>;
}

function Empty({ msg }: { msg: string }) {
    return <div className="flex flex-col items-center justify-center py-10 text-center px-4"><CalendarDays className="w-7 h-7 text-text-tertiary mb-2" /><p className="text-xs font-medium text-text-tertiary">{msg}</p></div>;
}

function calColor(color: string): string {
    switch (color) {
        case 'blue': return 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
        case 'violet': return 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300';
        case 'emerald': return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
        case 'amber': return 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
        case 'rose': return 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
        default: return 'bg-slate-50 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300';
    }
}
