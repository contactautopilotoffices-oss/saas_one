import { randomUUID, randomInt } from 'node:crypto';

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

export function newRequirementCode(d = new Date()): string {
    const ist = toIst(d);
    const yy = String(ist.getUTCFullYear()).slice(2);
    const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(ist.getUTCDate()).padStart(2, '0');
    return `REQ-${yy}${mm}${dd}-${randomInt(1000, 9999)}`;
}

// ---------- Phone numbers (India) ----------

/** Normalises an Indian phone number to E.164 (+91...). Returns null when it is not a callable number. */
export function normaliseIndianPhone(raw: string): string | null {
    if (!raw) return null;
    if (/x/i.test(raw)) return null; // masked
    let digits = raw.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) {
        if (!digits.startsWith('+91')) return null; // only Indian numbers
        digits = digits.slice(3);
    } else if (digits.startsWith('0091')) {
        digits = digits.slice(4);
    } else if (digits.length === 12 && digits.startsWith('91')) {
        digits = digits.slice(2);
    }
    digits = digits.replace(/^0+/, '');
    if (digits.startsWith('1800') || digits.startsWith('1860')) return null; // toll free
    if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`; // mobile
    if (/^[1-9]\d{9}$/.test(digits)) return `+91${digits}`; // landline with STD code (10 digits without leading 0)
    return null;
}

// ---------- Time (IST) ----------

const IST_OFFSET_MIN = 330;

export function toIst(d: Date): Date {
    return new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
}

function fromIst(d: Date): Date {
    return new Date(d.getTime() - IST_OFFSET_MIN * 60_000);
}

function hm(s: string): [number, number] {
    const [h, m] = s.split(':').map((x) => parseInt(x, 10));
    return [h || 0, m || 0];
}

/**
 * The earliest time at or after `from` + leadMinutes that falls inside the
 * calling window (IST, allowed weekdays). Calls are never scheduled outside
 * business hours. Bolna needs at least 2 minutes of lead time.
 */
export function nextCallSlot(from: Date, windowStart: string, windowEnd: string, days: number[], leadMinutes = 3): Date {
    const [sh, sm] = hm(windowStart);
    const [eh, em] = hm(windowEnd);
    let t = toIst(new Date(from.getTime() + leadMinutes * 60_000));
    for (let i = 0; i < 14; i++) {
        const dayStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), sh, sm));
        // leave 30 minutes before the window closes so the batch can finish
        const dayEnd = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), eh, em - 30));
        if (days.includes(t.getUTCDay())) {
            if (t < dayStart) return fromIst(dayStart);
            if (t <= dayEnd) return fromIst(t);
        }
        t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1, 0, 0));
    }
    return from;
}

export function formatIst(iso: string | Date): string {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}

// ---------- CSV ----------

export function toCsv(rows: Record<string, string>[], columns: string[]): string {
    const esc = (v: string) => {
        const s = (v ?? '').replace(/\r?\n/g, ' ').trim();
        return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c] ?? '')).join(','))].join('\n') + '\n';
}

// ---------- Small helpers ----------

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return out;
}

export function normName(s: string): string {
    return s
        .toLowerCase()
        .replace(/\b(pvt|private|ltd|limited|llp|enterprises?|traders?|and|&|co|company|the)\b/g, '')
        .replace(/[^a-z0-9]/g, '');
}

export function clip(s: string, n: number): string {
    return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

/** Parses a model reply that should be one JSON object, tolerating code fences and prose around it. */
export function parseJsonLoose(text: string): unknown {
    const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(trimmed.slice(start, end + 1));
            } catch {
                return undefined;
            }
        }
        return undefined;
    }
}
