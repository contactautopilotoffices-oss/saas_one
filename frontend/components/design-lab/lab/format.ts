import type { LabTicket, SlaInfo } from './types';

/** "9:41 AM" */
export function clockTime(d: Date | null | undefined): string {
    if (!d) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "Tuesday 6 October" */
export function longDate(d: Date): string {
    const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
    const day = d.getDate();
    const month = d.toLocaleDateString('en-GB', { month: 'long' });
    return `${weekday} ${day} ${month}`;
}

/** "6 Oct" */
export function shortDate(d: Date): string {
    return `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
}

/** Raised time, relative to "now": "6:06 AM" today, "Yesterday 9:10 PM", "3 Oct" earlier. */
export function raisedLabel(d: Date, now: Date): string {
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return clockTime(d);
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `Yesterday ${clockTime(d)}`;
    return shortDate(d);
}

/** "25m", "1h 10m", "2d 4h" */
export function duration(totalMinutes: number): string {
    const m = Math.max(0, Math.round(Math.abs(totalMinutes)));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (h < 24) return rest ? `${h}h ${String(rest).padStart(2, '0')}m` : `${h}h`;
    const d = Math.floor(h / 24);
    const hr = h % 24;
    return hr ? `${d}d ${hr}h` : `${d}d`;
}

/** Splits a duration into its parts for big countdown displays. */
export function countdownParts(totalMinutes: number): { h: string; m: string } {
    const m = Math.max(0, Math.round(Math.abs(totalMinutes)));
    return { h: String(Math.floor(m / 60)), m: String(m % 60).padStart(2, '0') };
}

export function slaInfo(t: LabTicket, now: Date): SlaInfo {
    const done = t.status === 'resolved' || t.status === 'closed';
    if (!t.slaDue) {
        return { minutesLeft: null, due: null, targetHours: t.slaHours, used: 0, breached: false, danger: false, label: 'No SLA', done };
    }
    const end = done && t.resolvedAt ? t.resolvedAt : now;
    const minutesLeft = Math.round((t.slaDue.getTime() - end.getTime()) / 60000);
    const windowMin = t.slaHours ? t.slaHours * 60 : Math.max(1, (t.slaDue.getTime() - t.raisedAt.getTime()) / 60000);
    const usedMin = (end.getTime() - t.raisedAt.getTime()) / 60000;
    const used = Math.max(0, usedMin / windowMin);
    const breached = minutesLeft < 0;
    const danger = !done && (breached || (t.priority === 'critical' && minutesLeft < 60));
    let label: string;
    if (done) label = breached ? 'Closed late' : 'Met';
    else label = breached ? `Overdue ${duration(minutesLeft)}` : `${duration(minutesLeft)} left`;
    return { minutesLeft, due: t.slaDue, targetHours: t.slaHours, used, breached, danger, label, done };
}

/** Sort key: most urgent SLA first, tickets without an SLA last. */
export function slaSortKey(t: LabTicket, now: Date): number {
    if (!t.slaDue) return Number.MAX_SAFE_INTEGER;
    return t.slaDue.getTime() - now.getTime();
}

export function inrCompact(v: number): string {
    if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
    if (v >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
    return `₹${v}`;
}

export function num(v: number): string {
    return v.toLocaleString('en-IN');
}

export function initials(name: string | null | undefined): string {
    if (!name) return '?';
    const parts = name.replace(/[^A-Za-z\s.]/g, '').split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function greeting(now: Date): string {
    const h = now.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

/** Short ticket number for tight layouts: TKT-PROP-00148 -> #00148 */
export function shortNumber(n: string): string {
    const m = n.match(/(\d+)$/);
    return m ? `#${m[1]}` : n;
}
