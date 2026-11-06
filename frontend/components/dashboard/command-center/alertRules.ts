/**
 * Alerts card rules — every threshold in one place (approved 2026-10-16 from the Alerts proposal:
 * https://claude.ai/artifact/TB2LMywiJeP6yEzKDDHrFG). Pure functions over feeds the dashboard already reads, plus
 * /api/command-center/ticket-alerts. No fetching, no React, so the rules can be tested offline.
 *
 * Only abnormal things become alerts. A feed that answered with nothing wrong adds a "fine" line instead, and a
 * feed that did not answer (no access, not set up, error) is listed as "not checked" — never read as "all clear".
 */

export type AlertLevel = 'critical' | 'warning' | 'data';

export interface CcAlert {
  /** Stable per alert type, used for "Mark seen". */
  id: string;
  level: AlertLevel;
  /** Short type label, e.g. "Tickets past SLA". */
  kind: string;
  /** The headline: what is wrong and where. */
  what: string;
  detail?: string;
  /** When it happened, if it is a dated event (e.g. a reading date). */
  when?: string;
  /** Main count. A seen alert comes back when this rises or its level gets worse. */
  metric: number;
  action: string;
  href?: string;
}

export interface AlertsResult {
  alerts: CcAlert[];
  /** Feeds checked with nothing wrong, e.g. "No generator faults". */
  fine: string[];
  /** Feeds that did not answer, so nothing can be said about them. */
  notChecked: string[];
}

/* ---- thresholds (owner-adjustable) ------------------------------------------------- */
export const THRESHOLDS = {
  /** A building with this many tickets past SLA makes the SLA alert critical. */
  slaCriticalPerBuilding: 5,
  /** Electricity: a reading this many times a meter's normal is an alert… */
  spikeMinTimes: 3,
  /** …and from this many times it is treated as a likely typing mistake ("check reading"). */
  spikeTypoTimes: 50,
  /** Only electricity readings from the last N days are considered. */
  spikeRecentDays: 30,
  /** Site overspend (% over budget) for a warning / critical. */
  overspendWarnPct: 5,
  overspendCriticalPct: 15,
  /** Budget data is out of date when its month ended more than N days ago. */
  budgetStaleDays: 45,
  /** Oldest purchase-mailbox thread waiting (days) for a warning / critical. */
  mailboxWarnDays: 7,
  mailboxCriticalDays: 30,
} as const;

/* ---- feed shapes (only the fields used) -------------------------------------------- */
export interface TicketAlertsFeed {
  provisioned: boolean;
  waiting_tenant_days?: number;
  properties?: Array<{ id: string; name: string }>;
  buildings?: Array<{
    property_id: string; name: string; open: number; past_sla: number; no_deadline: number;
    high_priority: number; waiting_tenant: number; waiting_oldest_days: number;
    oldest_past_sla_at?: string | null; oldest_high_priority_at?: string | null; oldest_no_deadline_at?: string | null;
  }>;
}
export interface PaceFeed {
  provisioned: boolean;
  data_quality?: {
    anomalies?: Array<{ meter_name: string | null; property_name: string | null; reading_date: string; times_typical: number | null }>;
  };
}
export interface AopFeed {
  provisioned: boolean;
  current: { month: string } | null;
  sites?: Array<{ site_name?: string | null; property_id: string | null; budget: number; actual: number }>;
}
export interface MailboxFeed {
  provisioned: boolean;
  totals: { unactioned_request: number; awaiting_reply: number; oldest_days: number } | null;
  oldest?: Array<{ from_address: string | null; waiting_days: number }>;
}
export interface GeneratorRow { name: string | null; status: string | null; property_id?: string | null }
export interface BillsFeed {
  provisioned: boolean;
  deadlines?: {
    overdue: Array<{ cutoff_date?: string | null }>; due_soon: unknown[]; discount_expiring: unknown[];
    money_at_risk: { discount_at_risk: number; penalty_exposure: number };
  };
}

/** A feed's state as the card sees it: data, or undefined while loading, or null when it did not answer. */
type Feed<T> = T | null | undefined;

export interface AlertInputs {
  now: Date;
  tickets: Feed<TicketAlertsFeed>;
  pace: Feed<PaceFeed>;
  aop: Feed<AopFeed>;
  mailbox: Feed<MailboxFeed>;
  generators: Feed<GeneratorRow[]>;
  bills: Feed<BillsFeed>;
  /** Limit to one building (the header's property selector), when set. */
  propertyId?: string | null;
  propertyName?: string | null;
  links: { tickets?: string; electricity?: string; budget?: string; dg?: string; bills?: string };
  /** Formats rupees the way the rest of the dashboard does. */
  inr: (n: number) => string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Some building names are stored with a trailing comma ("C Mafatlal Chambers ,"). */
const clean = (name: string | null | undefined) => (name ?? '').replace(/\s*,\s*$/, '').trim();
const DAY = 86_400_000;

function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y || 2000, (m || 1) - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}
/** IST calendar date, e.g. "10 Oct". */
function istDate(d: Date): string {
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}
const daysBetween = (from: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY));
/** How long a problem has existed, one format for every alert: "since 10 Oct · 7 days" (India time). */
function sinceLabel(from: string | Date | null | undefined, now: Date): string | undefined {
  if (!from) return undefined;
  const d = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(d.getTime())) return undefined;
  const n = daysBetween(d, now);
  return `since ${istDate(d)} · ${n === 0 ? 'today' : plural(n, 'day')}`;
}
/** Earliest of a list of ISO timestamps. */
function earliestOf(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (!best || new Date(v).getTime() < new Date(best).getTime())) best = v;
  return best;
}
const times = (n: number) => `${n >= 10 ? Math.round(n).toLocaleString('en-IN') : n.toFixed(1).replace(/\.0$/, '')}×`;

export function buildAlerts(i: AlertInputs): AlertsResult {
  const alerts: CcAlert[] = [];
  const fine: string[] = [];
  const notChecked: string[] = [];
  const T = THRESHOLDS;

  /* ---- tickets ------------------------------------------------------------------ */
  if (i.tickets === null || (i.tickets && !i.tickets.provisioned)) notChecked.push('Tickets');
  else if (i.tickets) {
    const all = i.tickets.buildings ?? [];
    const b = (i.propertyId ? all.filter(x => x.property_id === i.propertyId) : all).map(x => ({ ...x, name: clean(x.name) }));

    const sla = b.filter(x => x.past_sla > 0).sort((a, z) => z.past_sla - a.past_sla || z.open - a.open);
    if (sla.length) {
      const total = sla.reduce((s, x) => s + x.past_sla, 0);
      const [top, ...rest] = sla;
      alerts.push({
        id: 'tickets-sla',
        level: sla.some(x => x.past_sla >= T.slaCriticalPerBuilding) ? 'critical' : 'warning',
        kind: 'Tickets past SLA',
        what: `${top.name}: ${top.past_sla} of ${top.open} open tickets past SLA`,
        detail: rest.length
          ? `Also ${rest.slice(0, 3).map(x => `${x.name} ${x.past_sla} of ${x.open}`).join(' · ')}${rest.length > 3 ? ` and ${plural(rest.length - 3, 'more building')}` : ''}`
          : undefined,
        // Oldest missed deadline. Tickets without a deadline can't be timed, so this covers the ones that have one.
        when: sinceLabel(earliestOf(sla.map(x => x.oldest_past_sla_at)), i.now),
        metric: total,
        action: 'View tickets',
        href: i.links.tickets,
      });
    } else fine.push('No tickets past SLA');

    const waiting = b.filter(x => x.waiting_tenant > 0).sort((a, z) => z.waiting_tenant - a.waiting_tenant);
    if (waiting.length) {
      const total = waiting.reduce((s, x) => s + x.waiting_tenant, 0);
      const oldest = Math.max(...waiting.map(x => x.waiting_oldest_days));
      const where = waiting.length === 1 ? ` at ${waiting[0].name}` : '';
      alerts.push({
        id: 'tickets-waiting-tenant',
        level: 'warning',
        kind: 'Waiting for tenant',
        what: `${plural(total, 'finished ticket')} not confirmed by the tenant${where}`,
        detail: `Waiting more than ${i.tickets.waiting_tenant_days ?? 7} days for the tenant to confirm`,
        when: sinceLabel(new Date(i.now.getTime() - oldest * DAY), i.now),
        metric: total,
        action: 'View tickets',
        href: i.links.tickets,
      });
    }

    const hp = b.filter(x => x.high_priority > 0).sort((a, z) => z.high_priority - a.high_priority);
    if (hp.length) {
      const total = hp.reduce((s, x) => s + x.high_priority, 0);
      alerts.push({
        id: 'tickets-high-priority',
        level: 'warning',
        kind: 'High-priority open',
        what: `${plural(total, 'high-priority ticket')} open`,
        detail: hp.slice(0, 4).map(x => `${x.name} ${x.high_priority}`).join(' · '),
        when: sinceLabel(earliestOf(hp.map(x => x.oldest_high_priority_at)), i.now),
        metric: total,
        action: 'View tickets',
        href: i.links.tickets,
      });
    }

    const nd = b.filter(x => x.no_deadline > 0).sort((a, z) => z.no_deadline - a.no_deadline);
    if (nd.length) {
      const total = nd.reduce((s, x) => s + x.no_deadline, 0);
      const open = b.reduce((s, x) => s + x.open, 0);
      alerts.push({
        id: 'tickets-no-deadline',
        level: 'data',
        kind: 'Check data',
        what: `${total} of ${open} open tickets have no SLA deadline`,
        detail: `Most at ${nd[0].name} (${nd[0].no_deadline} of ${nd[0].open})`,
        when: sinceLabel(earliestOf(nd.map(x => x.oldest_no_deadline_at)), i.now),
        metric: total,
        action: 'View tickets',
        href: i.links.tickets,
      });
    }
  }

  /* ---- electricity --------------------------------------------------------------- */
  if (i.pace === null || (i.pace && !i.pace.provisioned)) notChecked.push('Electricity');
  else if (i.pace) {
    const since = new Date(i.now.getTime() - T.spikeRecentDays * DAY).toISOString().slice(0, 10);
    const recent = (i.pace.data_quality?.anomalies ?? [])
      .filter(a => a.reading_date >= since && a.times_typical != null && a.times_typical >= T.spikeMinTimes)
      .filter(a => !i.propertyName || a.property_name === i.propertyName)
      .sort((a, z) => z.reading_date.localeCompare(a.reading_date));
    const spikes = recent.filter(a => (a.times_typical as number) < T.spikeTypoTimes);
    const typos = recent.filter(a => (a.times_typical as number) >= T.spikeTypoTimes);
    // The feed sends the 10 newest readings only, so a full list may hide more.
    const more = (i.pace.data_quality?.anomalies?.length ?? 0) >= 10 ? '+' : '';
    if (spikes.length) {
      const top = spikes[0];
      alerts.push({
        id: 'electricity-spike',
        level: 'critical',
        kind: 'Electricity spike',
        what: `${top.property_name ?? 'A site'}${top.meter_name ? ` ${top.meter_name}` : ''}: ${times(top.times_typical as number)} normal use`,
        detail: spikes.length > 1 ? `${spikes.length}${more} spikes in the last ${T.spikeRecentDays} days` : undefined,
        when: sinceLabel(`${top.reading_date.slice(0, 10)}T00:00:00+05:30`, i.now),
        metric: spikes.length,
        action: 'Investigate',
        href: i.links.electricity,
      });
    } else fine.push(`No electricity spikes in ${T.spikeRecentDays} days`);
    if (typos.length) {
      const top = typos[0];
      alerts.push({
        id: 'electricity-check-reading',
        level: 'data',
        kind: 'Check reading',
        what: `${top.property_name ?? 'A site'}${top.meter_name ? ` ${top.meter_name}` : ''} meter: ${times(top.times_typical as number)} normal`,
        detail: typos.length > 1
          ? `${typos.length}${more} readings look like typing mistakes`
          : 'Likely a typing mistake in the log',
        when: sinceLabel(`${top.reading_date.slice(0, 10)}T00:00:00+05:30`, i.now),
        metric: typos.length,
        action: 'Check reading',
        href: i.links.electricity,
      });
    }
  }

  /* ---- budget -------------------------------------------------------------------- */
  if (i.aop === null || (i.aop && !i.aop.provisioned)) notChecked.push('Budget');
  else if (i.aop?.current) {
    const month = monthLabel(i.aop.current.month);
    const sites = (i.aop.sites ?? [])
      .filter(s => !i.propertyId || s.property_id === i.propertyId)
      .filter(s => s.budget > 0)
      .map(s => ({ name: clean(s.site_name) || 'A site', pct: ((s.actual - s.budget) / s.budget) * 100 }))
      .filter(s => s.pct > T.overspendWarnPct)
      .sort((a, z) => z.pct - a.pct);
    if (sites.length) {
      alerts.push({
        id: 'budget-overspend',
        level: sites.some(s => s.pct > T.overspendCriticalPct) ? 'critical' : 'warning',
        kind: 'Over budget',
        what: `${plural(sites.length, 'site')} over budget in ${month}`,
        detail: sites.slice(0, 3).map(s => `${s.name} ${Math.round(s.pct * 10) / 10}% over`).join(' · '),
        when: `${month} figures`,
        metric: sites.length,
        action: 'View budget',
        href: i.links.budget,
      });
    } else fine.push(`No site over budget (${month})`);

    const [y, m] = i.aop.current.month.split('-').map(Number);
    const monthEnd = new Date(y, m, 0, 23, 59, 59);
    const ageDays = Math.floor((i.now.getTime() - monthEnd.getTime()) / DAY);
    if (ageDays > T.budgetStaleDays) {
      alerts.push({
        id: 'budget-stale',
        level: 'data',
        kind: 'Check data',
        what: `Budget data last imported for ${month}`,
        detail: 'Newer months have not been uploaded yet',
        when: sinceLabel(monthEnd, i.now),
        metric: ageDays >= 60 ? Math.floor(ageDays / 30) : 0,
        action: 'View budget',
        href: i.links.budget,
      });
    }
  }

  /* ---- purchase mailbox (its own access check; absent for roles without it) ------- */
  if (i.mailbox === null || (i.mailbox && !i.mailbox.provisioned)) notChecked.push('Purchase mailbox');
  else if (i.mailbox?.totals) {
    const t = i.mailbox.totals;
    const open = t.unactioned_request + t.awaiting_reply;
    if (open > 0 && t.oldest_days > T.mailboxWarnDays) {
      const from = i.mailbox.oldest?.[0]?.from_address?.split('@')[0];
      alerts.push({
        id: 'mailbox-waiting',
        level: t.oldest_days > T.mailboxCriticalDays ? 'critical' : 'warning',
        kind: 'Purchase mailbox',
        what: `${plural(t.unactioned_request, 'email thread')} need action, ${t.awaiting_reply} waiting for a reply`,
        detail: `Oldest waiting${from ? `: ${from}` : ''} · counted from its last message`,
        when: sinceLabel(new Date(i.now.getTime() - t.oldest_days * DAY), i.now),
        metric: open,
        action: 'Open mailbox',
      });
    } else fine.push('Purchase mailbox up to date');
  }

  /* ---- generators (same "Fault" rule as the DG Monitoring card) ------------------- */
  if (i.generators === null) notChecked.push('Generators');
  else if (i.generators) {
    const gens = i.generators.filter(g => !i.propertyId || g.property_id === i.propertyId);
    const fault = gens.filter(g => g.status !== 'active' && g.status !== 'standby');
    if (fault.length) {
      alerts.push({
        id: 'dg-fault',
        level: 'critical',
        kind: 'Generator fault',
        what: `${plural(fault.length, 'generator')} marked fault`,
        detail: fault.slice(0, 3).map(g => g.name || 'Unnamed DG').join(' · '),
        metric: fault.length,
        action: 'View DG',
        href: i.links.dg,
      });
    } else if (gens.length) fine.push('No generator faults');
  }

  /* ---- electricity bills ----------------------------------------------------------- */
  if (i.bills === null || (i.bills && !i.bills.provisioned)) notChecked.push('Electricity bills');
  else if (i.bills?.deadlines) {
    const d = i.bills.deadlines;
    const atRisk = d.money_at_risk.discount_at_risk + d.money_at_risk.penalty_exposure;
    if (d.overdue.length || d.discount_expiring.length) {
      alerts.push({
        id: 'bills-at-risk',
        level: 'warning',
        kind: 'Bills at risk',
        what: d.overdue.length
          ? `${plural(d.overdue.length, 'electricity bill')} overdue`
          : `${plural(d.discount_expiring.length, 'bill discount')} closing soon`,
        detail: `${i.inr(atRisk)} at risk (lost discount + penalty)${d.overdue.length && d.discount_expiring.length ? ` · ${d.discount_expiring.length} discount closing` : ''}`,
        when: sinceLabel(earliestOf(d.overdue.map(b => b.cutoff_date ? `${b.cutoff_date.slice(0, 10)}T00:00:00+05:30` : null)), i.now),
        metric: d.overdue.length + d.discount_expiring.length,
        action: 'Payment queue',
        href: i.links.bills,
      });
    } else fine.push('No electricity bills overdue');
  }

  const rank: Record<AlertLevel, number> = { critical: 0, warning: 1, data: 2 };
  alerts.sort((a, z) => rank[a.level] - rank[z.level]);
  return { alerts, fine, notChecked };
}

/* ---- "Mark seen" ------------------------------------------------------------------- */
export interface SeenMark { level: AlertLevel; metric: number; at: number }

const severity: Record<AlertLevel, number> = { data: 0, warning: 1, critical: 2 };

/** A seen alert stays hidden until its level gets worse or its count rises. */
export function stillSeen(alert: CcAlert, mark: SeenMark | undefined): boolean {
  if (!mark) return false;
  if (severity[alert.level] > severity[mark.level]) return false;
  return alert.metric <= mark.metric;
}
