/**
 * The Action Catalog: every question and action the AI layer can handle. The AI is shown only the entries that pass
 * both the org's settings (narrow) and the entry's own allowed(actor) check (the app's access rules).
 *
 * Never in the catalog, so no wording can trigger them: deleting anything, changing roles, permissions or users,
 * approving or paying, bulk changes, free-form database queries, org settings (plan section 5.3).
 */
import { z } from 'zod';
import type { ActorContext, AiData, EntryKind, EntryMode, EntryResult, Lang, ModuleId } from './types';
import { PERIODS, previousRange, rangeFor, type Period } from './dates';
import { periodLabel, scopeLabel, t } from './language';
import { entryModeFor, gridLevelFor, type AiSettings } from './settings';

export interface RunContext { actor: ActorContext; data: AiData; lang: Lang; now: Date }

export interface QuestionEntry<F> {
    id: string;
    kind: 'question';
    module: ModuleId;
    /** Shown to the AI. What it does, when to use it, when NOT to (doctrine L8). */
    description: string;
    fieldsHint: string;
    abilities: Record<Lang, string>;
    fields: z.ZodType<F>;
    defaultMode: EntryMode;
    allowed(actor: ActorContext): boolean;
    run(ctx: RunContext, fields: F, propertyIds: string[]): Promise<EntryResult>;
}

export interface WriteEntry {
    id: string;
    kind: 'write';
    module: ModuleId;
    description: string;
    fieldsHint: string;
    abilities: Record<Lang, string>;
    defaultMode: EntryMode;
    allowed(actor: ActorContext): boolean;
}

export type CatalogEntry = QuestionEntry<any> | WriteEntry; // eslint-disable-line @typescript-eslint/no-explicit-any

const period = z.enum(PERIODS).default('today');
const propertyName = z.string().trim().max(120).nullish();

// ── Tickets ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const CLOSED = new Set(['resolved', 'completed', 'closed']);

const ticketsCountFields = z.object({ period, status: z.enum(['open', 'closed', 'all']).default('all'), property_name: propertyName }).strip();

export const ticketsCount: QuestionEntry<z.infer<typeof ticketsCountFields>> = {
    id: 'tickets.count', kind: 'question', module: 'tickets',
    description: 'Count tickets raised in a period, split into open and closed, with the busiest category. Use for "how many tickets today / this week / pending". Do NOT use to list individual tickets (use tickets.list).',
    fieldsHint: `{"period": one of ${PERIODS.join('|')}, "status": "open"|"closed"|"all", "property_name": building name if the person named one, else null}`,
    abilities: { en: 'count tickets', hi: 'टिकट गिनना', hinglish: 'tickets count karna' },
    fields: ticketsCountFields, defaultMode: 'live',
    allowed: () => true, // every role, limited by recordRule (tenants: their own; vendors: assigned to them)
    async run({ actor, data, lang, now }, f, propertyIds) {
        const r = rangeFor(f.period as Period, now);
        const rows = await data.countTickets({ orgId: actor.orgId, propertyIds, from: r.fromIso, to: r.toIso, status: f.status, recordRule: actor.recordRule, userId: actor.userId });
        const scope = scopeLabel(propertyIds.map(id => actor.propertyNames[id]), lang);
        const label = periodLabel(f.period as Period, lang);
        if (!rows.length) return { ok: true, reply: t('tickets_none', lang, { period: label, scope }) };
        const closed = rows.filter(x => CLOSED.has(x.status)).length;
        const byCat = new Map<string, number>();
        for (const x of rows) if (x.category) byCat.set(x.category, (byCat.get(x.category) || 0) + 1);
        const topCat = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
        let reply = t('tickets_count', lang, {
            period: label, scope, total: rows.length, open: rows.length - closed, closed,
            top: topCat ? t('tickets_top', lang, { category: topCat[0], count: topCat[1] }) : '',
        });
        if (propertyIds.length > 1) {
            const per = new Map<string, number>();
            for (const x of rows) per.set(x.propertyId, (per.get(x.propertyId) || 0) + 1);
            reply += '\n' + [...per.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `• ${actor.propertyNames[id]}: ${n}`).join('\n');
        }
        return { ok: true, reply };
    },
};

const ticketsListFields = z.object({
    period, status: z.enum(['open', 'closed', 'all']).default('open'),
    priority: z.enum(['low', 'medium', 'high', 'urgent', 'critical']).nullish(), property_name: propertyName,
}).strip();

export const ticketsList: QuestionEntry<z.infer<typeof ticketsListFields>> = {
    id: 'tickets.list', kind: 'question', module: 'tickets',
    description: 'List up to 10 tickets (number, title, status) for a period, optionally only open/closed or one priority. Use for "show today\'s critical tickets", "my open tickets". Do NOT use for counts only (use tickets.count).',
    fieldsHint: `{"period": one of ${PERIODS.join('|')}, "status": "open"|"closed"|"all", "priority": "low"|"medium"|"high"|"urgent"|"critical"|null, "property_name": string|null}`,
    abilities: { en: 'list tickets', hi: 'टिकट की सूची', hinglish: 'tickets ki list' },
    fields: ticketsListFields, defaultMode: 'live',
    allowed: () => true,
    async run({ actor, data, lang, now }, f, propertyIds) {
        const r = rangeFor(f.period as Period, now);
        const q = { orgId: actor.orgId, propertyIds, from: r.fromIso, to: r.toIso, status: f.status, recordRule: actor.recordRule, userId: actor.userId, priority: f.priority ?? null };
        const [rows, all] = await Promise.all([data.listTickets(q, 10), data.countTickets(q)]);
        const scope = scopeLabel(propertyIds.map(id => actor.propertyNames[id]), lang);
        const label = periodLabel(f.period as Period, lang);
        if (!rows.length) return { ok: true, reply: t('tickets_none', lang, { period: label, scope }) };
        const multi = propertyIds.length > 1;
        // Titles are other people's words: shown as quoted data, cut short, never read as instructions (gap S20).
        const lines = rows.map(x => `• ${x.ticketNumber} · ${clip(x.title, 60)} · ${x.status}${x.priority ? ` · ${x.priority}` : ''}${multi ? ` · ${actor.propertyNames[x.propertyId]}` : ''}`);
        return { ok: true, reply: `${t('tickets_list_head', lang, { period: label, scope, shown: rows.length, total: all.length })}\n${lines.join('\n')}` };
    },
};

// ── Electricity meter readings ──────────────────────────────────────────────────────────────────────────────────────

const readingsFields = z.object({ day: z.enum(['today', 'yesterday']).default('today'), property_name: propertyName }).strip();

export const readingsStatus: QuestionEntry<z.infer<typeof readingsFields>> = {
    id: 'electricity.readings_status', kind: 'question', module: 'electricity_readings',
    description: 'Status of daily electricity meter readings for today or yesterday: how many active meters are logged, which are missing, which readings have warning/critical alerts, which meters are faulty. Use for "meter reading status", "aaj ki reading ho gayi?". Do NOT use for electricity BILLS or payments (not available here).',
    fieldsHint: '{"day": "today"|"yesterday", "property_name": string|null}',
    abilities: { en: 'meter reading status', hi: 'मीटर रीडिंग की स्थिति', hinglish: 'meter reading status' },
    fields: readingsFields, defaultMode: 'live',
    allowed: actor => !actor.ownRecordsOnly, // tenants and vendors don't see building meters
    async run({ actor, data, lang, now }, f, propertyIds) {
        const day = rangeFor(f.day, now).fromDate;
        const rows = await data.readingsStatus(propertyIds, day);
        const label = periodLabel(f.day, lang);
        // Many properties (org-wide roles): one summary line + one short line each, worst first. Details for one property.
        if (propertyIds.length > 3) {
            const per = propertyIds.map(pid => {
                const mine = rows.filter(r => r.propertyId === pid);
                const active = mine.filter(r => r.meterStatus === 'active');
                return {
                    pid, active: active.length, logged: active.filter(r => r.logged).length,
                    critical: mine.filter(r => r.alertStatus === 'critical').length,
                    faulty: mine.filter(r => r.meterStatus === 'faulty').length,
                };
            }).filter(p => p.active > 0 || p.faulty > 0);
            if (!per.length) return { ok: true, reply: t('readings_no_meters', lang, { property: scopeLabel(propertyIds.map(id => actor.propertyNames[id]), lang) }) };
            per.sort((a, b) => (a.logged / Math.max(a.active, 1)) - (b.logged / Math.max(b.active, 1)) || b.active - a.active);
            const total = per.reduce((n, p) => n + p.active, 0); const done = per.reduce((n, p) => n + p.logged, 0);
            const lines = per.slice(0, 12).map(p => t('readings_line', lang, {
                property: actor.propertyNames[p.pid], logged: p.logged, active: p.active,
                extra: `${p.critical ? `, 🔴 ${p.critical} critical` : ''}${p.faulty ? `, 🛠️ ${p.faulty} faulty` : ''}`,
            }));
            if (per.length > 12) lines.push(`+${per.length - 12}`);
            return { ok: true, reply: [t('readings_summary', lang, { period: label, logged: done, active: total, count: per.length }), ...lines,
                t('readings_more', lang, { example: actor.propertyNames[per[0].pid] })].join('\n') };
        }
        const out: string[] = [];
        for (const pid of propertyIds) {
            const mine = rows.filter(r => r.propertyId === pid);
            const active = mine.filter(r => r.meterStatus === 'active');
            const name = actor.propertyNames[pid];
            if (!active.length && !mine.some(r => r.meterStatus === 'faulty')) {
                if (propertyIds.length === 1) out.push(t('readings_no_meters', lang, { property: name }));
                continue;
            }
            const logged = active.filter(r => r.logged);
            const missing = active.filter(r => !r.logged).map(r => r.meterName);
            const critical = mine.filter(r => r.alertStatus === 'critical').map(r => r.meterName);
            const warning = mine.filter(r => r.alertStatus === 'warning').map(r => r.meterName);
            const faulty = mine.filter(r => r.meterStatus === 'faulty').map(r => r.meterName);
            const lines = [t('readings_head', lang, { period: label, property: name }), t('readings_logged', lang, { logged: logged.length, active: active.length })];
            if (missing.length) lines.push(t('readings_missing', lang, { meters: list(missing) }));
            if (critical.length) lines.push(t('readings_critical', lang, { meters: list(critical) }));
            if (warning.length) lines.push(t('readings_warning', lang, { meters: list(warning) }));
            if (faulty.length) lines.push(t('readings_faulty', lang, { meters: list(faulty) }));
            out.push(lines.join('\n'));
        }
        return { ok: true, reply: out.join('\n\n') || t('readings_no_meters', lang, { property: scopeLabel(propertyIds.map(id => actor.propertyNames[id]), lang) }) };
    },
};

const consumptionFields = z.object({ period: z.enum(PERIODS).default('this_month'), property_name: propertyName }).strip();

export const consumption: QuestionEntry<z.infer<typeof consumptionFields>> = {
    id: 'electricity.consumption', kind: 'question', module: 'electricity_readings',
    description: 'Total electricity units consumed in a period from daily meter readings, compared with the previous period of the same length. Use for "kitni units consume hui is mahine". Do NOT use for bill amounts.',
    fieldsHint: `{"period": one of ${PERIODS.join('|')}, "property_name": string|null}`,
    abilities: { en: 'electricity consumption', hi: 'बिजली की खपत', hinglish: 'bijli consumption' },
    fields: consumptionFields, defaultMode: 'live',
    allowed: actor => !actor.ownRecordsOnly,
    async run({ actor, data, lang, now }, f, propertyIds) {
        const r = rangeFor(f.period as Period, now);
        const p = previousRange(r);
        const [cur, prev] = await Promise.all([data.consumption(propertyIds, r.fromDate, r.toDate), data.consumption(propertyIds, p.fromDate, p.toDate)]);
        const scope = scopeLabel(propertyIds.map(id => actor.propertyNames[id]), lang);
        const label = periodLabel(f.period as Period, lang);
        // Known bad rows (electricity_reading_anomalies) are left out, otherwise one wrong multiplier ruins the total.
        const good = cur.filter(x => !x.anomaly);
        if (!good.length) return { ok: true, reply: t('consumption_none', lang, { period: label, scope }) };
        const sum = (xs: typeof cur) => xs.filter(x => !x.anomaly).reduce((a, x) => a + x.units, 0);
        const units = sum(cur); const prevUnits = sum(prev);
        const change = prevUnits > 0 ? `${units >= prevUnits ? '+' : ''}${Math.round(((units - prevUnits) / prevUnits) * 100)}%` : 'n/a';
        let reply = t('consumption', lang, { period: label, scope, units: fmt(units), days: new Set(good.map(x => x.date)).size, prevUnits: fmt(prevUnits), change });
        const bad = cur.length - good.length;
        if (bad) reply += t('anomalies_note', lang, { n: bad });
        return { ok: true, reply };
    },
};

// ── Ticket creation (write) ────────────────────────────────────────────────────────────────────────────────────────

export const ticketCreate: WriteEntry = {
    id: 'ticket.create', kind: 'write', module: 'tickets',
    description: 'Raise a new maintenance / facility ticket (AC not working, leak, light fused, cleaning needed). Use when the person reports a problem or asks to raise a ticket. Do NOT use to check, list, close, assign or delete tickets. Do NOT use for HR matters (grievances, complaints about a person, salary, leave).',
    fieldsHint: '{"description": the problem in the person\'s own words, or null, "location": floor/room/cabin if mentioned, or null, "property_name": string|null, "urgent": true if they said urgent/emergency, else false}',
    abilities: { en: 'raise a ticket', hi: 'टिकट बनाना', hinglish: 'ticket raise karna' },
    defaultMode: 'shadow', // writes start in shadow until an org super admin switches them live (plan decision D7)
    allowed: actor => actor.propertyIds.length > 0,
};

export const CATALOG: CatalogEntry[] = [ticketsCount, ticketsList, readingsStatus, consumption, ticketCreate];

/** The entries this actor may use under these settings, with their mode. Narrow only: settings AND app rules. */
export function catalogFor(actor: ActorContext, s: AiSettings): Array<{ entry: CatalogEntry; mode: EntryMode }> {
    const out: Array<{ entry: CatalogEntry; mode: EntryMode }> = [];
    for (const entry of CATALOG) {
        if (!entry.allowed(actor)) continue;
        const level = gridLevelFor(actor, s, entry.module);
        if (level === 'off') continue;
        if (entry.kind === 'write' && level !== 'questions_actions') continue;
        const mode = entryModeFor(s, entry.id, entry.defaultMode);
        if (mode === 'off') continue;
        out.push({ entry, mode });
    }
    return out;
}

export function entryKindOf(id: string): EntryKind | null {
    return CATALOG.find(e => e.id === id)?.kind ?? null;
}

// ── helpers ──

function clip(s: string, n: number): string {
    const one = String(s || '').replace(/\s+/g, ' ').replace(/https?:\/\/\S+/gi, '[link]').trim();
    return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}
function list(xs: string[]): string { return xs.slice(0, 8).join(', ') + (xs.length > 8 ? ` +${xs.length - 8}` : ''); }
function fmt(n: number): string { return Math.round(n).toLocaleString('en-IN'); }

/** Lower-case, letters and digits only, single spaces. */
function norm(s: string): string {
    return s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Edit distance, capped: enough to forgive "maftalal" for "mafatlal" (a swap = 2 edits) on longer words. */
function editDistance(a: string, b: string, cap = 3): number {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let best = i;
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            best = Math.min(best, cur[j]);
        }
        if (best > cap) return cap + 1;
        prev = cur;
    }
    return prev[b.length];
}

/** Does word w (from what the person typed) match word t (from a property name), allowing small spelling mistakes? */
function wordMatches(w: string, t: string): boolean {
    if (w === t) return true;
    if (w.length >= 4 && (t.startsWith(w) || w.startsWith(t) && t.length >= 4)) return true;
    if (w.length >= 5 && t.length >= 5) return editDistance(w, t, 2) <= 2;
    return false;
}

/**
 * How well what the person typed matches one property (its name and its nicknames): 0..1. Every typed word must find a
 * matching word for a full score; generic words like "the" or "office" count for less.
 */
const WEAK = new Set(['the', 'office', 'building', 'property', 'site', 'chambers', 'tower', 'plaza', 'house', 'park', 'centre', 'center']);
function scoreName(typed: string[], name: string): number {
    const target = norm(name).split(' ').filter(Boolean);
    if (!typed.length || !target.length) return 0;
    if (typed.join(' ') === target.join(' ')) return 1;
    let got = 0; let total = 0;
    for (const w of typed) {
        const weight = WEAK.has(w) || w.length <= 2 ? 0.3 : 1;
        total += weight;
        if (target.some(t => wordMatches(w, t))) got += weight;
    }
    return total ? got / total : 0;
}

export function rankProperties(name: string, names: Record<string, string>, aliases: Record<string, string[]> = {}): Array<{ id: string; score: number }> {
    const typed = norm(name).split(' ').filter(Boolean);
    return Object.entries(names)
        .map(([id, n]) => ({ id, score: Math.max(scoreName(typed, n), ...(aliases[id] || []).map(a => scoreName(typed, a))) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score);
}

/**
 * Match a property name the person or the AI gave against the actor's properties (names and nicknames), forgiving
 * small spelling mistakes. null = no clear single match (then use suggestProperties for "Did you mean…?").
 */
export function matchProperty(name: string, names: Record<string, string>, aliases: Record<string, string[]> = {}): string | null {
    const ranked = rankProperties(name, names, aliases);
    if (!ranked.length || ranked[0].score < 0.75) return null;
    if (ranked.length > 1 && ranked[1].score >= ranked[0].score - 0.1) return null; // two look the same: don't guess
    return ranked[0].id;
}

/** Up to 5 likely properties for "Did you mean…?". */
export function suggestProperties(name: string, names: Record<string, string>, aliases: Record<string, string[]> = {}): string[] {
    return rankProperties(name, names, aliases).filter(r => r.score >= 0.3).slice(0, 5).map(r => r.id);
}
