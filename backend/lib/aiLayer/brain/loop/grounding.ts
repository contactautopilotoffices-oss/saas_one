/**
 * Guardrail G4: nothing in a reply is invented. The model words the answer, but every number, ticket reference, link,
 * email and phone number in it must be found in what code gave it this turn (tool results, the context block, the
 * person's own words). If one is not, the reply is replaced by the answer code built. Pure.
 */

const URL = /https?:\/\/[^\s)>\]]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /\+?\d[\d\s-]{8,}\d/g;
const REF = /\b[A-Z]{2,6}[-/]\d{1,8}\b/g;
const NUMBER = /\d+(?:[.,]\d+)*/g;
const LIST_MARKER = /^\s*\d{1,2}[).]\s/gm;

const digits = (s: string) => s.replace(/[,\s]/g, '');

const DAY_MONTH = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?/gi;
const MONTH_DAY = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/gi;
const ISO_DAY = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const CLOCK = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** How far from today a date may be and still count as "the calendar", which code knows without a tool. */
const DAYS_BACK = 31, DAYS_AHEAD = 62;

/**
 * Removes dates that are simply the calendar around today ("tomorrow, Thu 5 Nov", "2026-11-05"). The model is told
 * today's date, so "tomorrow is the 5th" is arithmetic, not an invented fact. A date further away is left in and must
 * be found in the sources like any other number.
 */
function withoutNearDates(text: string, today: string): string {
    const base = Date.parse(`${today}T00:00:00Z`);
    if (Number.isNaN(base)) return text;
    const near = new Set<string>();
    for (let d = -DAYS_BACK; d <= DAYS_AHEAD; d++) near.add(new Date(base + d * 86_400_000).toISOString().slice(0, 10));
    const isNear = (day: string, month: number, year: string | undefined) => {
        const md = `-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
        return year ? near.has(`${year}${md}`) : [...near].some(iso => iso.endsWith(md));
    };
    const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
    return text
        .replace(ISO_DAY, (m, y: string, mo: string, d: string) => (near.has(`${y}-${mo}-${d}`) ? ' ' : m))
        .replace(DAY_MONTH, (m, d: string, mon: string, y?: string) => (isNear(d, month(mon), y) ? ' ' : m))
        .replace(MONTH_DAY, (m, mon: string, d: string, y?: string) => (isNear(d, month(mon), y) ? ' ' : m));
}

function numbersIn(text: string): Set<string> {
    const out = new Set<string>();
    for (const m of text.match(NUMBER) ?? []) {
        out.add(digits(m));
        // "1,234.50" also counts as 1234 and as its parts ("16:00" is seen as 16 and 00 by the pattern already).
        for (const part of m.split(/[.,]/)) if (part) out.add(part.replace(/^0+(?=\d)/, ''));
    }
    return out;
}

/**
 * The parts of `reply` that cannot be traced to `sources`. Empty = grounded.
 * Small numbers get one allowance: 1 to 12 is accepted when the sources contain that hour in 24-hour form ("4 pm" for
 * "16:00"), and a clock time is accepted when the sources contain its hour in the other form ("15:00" for "3").
 * Numbered list markers ("1) …") are layout, not facts.
 * `today` (YYYY-MM-DD, India): when given, dates within about a month back and two months ahead are the calendar, not
 * facts to be traced (found by the test set 2026-11-14: "tomorrow (Thu 5 Nov)" in a question was rejected as invented).
 */
export function ungroundedParts(reply: string, sources: string, today?: string): string[] {
    const bad: string[] = [];
    const src = sources.toLowerCase();
    for (const m of reply.match(URL) ?? []) if (!src.includes(m.toLowerCase().replace(/[.,;!?]+$/, ''))) bad.push(m);
    for (const m of reply.match(EMAIL) ?? []) if (!src.includes(m.toLowerCase())) bad.push(m);
    const noLinks = reply.replace(URL, ' ').replace(EMAIL, ' ');
    const srcDigits = digits(sources);
    for (const m of noLinks.match(PHONE) ?? []) if (digits(m).replace(/-/g, '').length >= 10 && !srcDigits.replace(/-/g, '').includes(digits(m).replace(/-/g, ''))) bad.push(m.trim());
    for (const m of noLinks.match(REF) ?? []) if (!src.includes(m.toLowerCase())) bad.push(m);

    const known = numbersIn(sources);
    const sameHour = (h: number) => known.has(String(h)) || (h >= 13 && known.has(String(h - 12))) || (h >= 1 && h <= 11 && known.has(String(h + 12))) || (h === 0 && known.has('12'));
    const body = (today ? withoutNearDates(noLinks, today) : noLinks).replace(LIST_MARKER, ' ')
        // "15:00" when the person said "3": the same hour on the other clock. Minutes must be :00 or be in the sources.
        .replace(CLOCK, (m, h: string, min: string) => (sameHour(Number(h)) && (min === '00' || known.has(min) || known.has(min.replace(/^0/, ''))) ? ' ' : m));
    for (const m of body.match(NUMBER) ?? []) {
        const n = digits(m);
        const plain = n.replace(/^0+(?=\d)/, '');
        if (known.has(n) || known.has(plain)) continue;
        if (m.split(/[.,]/).every(part => known.has(part.replace(/^0+(?=\d)/, '')))) continue;
        const asInt = /^\d+$/.test(plain) ? Number(plain) : NaN;
        if (asInt >= 1 && asInt <= 12 && (known.has(String(asInt + 12)) || (asInt === 12 && known.has('0')))) continue;
        bad.push(m);
    }
    return [...new Set(bad)];
}

export const isGrounded = (reply: string, sources: string, today?: string): boolean => ungroundedParts(reply, sources, today).length === 0;
