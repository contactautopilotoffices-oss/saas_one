/**
 * ORG WIKI — the compiler.
 *
 * Turns the raw sources into interlinked markdown pages, with no model involved:
 *
 *   zoho_purchase_orders + zoho_po_line_items → vendor, site, item, month pages,
 *                                               the red-flags page and the overview
 *   mailbox_threads (purchase@ digest)         → one page per month of mail, and a
 *                                               "mail that mentions this vendor" list
 *   docs/JOURNAL.md                            → one page per journal entry
 *
 * The sources are read, never written. `buildWiki` is pure (data in, pages out) so a
 * dry run can print the pages without a database write; `loadWikiSources` is the only
 * part that touches Supabase, and it pages past PostgREST's 1,000-row cap.
 *
 * Page markdown is a small fixed subset the Wiki tab renders itself: #/##/### headings,
 * "- " bullets, pipe tables, **bold**, [text](https://…) and [[slug|label]] wiki links.
 * Every value that came from a source (vendor names, mail subjects) goes through
 * `cell()` so it cannot break a table or forge a link.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { zohoBooksPoUrl } from '@/backend/lib/ira/procurement/types';

export type WikiKind = 'overview' | 'flags' | 'vendor' | 'site' | 'item' | 'month' | 'mail' | 'dev' | 'note';

export interface WikiPage {
    slug: string;
    kind: WikiKind;
    title: string;
    summary: string;
    body_md: string;
    links: string[];
    sources: { table: string; rows: number }[];
}

export interface WikiPo {
    id: string;
    po_number: string | null;
    vendor_name: string | null;
    po_amount: number | null;
    status: string | null;
    department: string | null;
    project_name: string | null;
    category: string | null;
    po_date: string | null;
    zoho_po_id: string | null;
    created_time: string | null;
    cf_site: string | null;
    reference_number: string | null;
}

export interface WikiLine {
    po_id: string;
    name: string | null;
    description: string | null;
    unit: string | null;
    quantity: number | null;
    rate: number | null;
    item_total: number | null;
}

export interface WikiThread {
    thread_id: string;
    subject: string | null;
    from_address: string | null;
    last_message_at: string | null;
    message_count: number | null;
    snippet: string | null;
    category: string | null;
    waiting_on: string | null;
    is_resolved: boolean | null;
}

export interface WikiSources {
    pos: WikiPo[];
    lines: WikiLine[];
    threads: WikiThread[];
    /** docs/JOURNAL.md, or null when this server does not have the file. */
    journal: string | null;
    zohoOrgId: string | null;
    booksDc: string;
    now: Date;
}

/* ---------------------------------------------------------------------------
 * Loading — the only database access
 * ------------------------------------------------------------------------- */

async function pageAll<T>(
    run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await run(from, from + 999);
        if (error) throw new Error(error.message);
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
    }
    return out;
}

export const JOURNAL_PATH = path.join(process.cwd(), 'docs', 'JOURNAL.md');

export async function loadWikiSources(db: SupabaseClient, orgId: string, now = new Date()): Promise<WikiSources> {
    const [pos, lines, threads, config] = await Promise.all([
        pageAll<WikiPo>((a, b) => db.from('zoho_purchase_orders')
            .select('id, po_number, vendor_name, po_amount, status, department, project_name, category, po_date, zoho_po_id, '
                + 'created_time:raw->>created_time, cf_site:raw->>cf_site, reference_number:raw->>reference_number')
            .eq('organization_id', orgId).order('id').range(a, b) as unknown as PromiseLike<{ data: WikiPo[] | null; error: { message: string } | null }>),
        pageAll<WikiLine>((a, b) => db.from('zoho_po_line_items')
            .select('po_id, name, description, unit, quantity, rate, item_total')
            .eq('organization_id', orgId).order('id').range(a, b)),
        pageAll<WikiThread>((a, b) => db.from('mailbox_threads')
            .select('thread_id, subject, from_address, last_message_at, message_count, snippet, category, waiting_on, is_resolved')
            .eq('organization_id', orgId).order('id').range(a, b)),
        db.from('accounts_zoho_config').select('zoho_organization_id').eq('organization_id', orgId).maybeSingle(),
    ]);
    let journal: string | null = null;
    try { journal = fs.readFileSync(JOURNAL_PATH, 'utf8'); } catch { journal = null; }
    return {
        pos, lines, threads, journal,
        zohoOrgId: config.data?.zoho_organization_id ? String(config.data.zoho_organization_id) : null,
        booksDc: process.env.ZOHO_BOOKS_DC || 'com',
        now,
    };
}

/* ---------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------- */

/** POs that never became a commitment. Same set Ira treats as dead. */
const DEAD = new Set(['cancelled', 'rejected', 'draft']);
/** POs whose rates count towards an item's benchmark — the set Meera's benchmark uses. */
const PRICED = new Set(['approved', 'open', 'billed', 'partially_billed']);

const isLive = (p: WikiPo) => !DEAD.has(String(p.status ?? '').toLowerCase());

export function inr(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return '—';
    const digits = Math.abs(n) >= 100 ? 0 : 2;
    return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;
}

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/** A source value made safe for a table cell or a line of text. */
export function cell(v: unknown, max = 120): string {
    const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\|/g, '/').replace(/\[\[|\]\]/g, '[')
        .replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function slugify(s: string, max = 70): string {
    const out = s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (out.slice(0, max).replace(/-+$/, '') || 'x');
}

const day = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null);
const month = (d: string | null | undefined) => (d ? String(d).slice(0, 7) : null);

function fy(d: string): string {
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    const start = m >= 4 ? y : y - 1;
    return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function quarter(d: string): string {
    const m = Number(d.slice(5, 7));
    return `${d.slice(0, 4)} Q${Math.floor((m - 1) / 3) + 1}`;
}

function quantile(sorted: number[], q: number): number {
    if (!sorted.length) return NaN;
    const i = (sorted.length - 1) * q;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);

function mode<T>(xs: T[]): T | undefined {
    const c = new Map<T, number>();
    let best: T | undefined, n = 0;
    for (const x of xs) {
        const k = (c.get(x) ?? 0) + 1;
        c.set(x, k);
        if (k > n) { n = k; best = x; }
    }
    return best;
}

function table(head: string[], rows: string[][]): string {
    if (!rows.length) return '_None._';
    return [
        `| ${head.join(' | ')} |`,
        `| ${head.map(() => '---').join(' | ')} |`,
        ...rows.map((r) => `| ${r.join(' | ')} |`),
    ].join('\n');
}

const link = (slug: string, label: string) => `[[${slug}|${cell(label, 90)}]]`;

/** Hand out unique slugs: a second "Sai Enterprises" becomes …-2. */
class Slugs {
    private used = new Set<string>();
    take(base: string): string {
        let s = base, n = 2;
        while (this.used.has(s)) s = `${base}-${n++}`;
        this.used.add(s);
        return s;
    }
}

/* ---------------------------------------------------------------------------
 * Item identity — a TypeScript port of satej_normalize_item / _unit
 * (20261006000001_satej_rate_benchmark.sql), so the wiki and Meera's rate
 * checker agree on what "the same item" is.
 * ------------------------------------------------------------------------- */

export function normalizeItem(t: string | null | undefined): string | null {
    let s = String(t ?? '').toLowerCase();
    s = s.replace(/(period|for the month of|month of)\s*[-:]?[\s\S]*$/, '');
    s = s.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*['’-]?\s*\d{2,4}\b/g, ' ');
    s = s.replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g, ' ');
    s = s.replace(/\(?\b(hsn|sac)?\s*:?\s*\d{4,8}\b\)?/g, ' ');
    s = s.replace(/(\d+(\.\d+)?)\s*(ltrs?|litres?|liters?|lt)\b/g, '$1l');
    s = s.replace(/(\d+(\.\d+)?)\s*(kgs?|kilos?|kilograms?)\b/g, '$1kg');
    s = s.replace(/(\d+(\.\d+)?)\s*(grms?|gms?|grams?|gm)\b/g, '$1g');
    s = s.replace(/(\d+(\.\d+)?)\s*(mls?|millilitres?)\b/g, '$1ml');
    s = s.replace(/(\d+(\.\d+)?)\s*(mm|cm|inch|inches|ft|feet|mtrs?|meters?|metres?)\b/g, '$1$3');
    s = s.replace(/^\s*(supply|supplying|providing|purchase|procurement)\s+(and\s+\w+\s+)?(of\s+)?/, '');
    s = s.replace(/\b(qty|nos|pcs|no|each)\b/g, ' ');
    s = s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > 100) {
        const cut = s.slice(0, 101);
        const i = cut.lastIndexOf(' ');
        s = (i > 0 ? cut.slice(0, i) : s.slice(0, 100)).trim();
    }
    return s.length ? s : null;
}

const UNITS: [string[], string][] = [
    [['nos', 'no', 'nos.', 'pcs', 'pc', 'piece', 'pieces', 'unit', 'units', 'each', 'ea'], 'nos'],
    [['ltr', 'ltrs', 'l', 'litre', 'liter', 'litres', 'liters'], 'ltr'],
    [['kg', 'kgs', 'kilo'], 'kg'],
    [['m', 'mtr', 'mtrs', 'meter', 'metre', 'rmt'], 'm'],
    [['rft', 'ft', 'feet', 'rft.'], 'ft'],
    [['sq. ft.', 'sq.ft', 'sq ft', 'sqft', 'sft', 'sq.ft.'], 'sqft'],
    [['sqm', 'sq. m', 'sq.m'], 'sqm'],
    [['hrs', 'hr', 'hour', 'hours'], 'hr'],
    [['day', 'days'], 'day'],
    [['month', 'months', 'mon', 'pm'], 'month'],
    [['services', 'service', 'job', 'ls', 'lot', 'lumpsum', 'lump sum'], 'job'],
    [['pkt', 'pkts', 'packet', 'packets', 'pack'], 'pkt'],
    [['bags', 'bag'], 'bag'],
    [['coils', 'coil'], 'coil'],
    [['bottle', 'bottles'], 'bottle'],
];
const UNIT_MAP = new Map(UNITS.flatMap(([from, to]) => from.map((f) => [f, to] as const)));

export function normalizeUnit(u: string | null | undefined): string | null {
    const v = String(u ?? '').trim().toLowerCase();
    if (!v) return null;
    return UNIT_MAP.get(v) ?? v;
}

/** One spelling per vendor: case, spacing and trailing punctuation only. */
const vendorKey = (v: string | null) => (v ?? '').toLowerCase().replace(/[.,]+$/g, '').replace(/\s+/g, ' ').trim();

/** The part of a vendor's name that would actually appear in an email subject. */
function vendorMentionKey(v: string): string {
    return v.toLowerCase()
        .replace(/\b(private|pvt|limited|ltd|llp|inc|co|company|enterprises?|services?|solutions?|india|the|and|&)\b\.?/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Keys and tokens never belong in a page, even if one slipped into a journal entry. */
export function redactSecrets(s: string): string {
    return s
        .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]')
        .replace(/\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, '[redacted key]')
        .replace(/\b[A-Za-z0-9]{40,}\b/g, '[redacted]');
}

/* ---------------------------------------------------------------------------
 * The build
 * ------------------------------------------------------------------------- */

interface ItemStat {
    slug: string;
    key: string;
    unit: string;
    label: string;
    lines: { po: WikiPo; line: WikiLine; date: string }[];
    kept: { po: WikiPo; line: WikiLine; date: string }[];
    outliers: number;
    median: number;
    p25: number;
    p75: number;
    min: number;
    max: number;
    last: { rate: number; date: string; vendor: string } | null;
    median12: number | null;
    medianPrior12: number | null;
    n12: number;
    nPrior12: number;
    spend: number;
}

/** Fewest purchases before a median counts as a benchmark (proposed 11 Sep: 3). */
export const ITEM_SAMPLE_FLOOR = 3;

export function buildWiki(src: WikiSources): WikiPage[] {
    const now = src.now;
    const today = now.toISOString().slice(0, 10);
    const minus = (days: number) => new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
    const d12 = minus(365), d24 = minus(730);
    const slugs = new Slugs();
    slugs.take('overview');
    slugs.take('flags');

    const poUrl = (p: WikiPo) => zohoBooksPoUrl(src.zohoOrgId, p.zoho_po_id, src.booksDc);
    const poRef = (p: WikiPo) => {
        const label = cell(p.po_number || p.id.slice(0, 8), 40);
        const url = poUrl(p);
        return url ? `[${label}](${url})` : label;
    };
    const siteOf = (p: WikiPo) => cell(p.project_name || p.cf_site || '', 60) || null;
    const amount = (p: WikiPo) => Number(p.po_amount) || 0;

    const pos = src.pos.filter((p) => p.id);
    const live = pos.filter(isLive);
    const poById = new Map(pos.map((p) => [p.id, p]));

    // ---- vendors and sites: slugs first, so every page can link to every other
    const vendorGroups = new Map<string, WikiPo[]>();
    for (const p of pos) {
        const k = vendorKey(p.vendor_name);
        if (!k) continue;
        (vendorGroups.get(k) ?? vendorGroups.set(k, []).get(k)!).push(p);
    }
    const vendorSlug = new Map<string, string>();
    const vendorName = new Map<string, string>();
    for (const [k, list] of [...vendorGroups].sort((a, b) => a[0].localeCompare(b[0]))) {
        const name = cell(mode(list.map((p) => (p.vendor_name ?? '').trim())) ?? k, 90);
        vendorName.set(k, name);
        vendorSlug.set(k, slugs.take(`vendor/${slugify(name)}`));
    }
    const vLink = (p: WikiPo) => {
        const k = vendorKey(p.vendor_name);
        return vendorSlug.has(k) ? link(vendorSlug.get(k)!, vendorName.get(k)!) : cell(p.vendor_name || '—');
    };

    const siteGroups = new Map<string, WikiPo[]>();
    for (const p of pos) {
        const s = siteOf(p);
        if (!s) continue;
        const k = s.toLowerCase();
        (siteGroups.get(k) ?? siteGroups.set(k, []).get(k)!).push(p);
    }
    const siteSlug = new Map<string, string>();
    const siteName = new Map<string, string>();
    for (const [k, list] of [...siteGroups].sort((a, b) => a[0].localeCompare(b[0]))) {
        const name = mode(list.map((p) => siteOf(p)!)) ?? k;
        siteName.set(k, name);
        siteSlug.set(k, slugs.take(`site/${slugify(name)}`));
    }
    const sLink = (p: WikiPo) => {
        const s = siteOf(p);
        const k = s?.toLowerCase() ?? '';
        return siteSlug.has(k) ? link(siteSlug.get(k)!, siteName.get(k)!) : (s || '—');
    };

    // ---- items
    const linesByPo = new Map<string, WikiLine[]>();
    for (const l of src.lines) (linesByPo.get(l.po_id) ?? linesByPo.set(l.po_id, []).get(l.po_id)!).push(l);

    const itemGroups = new Map<string, { po: WikiPo; line: WikiLine; date: string }[]>();
    let unitless = 0;
    for (const l of src.lines) {
        const po = poById.get(l.po_id);
        if (!po || !isLive(po)) continue;
        if (!normalizeUnit(l.unit)) unitless++;
        if (!PRICED.has(String(po.status ?? '').toLowerCase())) continue;
        const rate = Number(l.rate);
        if (!(rate > 0) || !po.po_date) continue;
        const key = normalizeItem((l.description ?? '').trim() || l.name);
        if (!key || key.length < 3) continue;
        const k = `${key}|${normalizeUnit(l.unit) ?? '-'}`;
        (itemGroups.get(k) ?? itemGroups.set(k, []).get(k)!).push({ po, line: l, date: po.po_date });
    }

    const items: ItemStat[] = [];
    for (const [k, rows] of itemGroups) {
        if (rows.length < ITEM_SAMPLE_FLOOR) continue;
        const m0 = median(rows.map((r) => Number(r.line.rate)));
        const kept = rows.filter((r) => { const x = Number(r.line.rate); return x <= m0 * 3 && x >= m0 / 3; });
        if (kept.length < ITEM_SAMPLE_FLOOR) continue;
        const rates = kept.map((r) => Number(r.line.rate)).sort((a, b) => a - b);
        const byDate = [...kept].sort((a, b) => a.date.localeCompare(b.date));
        const lastRow = byDate[byDate.length - 1];
        const r12 = kept.filter((r) => r.date >= d12).map((r) => Number(r.line.rate));
        const rPrior = kept.filter((r) => r.date >= d24 && r.date < d12).map((r) => Number(r.line.rate));
        const [key, unit] = k.split('|');
        const label = cell(mode(rows.map((r) => ((r.line.description ?? '').trim() || (r.line.name ?? '')).replace(/\s+/g, ' ').trim())) ?? key, 90);
        items.push({
            slug: '', key, unit, label, lines: rows, kept,
            outliers: rows.length - kept.length,
            median: quantile(rates, 0.5), p25: quantile(rates, 0.25), p75: quantile(rates, 0.75),
            min: rates[0], max: rates[rates.length - 1],
            last: lastRow ? { rate: Number(lastRow.line.rate), date: lastRow.date, vendor: lastRow.po.vendor_name ?? '—' } : null,
            median12: r12.length ? median(r12) : null,
            medianPrior12: rPrior.length ? median(rPrior) : null,
            n12: r12.length, nPrior12: rPrior.length,
            spend: kept.reduce((s, r) => s + (Number(r.line.item_total) || Number(r.line.rate) * (Number(r.line.quantity) || 0)), 0),
        });
    }
    items.sort((a, b) => b.spend - a.spend);
    for (const it of items) it.slug = slugs.take(`item/${slugify(`${it.key} ${it.unit === '-' ? '' : it.unit}`)}`);
    const itemByKey = new Map(items.map((it) => [`${it.key}|${it.unit}`, it]));
    const itemFor = (l: WikiLine) => {
        const key = normalizeItem((l.description ?? '').trim() || l.name);
        return key ? itemByKey.get(`${key}|${normalizeUnit(l.unit) ?? '-'}`) : undefined;
    };
    const drift = (it: ItemStat) => (it.median12 != null && it.medianPrior12 != null && it.n12 >= ITEM_SAMPLE_FLOOR && it.nPrior12 >= ITEM_SAMPLE_FLOOR && it.medianPrior12 > 0)
        ? ((it.median12 - it.medianPrior12) / it.medianPrior12) * 100 : null;

    // ---- mail ↔ vendor mentions
    const threads = src.threads.filter((t) => t.thread_id);
    const mailSlugFor = (t: WikiThread) => `mail/${month(t.last_message_at) ?? 'undated'}`;
    const mentions = new Map<string, WikiThread[]>();
    const haystack = threads.map((t) => ` ${`${t.subject ?? ''} ${t.snippet ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `);
    for (const [k] of vendorGroups) {
        const mk = vendorMentionKey(vendorName.get(k) ?? k);
        if (mk.length < 6) continue;
        const hits = threads.filter((_, i) => haystack[i].includes(` ${mk} `));
        if (hits.length) mentions.set(k, hits);
    }

    const pages: WikiPage[] = [];
    const sumLive = (list: WikiPo[]) => list.filter(isLive).reduce((s, p) => s + amount(p), 0);
    const statusMix = (list: WikiPo[]) => {
        const c = new Map<string, number>();
        for (const p of list) c.set(p.status ?? 'unknown', (c.get(p.status ?? 'unknown') ?? 0) + 1);
        return [...c].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · ');
    };
    const byFy = (list: WikiPo[]) => {
        const c = new Map<string, { n: number; v: number }>();
        for (const p of list.filter(isLive)) {
            if (!p.po_date) continue;
            const k = fy(p.po_date);
            const e = c.get(k) ?? { n: 0, v: 0 };
            e.n++; e.v += amount(p);
            c.set(k, e);
        }
        return table(['Financial year', 'POs', 'Value'], [...c].sort((a, b) => b[0].localeCompare(a[0])).map(([k, e]) => [k, String(e.n), inr(e.v)]));
    };
    const recentTable = (list: WikiPo[], n: number, cols: ('vendor' | 'site')[]) => {
        const rows = [...list].sort((a, b) => String(b.po_date ?? '').localeCompare(String(a.po_date ?? ''))).slice(0, n);
        return table(
            ['Date', 'PO', ...cols.map((c) => (c === 'vendor' ? 'Vendor' : 'Site')), 'Amount', 'Status'],
            rows.map((p) => [day(p.po_date) ?? '—', poRef(p), ...cols.map((c) => (c === 'vendor' ? vLink(p) : sLink(p))), inr(amount(p)), cell(p.status)]),
        );
    };
    const topBy = <K extends string>(list: WikiPo[], keyOf: (p: WikiPo) => K | null, label: (k: K, p: WikiPo) => string, n: number) => {
        const c = new Map<K, { n: number; v: number; p: WikiPo }>();
        for (const p of list.filter(isLive)) {
            const k = keyOf(p);
            if (!k) continue;
            const e = c.get(k) ?? { n: 0, v: 0, p };
            e.n++; e.v += amount(p);
            c.set(k, e);
        }
        return [...c].sort((a, b) => b[1].v - a[1].v).slice(0, n).map(([k, e]) => [label(k, e.p), String(e.n), inr(e.v)]);
    };
    const topItemsTable = (list: WikiPo[], n: number) => {
        const c = new Map<string, { label: string; slug: string | null; unit: string; qty: number; spend: number; rates: number[] }>();
        for (const p of list) {
            if (!PRICED.has(String(p.status ?? '').toLowerCase())) continue;
            for (const l of linesByPo.get(p.id) ?? []) {
                const rate = Number(l.rate);
                if (!(rate > 0)) continue;
                const it = itemFor(l);
                const key = it ? it.slug : `raw:${normalizeItem((l.description ?? '').trim() || l.name) ?? l.name}`;
                const e = c.get(key) ?? { label: it?.label ?? cell((l.description ?? '').trim() || l.name, 80), slug: it?.slug ?? null, unit: normalizeUnit(l.unit) ?? '—', qty: 0, spend: 0, rates: [] };
                e.qty += Number(l.quantity) || 0;
                e.spend += Number(l.item_total) || rate * (Number(l.quantity) || 0);
                e.rates.push(rate);
                c.set(key, e);
            }
        }
        return table(['Item', 'Unit', 'Lines', 'Median rate', 'Spend'],
            [...c.values()].sort((a, b) => b.spend - a.spend).slice(0, n)
                .map((e) => [e.slug ? link(e.slug, e.label) : e.label, e.unit, String(e.rates.length), inr(median(e.rates)), inr(e.spend)]));
    };

    // ---- vendor pages
    for (const [k, list] of vendorGroups) {
        const slug = vendorSlug.get(k)!;
        const name = vendorName.get(k)!;
        const dated = list.filter((p) => p.po_date).map((p) => p.po_date!).sort();
        const spend = sumLive(list);
        const mail = mentions.get(k) ?? [];
        const body = [
            `# ${name}`,
            `Vendor · ${list.length} POs (${list.filter(isLive).length} live) · ${inr(spend)} on live POs · first ${dated[0] ?? '—'} · last ${dated[dated.length - 1] ?? '—'}`,
            `Status mix: ${statusMix(list)}`,
            'PO values include tax. Item rates and spend below are before tax.',
            '## Spend by financial year', byFy(list),
            '## Sites served', table(['Site', 'POs', 'Value'], topBy(list, (p) => siteOf(p)?.toLowerCase() ?? null, (_k, p) => sLink(p), 15)),
            '## What we buy from them', topItemsTable(list, 15),
            '## Recent POs', recentTable(list, 20, ['site']),
            ...(mail.length ? ['## Purchase mail that mentions them',
                table(['Last message', 'Subject', 'From', 'Month page'],
                    mail.sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at))).slice(0, 12)
                        .map((t) => [day(t.last_message_at) ?? '—', cell(t.subject, 90), cell(t.from_address, 40), link(mailSlugFor(t), month(t.last_message_at) ?? 'undated')]))] : []),
        ].join('\n\n');
        pages.push({
            slug, kind: 'vendor', title: name,
            summary: `${list.length} POs, ${inr(spend)} on live POs, ${dated[0] ?? '—'} to ${dated[dated.length - 1] ?? '—'}.`,
            body_md: body, links: [], sources: [{ table: 'zoho_purchase_orders', rows: list.length }],
        });
    }

    // ---- site pages
    for (const [k, list] of siteGroups) {
        const slug = siteSlug.get(k)!;
        const name = siteName.get(k)!;
        const spend = sumLive(list);
        const body = [
            `# ${name}`,
            `Site · ${list.length} POs (${list.filter(isLive).length} live) · ${inr(spend)} on live POs`,
            `Status mix: ${statusMix(list)}`,
            'PO values include tax. Item rates and spend below are before tax.',
            '## Spend by financial year', byFy(list),
            '## Top vendors here', table(['Vendor', 'POs', 'Value'], topBy(list, (p) => vendorKey(p.vendor_name) || null, (_k, p) => vLink(p), 15)),
            '## Spend by category', table(['Category', 'POs', 'Value'], topBy(list, (p) => cell(p.category, 50) || null, (c) => c, 12)),
            '## What is bought here', topItemsTable(list, 15),
            '## Recent POs', recentTable(list, 20, ['vendor']),
        ].join('\n\n');
        pages.push({
            slug, kind: 'site', title: name,
            summary: `${list.length} POs, ${inr(spend)} on live POs.`,
            body_md: body, links: [], sources: [{ table: 'zoho_purchase_orders', rows: list.length }],
        });
    }

    // ---- item pages
    for (const it of items) {
        const vend = new Map<string, number[]>();
        const vendLast = new Map<string, { rate: number; date: string; po: WikiPo }>();
        for (const r of it.kept) {
            const k = vendorKey(r.po.vendor_name) || '—';
            (vend.get(k) ?? vend.set(k, []).get(k)!).push(Number(r.line.rate));
            const prev = vendLast.get(k);
            if (!prev || r.date > prev.date) vendLast.set(k, { rate: Number(r.line.rate), date: r.date, po: r.po });
        }
        const q = new Map<string, number[]>();
        for (const r of it.kept) (q.get(quarter(r.date)) ?? q.set(quarter(r.date), []).get(quarter(r.date))!).push(Number(r.line.rate));
        const d = drift(it);
        const unit = it.unit === '-' ? 'unit (none recorded)' : it.unit;
        const sites = [...new Set(it.kept.map((r) => siteOf(r.po)).filter(Boolean))] as string[];
        const body = [
            `# ${it.label}`,
            `Item · per ${unit} · ${it.kept.length} purchases on ${new Set(it.kept.map((r) => r.po.id)).size} POs from ${vend.size} vendor(s)`,
            table(['Measure', 'Rate'], [
                ['Median', inr(it.median)], ['Middle half (p25–p75)', `${inr(it.p25)} – ${inr(it.p75)}`],
                ['Lowest / highest', `${inr(it.min)} / ${inr(it.max)}`],
                ['Last paid', it.last ? `${inr(it.last.rate)} on ${it.last.date} (${cell(it.last.vendor, 60)})` : '—'],
                ['Median, last 12 months', it.median12 != null ? `${inr(it.median12)} (${it.n12} purchases)` : '—'],
                ['Median, the 12 months before', it.medianPrior12 != null ? `${inr(it.medianPrior12)} (${it.nPrior12} purchases)` : '—'],
                ['Change year on year', d != null ? pct(d) : `not measured (needs ${ITEM_SAMPLE_FLOOR}+ purchases in both years)`],
                ['Total spend', inr(it.spend)],
            ]),
            it.outliers ? `${it.outliers} purchase(s) priced more than 3× away from the median were left out of these figures.` : '',
            '## By vendor', table(['Vendor', 'Purchases', 'Their median', 'Their last', 'Last date'],
                [...vend].sort((a, b) => median(a[1]) - median(b[1])).map(([k, rates]) => {
                    const last = vendLast.get(k)!;
                    return [vLink(last.po), String(rates.length), inr(median(rates)), inr(last.rate), last.date];
                })),
            '## Median by quarter', table(['Quarter', 'Purchases', 'Median'],
                [...q].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10).map(([k, rates]) => [k, String(rates.length), inr(median(rates))])),
            '## Recent purchases', table(['Date', 'PO', 'Vendor', 'Site', 'Qty', 'Rate', 'Line total'],
                [...it.kept].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15)
                    .map((r) => [r.date, poRef(r.po), vLink(r.po), sLink(r.po), String(r.line.quantity ?? '—'), inr(Number(r.line.rate)), inr(Number(r.line.item_total))])),
            sites.length ? `Sites: ${sites.slice(0, 12).join(', ')}` : '',
            `Benchmark key: \`${cell(it.key, 100)} | ${it.unit}\`. Rates are before tax, from approved, open and billed POs only.`,
        ].filter(Boolean).join('\n\n');
        pages.push({
            slug: it.slug, kind: 'item', title: it.label,
            summary: `Median ${inr(it.median)} per ${unit} over ${it.kept.length} purchases; last ${it.last ? `${inr(it.last.rate)} on ${it.last.date}` : '—'}${d != null ? `; ${pct(d)} year on year` : ''}.`,
            body_md: body, links: [], sources: [{ table: 'zoho_po_line_items', rows: it.lines.length }],
        });
    }

    // ---- month pages (by the PO's own date)
    const monthGroups = new Map<string, WikiPo[]>();
    for (const p of pos) {
        const m = month(p.po_date);
        if (m) (monthGroups.get(m) ?? monthGroups.set(m, []).get(m)!).push(p);
    }
    const monthSlugs: string[] = [];
    for (const [m, list] of [...monthGroups].sort((a, b) => b[0].localeCompare(a[0]))) {
        const slug = slugs.take(`month/${m}`);
        monthSlugs.push(slug);
        const sorted = [...list].sort((a, b) => amount(b) - amount(a));
        const body = [
            `# POs dated ${m}`,
            `${list.length} POs · ${inr(sumLive(list))} on live POs · status mix: ${statusMix(list)}`,
            'Dated by the date on the PO. A PO raised in a later month but dated this month appears here.',
            '## By site', table(['Site', 'POs', 'Value'], topBy(list, (p) => siteOf(p)?.toLowerCase() ?? null, (_k, p) => sLink(p), 20)),
            '## By vendor', table(['Vendor', 'POs', 'Value'], topBy(list, (p) => vendorKey(p.vendor_name) || null, (_k, p) => vLink(p), 20)),
            '## Every PO, largest first', table(['Date', 'PO', 'Vendor', 'Site', 'Amount', 'Status'],
                sorted.slice(0, 150).map((p) => [day(p.po_date) ?? '—', poRef(p), vLink(p), sLink(p), inr(amount(p)), cell(p.status)])),
            sorted.length > 150 ? `…and ${sorted.length - 150} smaller POs.` : '',
        ].filter(Boolean).join('\n\n');
        pages.push({
            slug, kind: 'month', title: `POs dated ${m}`,
            summary: `${list.length} POs, ${inr(sumLive(list))} on live POs.`,
            body_md: body, links: [], sources: [{ table: 'zoho_purchase_orders', rows: list.length }],
        });
    }

    // ---- mail pages
    const mailGroups = new Map<string, WikiThread[]>();
    for (const t of threads) (mailGroups.get(mailSlugFor(t)) ?? mailGroups.set(mailSlugFor(t), []).get(mailSlugFor(t))!).push(t);
    const mailSlugs: string[] = [];
    for (const [slug, list] of [...mailGroups].sort((a, b) => b[0].localeCompare(a[0]))) {
        slugs.take(slug);
        mailSlugs.push(slug);
        const m = slug.slice(5);
        const open = list.filter((t) => !t.is_resolved);
        const body = [
            `# purchase@ mail, ${m}`,
            `${list.length} threads by latest message · ${open.length} not marked resolved`,
            'From the purchase@ digest, which keeps each thread\'s subject and opening lines only, never full text or attachments.',
            table(['Last message', 'Subject', 'From', 'Msgs', 'Waiting on', 'Resolved', 'Opening lines'],
                [...list].sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at))).slice(0, 200)
                    .map((t) => [day(t.last_message_at) ?? '—', cell(t.subject, 90), cell(t.from_address, 40), String(t.message_count ?? '—'),
                        cell(t.waiting_on, 30) || '—', t.is_resolved ? 'yes' : 'no', cell(t.snippet, 160)])),
        ].join('\n\n');
        pages.push({
            slug, kind: 'mail', title: `purchase@ mail, ${m}`,
            summary: `${list.length} threads, ${open.length} not resolved.`,
            body_md: body, links: [], sources: [{ table: 'mailbox_threads', rows: list.length }],
        });
    }

    // ---- dev journal pages
    const devSlugs: { slug: string; title: string; date: string }[] = [];
    if (src.journal) {
        const parts = src.journal.split(/^(?=## \d{4}-\d{2}-\d{2} — )/m).filter((s) => /^## \d{4}-\d{2}-\d{2} — /.test(s));
        for (const part of parts) {
            const head = part.split('\n', 1)[0];
            const m = /^## (\d{4}-\d{2}-\d{2}) — (.+)$/.exec(head);
            if (!m) continue;
            const [, date, rawTitle] = m;
            const title = rawTitle.replace(/^[^:]{1,40}:\s*/, '').trim() || rawTitle;
            const slug = slugs.take(`dev/${date}-${slugify(title, 50)}`);
            const text = redactSecrets(part.slice(head.length).trim());
            const lead = /^\*\*(.+?)\*\*/m.exec(text)?.[1] ?? '';
            devSlugs.push({ slug, title, date });
            pages.push({
                slug, kind: 'dev', title: `${date} — ${title}`,
                summary: cell(lead || title, 240),
                body_md: `# ${date} — ${cell(title, 160)}\n\nDevelopment journal entry.\n\n${text}`,
                links: [], sources: [{ table: 'docs/JOURNAL.md', rows: 1 }],
            });
        }
    }

    // ---- red flags
    const ageDays = (p: WikiPo) => {
        const t = Date.parse(p.created_time || p.po_date || '');
        return Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86400000) : null;
    };
    const pending = pos.filter((p) => p.status === 'pending_approval').sort((a, b) => (ageDays(b) ?? 0) - (ageDays(a) ?? 0));
    const oldDrafts = pos.filter((p) => p.status === 'draft' && (ageDays(p) ?? 0) > 30).sort((a, b) => amount(b) - amount(a));
    const dupes: [WikiPo, WikiPo][] = [];
    for (const list of vendorGroups.values()) {
        const l = list.filter((p) => isLive(p) && amount(p) > 0 && p.po_date).sort((a, b) => a.po_date!.localeCompare(b.po_date!));
        for (let i = 0; i < l.length; i++) {
            for (let j = i + 1; j < l.length; j++) {
                const gap = (Date.parse(l[j].po_date!) - Date.parse(l[i].po_date!)) / 86400000;
                if (gap > 30) break;
                if (amount(l[i]) === amount(l[j])) dupes.push([l[i], l[j]]);
            }
        }
    }
    dupes.sort((a, b) => amount(b[0]) - amount(a[0]));
    const movers = items.map((it) => ({ it, d: drift(it) })).filter((x): x is { it: ItemStat; d: number } => x.d != null);
    const risers = movers.filter((x) => x.d >= 25).sort((a, b) => b.d - a.d);
    const fallers = movers.filter((x) => x.d <= -25).sort((a, b) => a.d - b.d);
    const liveNoLines = live.filter((p) => !linesByPo.has(p.id));
    const flagsBody = [
        '# Red flags',
        'Checks computed on every rebuild. A flag is a question to ask, not a verdict: an amount repeated within a month can be a monthly contract, and a price rise can be a better specification.',
        `## Pending approval (${pending.length}, ${inr(pending.reduce((s, p) => s + amount(p), 0))})`,
        table(['Age (days)', 'PO', 'Vendor', 'Site', 'Amount'],
            pending.slice(0, 60).map((p) => [String(ageDays(p) ?? '—'), poRef(p), vLink(p), sLink(p), inr(amount(p))])),
        `## Drafts older than 30 days (${oldDrafts.length}, ${inr(oldDrafts.reduce((s, p) => s + amount(p), 0))})`,
        table(['Age (days)', 'PO', 'Vendor', 'Amount'], oldDrafts.slice(0, 25).map((p) => [String(ageDays(p) ?? '—'), poRef(p), vLink(p), inr(amount(p))])),
        `## Same vendor, same amount, within 30 days (${dupes.length} pairs)`,
        table(['Vendor', 'First PO', 'Second PO', 'Amount', 'Days apart'],
            dupes.slice(0, 40).map(([a, b]) => [vLink(a), `${poRef(a)} (${day(a.po_date)})`, `${poRef(b)} (${day(b.po_date)})`, inr(amount(a)),
                String(Math.round((Date.parse(b.po_date!) - Date.parse(a.po_date!)) / 86400000))])),
        `## Items up 25% or more year on year (${risers.length})`,
        table(['Item', 'Unit', 'Prior 12m median', 'Last 12m median', 'Change'],
            risers.slice(0, 30).map(({ it, d }) => [link(it.slug, it.label), it.unit, inr(it.medianPrior12), inr(it.median12), pct(d)])),
        `## Items down 25% or more year on year (${fallers.length})`,
        table(['Item', 'Unit', 'Prior 12m median', 'Last 12m median', 'Change'],
            fallers.slice(0, 20).map(({ it, d }) => [link(it.slug, it.label), it.unit, inr(it.medianPrior12), inr(it.median12), pct(d)])),
        '## Data gaps',
        `- ${unitless} line items on live POs have no unit, so their rates cannot be compared.`,
        `- ${liveNoLines.length} live POs have no line items synced yet.`,
        '- Not checked, because the data is not synced: who approved each PO, vendor bills, and payments.',
    ].join('\n\n');
    pages.push({
        slug: 'flags', kind: 'flags', title: 'Red flags',
        summary: `${pending.length} POs pending approval, ${dupes.length} same-amount pairs, ${risers.length} items up 25%+ year on year.`,
        body_md: flagsBody, links: [], sources: [{ table: 'zoho_purchase_orders', rows: pos.length }, { table: 'zoho_po_line_items', rows: src.lines.length }],
    });

    // ---- overview = the index
    const dates = pos.map((p) => p.po_date).filter(Boolean).sort() as string[];
    const topVendors = [...vendorGroups].map(([k, l]) => ({ k, v: sumLive(l) })).sort((a, b) => b.v - a.v).slice(0, 30);
    const topSites = [...siteGroups].map(([k, l]) => ({ k, v: sumLive(l), n: l.length })).sort((a, b) => b.v - a.v);
    const overview = [
        '# Wiki overview',
        `Compiled ${today}. Start here: this page lists what the wiki holds and links to every hub.`,
        '## What is in here',
        table(['Source', 'Rows', 'Pages'], [
            ['Zoho Books purchase orders', String(pos.length), `${vendorGroups.size} vendors, ${siteGroups.size} sites, ${monthGroups.size} months`],
            ['PO line items', String(src.lines.length), `${items.length} items bought ${ITEM_SAMPLE_FLOOR}+ times`],
            ['purchase@ digest threads', String(threads.length), `${mailGroups.size} months`],
            ['Development journal', src.journal ? `${devSlugs.length} entries` : 'not found on this server', String(devSlugs.length)],
        ]),
        `POs run from ${dates[0] ?? '—'} to ${dates[dates.length - 1] ?? '—'}. ${live.length} are live (${inr(sumLive(pos))}); drafts, cancelled and rejected POs are listed but never counted as spend.`,
        'PO values, and the vendor, site and month totals built from them, include tax as on the PO. Item rates and line totals are before tax.',
        'Not in here: vendor bills, payments, approver names, full email text and attachments.',
        '## Spend by financial year', byFy(pos),
        '## Top vendors', table(['Vendor', 'Live value'], topVendors.map(({ k, v }) => [link(vendorSlug.get(k)!, vendorName.get(k)!), inr(v)])),
        '## Sites', table(['Site', 'POs', 'Live value'], topSites.map(({ k, v, n }) => [link(siteSlug.get(k)!, siteName.get(k)!), String(n), inr(v)])),
        '## Most-bought items', table(['Item', 'Unit', 'Median', 'Spend'], items.slice(0, 25).map((it) => [link(it.slug, it.label), it.unit, inr(it.median), inr(it.spend)])),
        '## Months', monthSlugs.slice(0, 24).map((s) => link(s, s.slice(6))).join(' · ') || '_None._',
        '## purchase@ mail', mailSlugs.slice(0, 12).map((s) => link(s, s.slice(5))).join(' · ') || '_None._',
        '## Development journal', devSlugs.length
            ? devSlugs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15).map((d) => `- ${link(d.slug, `${d.date} — ${d.title}`)}`).join('\n')
            : '_Journal not available on this server._',
        `## Red flags\n\n${link('flags', 'Red flags')}: pending approvals, old drafts, repeated amounts, price movers and data gaps.`,
    ].join('\n\n');
    pages.push({
        slug: 'overview', kind: 'overview', title: 'Wiki overview',
        summary: `${pos.length} POs, ${vendorGroups.size} vendors, ${siteGroups.size} sites, ${items.length} benchmarked items, ${threads.length} mail threads, ${devSlugs.length} journal entries.`,
        body_md: overview, links: [], sources: [{ table: 'zoho_purchase_orders', rows: pos.length }],
    });

    // ---- links, from the [[slug|…]] references each page actually carries
    for (const p of pages) {
        p.links = [...new Set([...p.body_md.matchAll(/\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]))].filter((s) => s !== p.slug);
        if (p.body_md.length > 60000) p.body_md = `${p.body_md.slice(0, 60000)}\n\n_Page cut at 60,000 characters._`;
    }
    return pages;
}
