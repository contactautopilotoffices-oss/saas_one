import type { RecordStatus } from '@/backend/lib/candidates/types';

/** 54 -> "4 yrs 6 mo", 12 -> "1 yr", 6 -> "6 mo", null -> "—". */
export function formatMonths(months: number | null | undefined): string {
    if (months === null || months === undefined || !Number.isFinite(months)) return '—';
    const m = Math.max(0, Math.round(months));
    const y = Math.floor(m / 12);
    const r = m % 12;
    if (y === 0) return `${r} mo`;
    const yrs = `${y} ${y === 1 ? 'yr' : 'yrs'}`;
    return r === 0 ? yrs : `${yrs} ${r} mo`;
}

/** Trims trailing zeros: 1.50 -> "1.5", 2.00 -> "2". */
const trim = (n: number, digits: number) => n.toFixed(digits).replace(/\.?0+$/, '');

/**
 * Rupees, Indian compaction: 950 -> "₹950", 35000 -> "₹35K", 35500 -> "₹35.5K", 125000 -> "₹1.25L", 12500000 -> "₹1.25Cr".
 * Used for in-hand salary (₹/month).
 */
export function formatInr(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const v = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (v >= 1e7) return `${sign}₹${trim(v / 1e7, 2)}Cr`;
    if (v >= 1e5) return `${sign}₹${trim(v / 1e5, 2)}L`;
    if (v >= 1e3) return `${sign}₹${trim(v / 1e3, 1)}K`;
    return `${sign}₹${Math.round(v).toLocaleString('en-IN')}`;
}

/** Full rupees with Indian grouping: 125000 -> "₹1,25,000". */
export function formatInrFull(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function formatNotice(days: number | null | undefined): string {
    if (days === null || days === undefined || !Number.isFinite(days)) return '—';
    if (days <= 0) return 'Immediate';
    return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function formatCount(n: number): string {
    return n.toLocaleString('en-IN');
}

export function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Total months -> the years / months form fields ('' when unknown). */
export function monthsToParts(months: number | null | undefined): { years: string; months: string } {
    if (months === null || months === undefined) return { years: '', months: '' };
    return { years: String(Math.floor(months / 12)), months: String(months % 12) };
}

/**
 * The years / months form fields -> total months. Both empty -> null. Returns 'invalid' for non-integers, negatives or
 * months above 11.
 */
export function partsToMonths(years: string, months: string): number | null | 'invalid' {
    const y = years.trim();
    const m = months.trim();
    if (!y && !m) return null;
    const yn = y ? Number(y) : 0;
    const mn = m ? Number(m) : 0;
    if (!Number.isInteger(yn) || !Number.isInteger(mn) || yn < 0 || mn < 0 || mn > 11 || yn > 60) return 'invalid';
    return yn * 12 + mn;
}

/**
 * Status colour, carried by a dot + the label text (never the badge fill): the semantic colour is a text-level signal
 * on a neutral pill. Values are the locked brand / status tokens only.
 */
export const STATUS_DOT: Record<RecordStatus, string> = {
    new: 'bg-info',
    in_process: 'bg-primary',
    shortlisted: 'bg-secondary',
    interview: 'bg-primary-dark',
    on_hold: 'bg-warning',
    not_responding: 'bg-text-tertiary',
    rejected: 'bg-error',
    joined: 'bg-success',
};
