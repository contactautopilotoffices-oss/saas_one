import { ClipboardX, Fuel, Siren, Timer, Wrench, Zap, type LucideIcon } from 'lucide-react';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import type { Feed, OrgModel, OrgSite } from './useOrgModel';

/**
 * Small derived views on the org model, shared by the Cobalt, Teal and Plum iterations so
 * the three show the same numbers while drawing them differently.
 */

/** Portfolio active tickets per day: the sites' daily series added up, aligned to today. */
export function portfolioTrend(sites: OrgSite[], days: number): number[] {
    return Array.from({ length: days }, (_, i) => sites.reduce((sum, s) => sum + (s.trend[s.trend.length - days + i] ?? 0), 0));
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Labels for the last n days ending today: short axis text plus a long tooltip label. */
export function dayLabels(now: Date, n: number): { short: string; long: string }[] {
    return Array.from({ length: n }, (_, i) => {
        const d = new Date(now);
        d.setDate(d.getDate() - (n - 1 - i));
        return {
            short: i === n - 1 ? 'Today' : n > 7 ? String(d.getDate()) : WEEKDAY[d.getDay()],
            long: d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }),
        };
    });
}

export interface RiskItem {
    key: string;
    icon: LucideIcon;
    title: string;
    meta: string;
    value: string;
    /** Only SLA breaches and late rounds are red. */
    red: boolean;
    sample: boolean;
}

/** Everything that needs a person, most serious first, plus whether the list is complete yet. */
export function riskItems(m: OrgModel): { items: RiskItem[]; loading: boolean; failed: Feed<unknown>[] } {
    const items: RiskItem[] = [];
    const t = m.tickets.data;
    if (t && t.breached > 0) items.push({ key: 'sla', icon: Siren, title: `${t.breached} ${t.breached === 1 ? 'ticket' : 'tickets'} past SLA`, meta: `${t.urgent} urgent still open`, value: String(t.breached), red: true, sample: m.tickets.sample });
    const r = m.rounds.data;
    if (r && r.missed > 0) items.push({ key: 'rounds', icon: ClipboardX, title: `${r.missed} ${r.missed === 1 ? 'round' : 'rounds'} late`, meta: r.worst, value: String(r.missed), red: true, sample: m.rounds.sample });
    const o = m.oldestOpen.data;
    if (o && o.days >= 7) items.push({ key: 'oldest', icon: Timer, title: `Oldest ticket open ${o.days} days`, meta: `${o.title}, ${o.site}`, value: `${o.days}d`, red: false, sample: m.oldestOpen.sample });
    const a = m.amc.data?.[0];
    if (a && a.days <= 14) items.push({ key: 'amc', icon: Wrench, title: `${a.asset} AMC ends in ${a.days} days`, meta: a.site, value: `${a.days}d`, red: false, sample: m.amc.sample });
    const d = m.diesel.data;
    if (d && d.lowTank.pct < 30) items.push({ key: 'diesel', icon: Fuel, title: `${d.lowTank.site} ${d.lowTank.dg} at ${d.lowTank.pct}%`, meta: 'Order a diesel refill', value: `${d.lowTank.pct}%`, red: false, sample: m.diesel.sample });
    const b = m.bills.data;
    if (b && b.count > 0) items.push({ key: 'bills', icon: Zap, title: `${b.count} electricity ${b.count === 1 ? 'bill' : 'bills'} at risk`, meta: `${inr(b.atRisk, { compact: true })} overdue or losing a discount`, value: inr(b.atRisk, { compact: true }), red: false, sample: m.bills.sample });
    const feeds: Feed<unknown>[] = [m.tickets, m.rounds, m.oldestOpen, m.amc, m.diesel, m.bills];
    return { items, loading: feeds.some(f => f.state === 'loading'), failed: feeds.filter(f => f.state === 'error') };
}

/** Short names for the four approval queues. */
export const QUEUE_NAMES = { po: 'Purchase orders', mr: 'Material requests', petty: 'Petty cash', escalation: 'Escalations' } as const;
