/**
 * The pure rules of the AOP Bounty: dates, grouping, urgency and the comparison line.
 * No database, no clock of its own: every function takes `now` or a month. Tested directly.
 */

export type BountyKind = 'actual' | 'decision' | 'approval' | 'mapping' | 'phone';
export type OwnerRole = 'purchase' | 'accounts' | 'operations' | 'approver';
export type BountyStatus = 'waiting' | 'open' | 'answered' | 'closed';

/** Which role group answers each kind when nobody has been named. */
export const DEFAULT_OWNER: Record<BountyKind, OwnerRole> = {
    actual: 'purchase', decision: 'purchase', approval: 'approver', mapping: 'purchase', phone: 'purchase',
};

/** The people behind a role group, as organization_memberships roles. */
export const ROLE_GROUPS: Record<OwnerRole, string[]> = {
    purchase: ['purchase_manager', 'purchase_executive', 'procurement'],
    accounts: ['accounts'],
    operations: ['org_super_admin', 'ops_super_admin'],
    approver: ['accounts', 'org_super_admin', 'master_admin'],
};

const IST = 5.5 * 60 * 60 * 1000;

/** 'YYYY-MM-01' for any date, in IST (the business day the team works in). */
export function monthOf(d: Date): string {
    const ist = new Date(d.getTime() + IST);
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function prevMonth(month: string, n = 1): string {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 - n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Sep 26' — fixed three-letter months, so the line reads the same on every machine (Node prints "Sept"). */
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;

/** An IST calendar day inside the month, as an instant (end of that day). Day 31 in a 30-day month is the 30th. */
export function dayInMonth(month: string, day: number): Date {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = Math.min(Math.max(1, day), last);
    // 23:59:59 IST on that day
    return new Date(Date.UTC(y, m - 1, d, 23, 59, 59) - IST);
}

/** The month's close: 23:59:59 IST on the last day. */
export const monthEnd = (month: string) => dayInMonth(month, 31);

/**
 * Does this cell have a bill due in `month` at all? Monthly: yes. Every n months: only when the
 * month is a whole number of n from the anchor. 0 = not recurring (never expected).
 */
export function expectedThisMonth(month: string, cadenceMonths: number, anchor: string | null): boolean {
    if (cadenceMonths === 1) return true;
    if (cadenceMonths <= 0) return false;
    if (!anchor) return true; // cadence known, start unknown: ask rather than skip
    const [y1, m1] = anchor.split('-').map(Number);
    const [y2, m2] = month.split('-').map(Number);
    const diff = (y2 - y1) * 12 + (m2 - m1);
    return diff >= 0 && diff % cadenceMonths === 0;
}

export interface Timing { expected_at: Date | null; due_at: Date; status: 'waiting' | 'open' }

/** When to start asking, and when it is late. Before the expected day the bounty waits quietly. */
export function timingFor(month: string, expectedDay: number | null, now: Date, closeDay = 31): Timing {
    const due = dayInMonth(month, closeDay);
    const expected = expectedDay ? dayInMonth(month, expectedDay) : null;
    const status = expected && now < expected ? 'waiting' : 'open';
    return { expected_at: expected, due_at: due, status };
}

export const isOverdue = (b: { status: string; due_at: string | Date }, now: Date) =>
    (b.status === 'open' || b.status === 'waiting') && new Date(b.due_at).getTime() < now.getTime();

/** Red: late. Amber: a person is being waited on (decision/approval) or due within 3 days. Grey: on track. */
export function urgency(b: { kind: BountyKind; status: string; due_at: string | Date }, now: Date): 'late' | 'soon' | 'normal' | 'done' {
    if (b.status === 'closed' || b.status === 'answered') return 'done';
    if (isOverdue(b, now)) return 'late';
    if (b.kind === 'decision' || b.kind === 'approval') return 'soon';
    return new Date(b.due_at).getTime() - now.getTime() < 3 * 86_400_000 ? 'soon' : 'normal';
}

/** Inbox grouping by the last thing that happened on it. */
export function groupOf(when: string | Date, now: Date): 'Today' | 'Yesterday' | 'Last 7 days' | 'Earlier' {
    const dayKey = (d: Date) => monthOf(d) + Math.floor((d.getTime() + IST) / 86_400_000);
    const t = new Date(when);
    if (dayKey(t) === dayKey(now)) return 'Today';
    if (dayKey(t) === dayKey(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
    if (now.getTime() - t.getTime() < 7 * 86_400_000) return 'Last 7 days';
    return 'Earlier';
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** "Sep ₹14,160 · Aug ₹14,160" from the two previous months; "no history" when neither exists. */
export function compareLine(compare: { month: string; actual: number | null }[]): string {
    const parts = compare.filter((c) => c.actual != null).map((c) => `${monthLabel(c.month).split(' ')[0]} ${inr(c.actual as number)}`);
    return parts.length ? parts.join(' · ') : 'no history';
}

/** A one-line change against the previous month, for a figure that just arrived. */
export function changeLine(current: number, previous: number | null): string {
    if (previous == null || previous === 0) return inr(current);
    const pct = Math.round(((current - previous) / previous) * 100);
    return `${inr(current)} (${pct > 0 ? '+' : ''}${pct}% vs last month)`;
}

/** A ping is worth sending if the bounty is open, past its expected date, and not pinged in the last 48 h. */
export function shouldAutoPing(b: { status: string; expected_at: string | Date | null; last_pinged_at: string | Date | null }, now: Date): boolean {
    if (b.status !== 'open') return false;
    if (b.expected_at && new Date(b.expected_at).getTime() > now.getTime()) return false;
    if (!b.last_pinged_at) return true;
    return now.getTime() - new Date(b.last_pinged_at).getTime() >= 48 * 3_600_000;
}
