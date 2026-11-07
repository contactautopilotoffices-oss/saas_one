'use client';

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/frontend/context/AuthContext';
import { useWidgetData, inr, type WidgetDataState } from '@/frontend/lib/dashboard/useWidgetData';
import {
    activeTicketsOf, siteScore, type CcAopSummary, type CcTicketsSummary,
} from '@/frontend/components/dashboard/command-center/mockData';
import type { ElecPacePayload } from '@/frontend/components/dashboard/command-center/IntelligenceRow';
import { ORG_WIDE_ROLES, ROLE_LABELS } from '../lab/nav';
import { RAW_ACTIVE, RAW_CLOSED, RAW_WAITLIST } from '../lab/status';
import { fromRow } from '../lab/useLabModel';
import { SAMPLE_NOW } from '../lab/sample';
import { initials } from '../lab/format';
import type { PreviewState } from '../lab/types';
import { ORG_SAMPLE } from './orgSample';
import { ORG_SAMPLE_TICKETS, type OrgTicketRow } from './orgTickets';

/**
 * Data for the org super admin mobile dashboard.
 *
 * LIVE (read only): the same org feeds the Command Center already reads, through the same
 * useWidgetData hook and the same URLs, so the two share one cache, plus the org wide ticket
 * list from GET /api/tickets (the call the lab's ticket screens already make). SAMPLE: everything the
 * app has data for but no hook wires up yet (petty cash approvals, escalations, AMC expiry,
 * missed rounds, grievances, generators, water, meeting rooms), flagged so the design can
 * show a Sample badge. A viewer who is not signed in with an org-wide role sees sample data
 * throughout.
 */

export type FeedState = 'loading' | 'ready' | 'error' | 'off';
export interface Feed<T> {
    state: FeedState;
    data: T | null;
    sample: boolean;
    retry: () => void;
    /** Why a feed is 'off': module not set up, or not available to this role. */
    offReason?: string;
}

export type OrgPeriod = 'today' | 'month' | 'all';

export interface OrgSite {
    id: string;
    name: string;
    code: string;
    score: number;
    active: number;
    urgent: number;
    /** Rupees over this month's budget, when the AOP feed names the site as overspending. */
    overBudget: number | null;
    trend: number[];
}

export interface Approval {
    id: 'po' | 'mr' | 'petty' | 'escalation';
    label: string;
    detail: string;
    count: number;
    value: string | null;
    urgent: boolean;
    action: string;
}

/* Payload shapes for feeds whose types the Command Center keeps private (copied from there). */
interface AccountsPayload {
    totals: { po_count: number; po_value: number };
    queue: { align: { total_count: number; total_value: number; critical_count: number }; complete: { total_count: number; total_value: number } };
}
interface MrPayload {
    provisioned: boolean;
    totals: { needs_quote: number; needs_decision: number; oldest_days: number } | null;
}
interface RosterPayload {
    provisioned: boolean;
    scheduled?: number; present?: number; late?: number; absent?: number; coverage_pct?: number | null;
    short_tomorrow?: number; worst_property?: { name: string; absent: number } | null;
}
interface PpmPayload {
    provisioned: boolean;
    completed_pct?: number; due_today?: number; overdue?: number; target_pct?: number;
    most_overdue_system?: { name: string; count: number } | null;
}
interface TrackerPayload {
    provisioned: boolean;
    deadlines?: {
        overdue: unknown[]; due_soon: unknown[]; discount_expiring: unknown[];
        money_at_risk: { discount_at_risk: number; penalty_exposure: number };
    };
}
interface VmsPayload { total_visitors: number; total_checked_in: number; properties: unknown[] }
interface TicketsPayload { tickets: Record<string, unknown>[]; total: number }
interface VendorPayload { total_revenue: number; properties: Array<{ property_name: string; total_revenue: number }> }

const noop = () => undefined;

export function sampleFeed<T>(data: T): Feed<T> {
    return { state: 'ready', data, sample: true, retry: noop };
}

/** One live feed: loading, error, not set up ('off'), or ready with mapped data. */
function liveFeed<P, T>(q: WidgetDataState<P>, map: (p: P) => T | null): Feed<T> {
    if (q.loading) return { state: 'loading', data: null, sample: false, retry: q.refresh };
    if (q.error === 'forbidden') return { state: 'off', data: null, sample: false, retry: q.refresh, offReason: 'Not available to your role' };
    if (q.error) return { state: 'error', data: null, sample: false, retry: q.refresh };
    const d = q.data ? map(q.data) : null;
    if (d === null) return { state: 'off', data: null, sample: false, retry: q.refresh, offReason: 'Not set up for this organisation yet' };
    return { state: 'ready', data: d, sample: false, retry: q.refresh };
}

/** Preview states from the lab bar override every feed, so each design shows them. */
export function preview<T>(f: Feed<T>, p: PreviewState, empty: T | null): Feed<T> {
    if (p === 'loading') return { ...f, state: 'loading', data: null };
    if (p === 'error') return { ...f, state: 'error', data: null };
    if (p === 'empty') return empty === null ? { ...f, state: 'off', data: null, offReason: 'Nothing recorded yet' } : { ...f, state: 'ready', data: empty };
    return f;
}

function subscribeOnline(cb: () => void) {
    window.addEventListener('online', cb);
    window.addEventListener('offline', cb);
    return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
}

function scoreSites(t: CcTicketsSummary, aop: CcAopSummary | null): OrgSite[] {
    const over = new Map((aop?.overspending ?? []).map(o => [o.site_name, o.overspend]));
    return (t.properties ?? [])
        .map(p => ({
            id: p.property_id,
            name: p.property_name,
            code: p.property_code,
            score: siteScore(p),
            active: activeTicketsOf(p),
            urgent: p.urgent_open,
            overBudget: over.get(p.property_name) ?? null,
            trend: (p.trends?.active ?? []).slice(-14),
        }))
        .sort((a, b) => a.score - b.score);
}

export function healthOf(sites: OrgSite[]) {
    if (sites.length === 0) return { score: null as number | null, needAttention: 0, healthy: 0, count: 0 };
    const score = Math.round(sites.reduce((s, x) => s + x.score, 0) / sites.length);
    return {
        score,
        needAttention: sites.filter(s => s.score < 85).length,
        healthy: sites.filter(s => s.score >= 95).length,
        count: sites.length,
    };
}

export function useOrgModel(previewState: PreviewState) {
    const { user, membership } = useAuth();
    const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
    const orgRole = membership?.org_role ?? null;
    const orgWide = !!membership?.is_master_admin || (!!orgRole && ORG_WIDE_ROLES.includes(orgRole));
    const orgId = user && orgWide ? membership?.org_id ?? null : null;
    const live = !!orgId;
    const [period, setPeriod] = useState<OrgPeriod>('today');
    const [tick] = useState(() => new Date());
    const now = live ? tick : SAMPLE_NOW;

    const base = orgId ? `/api/organizations/${orgId}` : null;
    const ticketsQ = useWidgetData<CcTicketsSummary>(base ? `${base}/tickets-summary?period=all` : null, 5 * 60_000);
    const raisedQ = useWidgetData<CcTicketsSummary>(base && period !== 'all' ? `${base}/tickets-summary?period=${period}` : null, 5 * 60_000);
    const accountsQ = useWidgetData<AccountsPayload>(orgId ? `/api/accounts/summary?org_id=${orgId}&period=month` : null, 5 * 60_000);
    const mrQ = useWidgetData<MrPayload>(base ? `${base}/material-requests-summary` : null, 2 * 60_000);
    const aopQ = useWidgetData<CcAopSummary>(orgId ? `/api/aop/summary?org_id=${orgId}` : null, 5 * 60_000);
    const rosterQ = useWidgetData<RosterPayload>(base ? `${base}/roster-coverage` : null, 2 * 60_000);
    const ppmQ = useWidgetData<PpmPayload>(base ? `${base}/ppm-summary` : null, 5 * 60_000);
    const paceQ = useWidgetData<ElecPacePayload>(orgId ? `/api/electricity/pace?org_id=${orgId}` : null, 5 * 60_000);
    const trackerQ = useWidgetData<TrackerPayload>(orgId ? `/api/electricity/tracker?org_id=${orgId}` : null, 5 * 60_000);
    const vmsQ = useWidgetData<VmsPayload>(base ? `${base}/vms-summary?period=today` : null, 5 * 60_000);
    const vendorQ = useWidgetData<VendorPayload>(base ? `${base}/vendor-summary?period=month` : null, 5 * 60_000);
    // The same tickets endpoint the lab's ticket screens read, across every property of the org.
    const scope = orgId ? `/api/tickets?propertyId=all&organizationId=${orgId}` : null;
    const ticketsActiveQ = useWidgetData<TicketsPayload>(scope ? `${scope}&status=${RAW_ACTIVE}&limit=200` : null, 60_000);
    const ticketsWaitQ = useWidgetData<TicketsPayload>(scope ? `${scope}&status=${RAW_WAITLIST}&limit=50` : null, 60_000);
    const ticketsDoneQ = useWidgetData<TicketsPayload>(scope ? `${scope}&status=${RAW_CLOSED}&limit=30` : null, 60_000);

    const S = ORG_SAMPLE;
    const p = previewState;

    const feeds = useMemo(() => {
        const aopData = aopQ.data?.provisioned ? aopQ.data : null;

        const sites: Feed<OrgSite[]> = live
            ? liveFeed(ticketsQ, t => scoreSites(t, aopData))
            : sampleFeed(S.sites.map(s => ({
                id: s.id, name: s.name, code: s.code, active: s.active, urgent: s.urgent, trend: s.trend,
                score: Math.round(Math.max(0, Math.min(100, (s.resolved / s.total) * 100 - s.urgent * 5))),
                overBudget: S.budget.overSites.find(o => o.name === s.name)?.over ?? null,
            })).sort((a, b) => a.score - b.score));

        const tickets: Feed<{ breached: number; urgent: number; active: number }> = live
            ? liveFeed(ticketsQ, t => ({ breached: t.sla_breached, urgent: t.urgent_open, active: t.open_tickets + t.in_progress + t.pending_validation }))
            : sampleFeed(S.tickets);

        const raised: Feed<number> = live
            ? (period === 'all' ? liveFeed(ticketsQ, t => t.total_tickets) : liveFeed(raisedQ, t => t.total_tickets))
            : sampleFeed(S.raised[period]);

        const po: Feed<Approval> = live
            ? liveFeed(accountsQ, a => ({
                id: 'po', label: 'Purchase orders to approve', count: a.queue.align.total_count,
                value: inr(a.queue.align.total_value, { compact: true }),
                detail: a.queue.align.critical_count > 0 ? `${a.queue.align.critical_count} marked critical` : 'None marked critical',
                urgent: a.queue.align.critical_count > 0, action: 'Review',
            }))
            : sampleFeed<Approval>({ id: 'po', label: 'Purchase orders to approve', count: S.po.count, value: inr(S.po.value, { compact: true }), detail: `${S.po.critical} marked critical`, urgent: true, action: 'Review' });

        const mr: Feed<Approval> = live
            ? liveFeed(mrQ, m => (m.provisioned && m.totals ? {
                id: 'mr', label: 'Material requests need a decision', count: m.totals.needs_decision, value: null,
                detail: `${m.totals.needs_quote} still need a quote, oldest ${m.totals.oldest_days} days`, urgent: m.totals.oldest_days >= 7, action: 'Decide',
            } : null))
            : sampleFeed<Approval>({ id: 'mr', label: 'Material requests need a decision', count: S.mr.needsDecision, value: null, detail: `${S.mr.needsQuote} still need a quote, oldest ${S.mr.oldestDays} days`, urgent: true, action: 'Decide' });

        const petty = sampleFeed<Approval>({ id: 'petty', label: 'Petty cash requests', count: S.petty.count, value: inr(S.petty.value, { compact: true }), detail: `Oldest waiting ${S.petty.oldestDays} days`, urgent: false, action: 'Approve' });
        const escalation = sampleFeed<Approval>({ id: 'escalation', label: 'Tickets escalated to you', count: S.escalations.count, value: null, detail: S.escalations.top, urgent: true, action: 'Open' });

        const budget: Feed<{ pct: number; spent: number; total: number; overSites: { name: string; over: number }[] }> = live
            ? liveFeed(aopQ, a => (a.provisioned && a.current ? {
                pct: Math.round(a.current.utilisation_pct ?? 0), spent: a.current.actual, total: a.current.budget,
                overSites: (a.overspending ?? []).map(o => ({ name: o.site_name, over: o.overspend })),
            } : null))
            : sampleFeed(S.budget);

        const elec: Feed<{ deltaPct: number | null; units: number; previous: number; verdict: string | null; topSite: { name: string; deltaPct: number } | null }> = live
            ? liveFeed(paceQ, e => {
                if (!e.provisioned || !e.current) return null;
                const top = [...(e.properties ?? [])].filter(x => (x.delta_pct ?? 0) > 0).sort((a, b) => (b.delta_pct ?? 0) - (a.delta_pct ?? 0))[0];
                return {
                    deltaPct: e.delta_pct ?? null, units: e.current.units, previous: e.previous?.units ?? 0, verdict: e.verdict ?? null,
                    topSite: top ? { name: top.name, deltaPct: Math.round(top.delta_pct ?? 0) } : null,
                };
            })
            : sampleFeed({ deltaPct: S.elec.deltaPct, units: S.elec.units, previous: Math.round(S.elec.units / 1.06), verdict: S.elec.verdict, topSite: S.elec.topSite });

        const bills: Feed<{ count: number; atRisk: number }> = live
            ? liveFeed(trackerQ, b => (b.provisioned && b.deadlines ? {
                count: b.deadlines.overdue.length + b.deadlines.due_soon.length + b.deadlines.discount_expiring.length,
                atRisk: b.deadlines.money_at_risk.discount_at_risk + b.deadlines.money_at_risk.penalty_exposure,
            } : null))
            : sampleFeed(S.bills);

        const roster: Feed<typeof S.roster> = live
            ? liveFeed(rosterQ, r => (r.provisioned ? {
                coveragePct: Math.round(r.coverage_pct ?? 0), present: r.present ?? 0, scheduled: r.scheduled ?? 0, late: r.late ?? 0,
                absent: r.absent ?? 0, shortTomorrow: r.short_tomorrow ?? 0, worst: r.worst_property ?? { name: 'None', absent: 0 },
            } : null))
            : sampleFeed(S.roster);

        const ppm: Feed<typeof S.ppm> = live
            ? liveFeed(ppmQ, m => (m.provisioned ? {
                pct: Math.round(m.completed_pct ?? 0), target: m.target_pct ?? 95, overdue: m.overdue ?? 0, dueToday: m.due_today ?? 0,
                worstSystem: m.most_overdue_system ?? { name: 'None', count: 0 },
            } : null))
            : sampleFeed(S.ppm);

        const visitors: Feed<{ today: number; inside: number }> = live
            ? liveFeed(vmsQ, v => (Array.isArray(v.properties) ? { today: v.total_visitors, inside: v.total_checked_in } : null))
            : sampleFeed(S.visitors);

        const vendor: Feed<{ revenue: number; leader: string | null }> = live
            ? liveFeed(vendorQ, v => (Array.isArray(v.properties) ? { revenue: v.total_revenue, leader: v.properties.find(x => x.total_revenue > 0)?.property_name ?? null } : null))
            : sampleFeed(S.vendor);

        // Org wide ticket list: live from three status slices, or the org sample.
        const toRows = (q: WidgetDataState<TicketsPayload>) => (q.data?.tickets ?? []).map(r => ({ ...fromRow(r), site: (r.property as { name?: string } | null)?.name ?? 'Unknown site' }));
        const ticketQs = [ticketsActiveQ, ticketsWaitQ, ticketsDoneQ];
        const ticketList: Feed<OrgTicketRow[]> = !live
            ? sampleFeed(ORG_SAMPLE_TICKETS)
            : ticketQs.some(q => q.loading)
                ? { state: 'loading', data: null, sample: false, retry: () => ticketQs.forEach(q => q.refresh()) }
                : ticketsActiveQ.error === 'forbidden'
                    ? { state: 'off', data: null, sample: false, retry: ticketsActiveQ.refresh, offReason: 'Not available to your role' }
                    : ticketsActiveQ.error
                        ? { state: 'error', data: null, sample: false, retry: () => ticketQs.forEach(q => q.refresh()) }
                        : { state: 'ready', data: ticketQs.flatMap(toRows), sample: false, retry: () => ticketQs.forEach(q => q.refresh()) };

        const emptyApproval = (a: Feed<Approval>): Approval | null => (a.data ? { ...a.data, count: 0, value: null, urgent: false, detail: 'Nothing waiting' } : null);
        return {
            sites: preview(sites, p, []),
            tickets: preview(tickets, p, { breached: 0, urgent: 0, active: 0 }),
            ticketList: preview(ticketList, p, []),
            raised: preview(raised, p, 0),
            approvals: [po, mr, petty, escalation].map(a => preview(a, p, emptyApproval(a) as Approval)),
            budget: preview(budget, p, { pct: 0, spent: 0, total: 0, overSites: [] }),
            elec: preview(elec, p, { deltaPct: 0, units: 0, previous: 0, verdict: null, topSite: null }),
            bills: preview(bills, p, { count: 0, atRisk: 0 }),
            roster: preview(roster, p, { ...S.roster, present: 0, scheduled: 0, late: 0, absent: 0, shortTomorrow: 0, coveragePct: 0 }),
            ppm: preview(ppm, p, { ...S.ppm, pct: 0, overdue: 0, dueToday: 0 }),
            visitors: preview(visitors, p, { today: 0, inside: 0 }),
            vendor: preview(vendor, p, { revenue: 0, leader: null }),
            // Not wired to a hook yet: always sample, still honouring the preview states.
            escalations: preview(sampleFeed(S.escalations), p, { count: 0, top: '' }),
            oldestOpen: preview(sampleFeed(S.oldestOpen), p, { days: 0, title: '', site: '' }),
            grievances: preview(sampleFeed(S.grievances), p, { open: 0, oldestDays: 0 }),
            rounds: preview(sampleFeed(S.rounds), p, { missed: 0, sites: 0, worst: '' }),
            amc: preview(sampleFeed(S.amc), p, []),
            diesel: preview(sampleFeed(S.diesel), p, null),
            water: preview(sampleFeed(S.water), p, { tankers: 0, sites: 0 }),
            rooms: preview(sampleFeed(S.rooms), p, { pct: 0 }),
        };
    }, [live, p, period, S, ticketsQ, raisedQ, accountsQ, mrQ, aopQ, rosterQ, ppmQ, paceQ, trackerQ, vmsQ, vendorQ, ticketsActiveQ, ticketsWaitQ, ticketsDoneQ]);

    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const timer = useRef<number | null>(null);
    const toast = useCallback((message: string) => {
        setToastMessage(message);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setToastMessage(null), 2800);
    }, []);
    const previewAction = useCallback((label: string) => toast(`Preview only. "${label}" works in the app, nothing was saved here.`), [toast]);

    const name = live ? ((user?.user_metadata?.full_name as string | undefined) || user?.email?.split('@')[0] || 'there') : S.user.name;
    // One feed for the "waiting on you" total: unknown while any queue loads or fails.
    const states = feeds.approvals.map(a => a.state);
    const retryFailed = () => feeds.approvals.forEach(a => { if (a.state === 'error') a.retry(); });
    const waiting: Feed<number> = states.includes('loading')
        ? { state: 'loading', data: null, sample: false, retry: retryFailed }
        : states.includes('error')
            ? { state: 'error', data: null, sample: false, retry: retryFailed }
            : { state: 'ready', data: feeds.approvals.reduce((n, a) => n + (a.data?.count ?? 0), 0), sample: feeds.approvals.some(a => a.sample), retry: retryFailed };
    return {
        ...feeds,
        source: (live ? 'live' : 'sample') as 'live' | 'sample',
        now,
        online: p === 'offline' ? false : online,
        preview: p,
        period,
        setPeriod,
        orgName: live ? membership?.org_name || 'Your organisation' : S.orgName,
        user: {
            name,
            firstName: name.split(' ')[0],
            initials: initials(name),
            roleLabel: live ? (orgRole ? ROLE_LABELS[orgRole] ?? orgRole : 'Master admin') : S.user.roleLabel,
        },
        waiting,
        waitingTotal: waiting.data,
        toastMessage,
        toast,
        previewAction,
    };
}

export type OrgModel = ReturnType<typeof useOrgModel>;
