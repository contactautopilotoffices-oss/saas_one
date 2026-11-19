/**
 * Ticket sorting that learns (owner 2026-11-19): the database side. Server only. Every read is limited to one
 * organisation in code (service-role client). Tables: migration 20261119000001 (ticket_sort_examples,
 * ticket_sort_traces). Until it is applied every read here gives "nothing" and sorting works as before.
 *
 * Nothing here may stop a ticket from being created or judged: a failure is logged and the caller carries on.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SkillGroup } from './classifyTicket';
import { calibrationFrom, meaningStrength, type CalibrationTable, type Example, type ExampleSource, type Neighbour, type NeighbourNote } from './sortLearning';

type Row = Record<string, unknown>;
const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42703', 'PGRST204', '42883']);
export const isMissing = (e: { code?: string } | null | undefined) => !!e && MISSING.has(String(e.code ?? ''));
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);
const TEAMS = ['technical', 'plumbing', 'vendor', 'soft_services'];
const asTeam = (x: unknown): SkillGroup | null => (TEAMS.includes(String(x)) ? (x as SkillGroup) : null);
const DAY_MS = 86_400_000;

async function adminOf(admin?: SupabaseClient): Promise<SupabaseClient> {
    if (admin) return admin;
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    return supabaseAdmin;
}

// ── the setting ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LearningSetting { mode: 'off' | 'shadow' | 'live'; meaning: boolean; /** Draft sorting rules every day (sortRulesStore.ts). */ rulesDaily?: boolean }
export const LEARNING_OFF: LearningSetting = { mode: 'off', meaning: false };
const settingCache = new Map<string, { at: number; value: LearningSetting }>();
const SETTING_MS = 60_000;
const SETTING_READ_MS = 1_500;

/** The organisation's choice in Brain → Switches. Anything unreadable means off (fail closed: today's behaviour). */
export async function learningSetting(orgId: string | null | undefined, admin?: SupabaseClient): Promise<LearningSetting> {
    if (!orgId) return LEARNING_OFF;
    const hit = settingCache.get(orgId);
    if (hit && Date.now() - hit.at < SETTING_MS) return hit.value;
    let value = LEARNING_OFF;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const read = (async () => {
            const { loadBrainSettings } = await import('@/backend/lib/aiLayer/brain/server');
            const { settings } = await loadBrainSettings(await adminOf(admin), orgId);
            return { mode: settings.ticketLearning.mode, meaning: settings.ticketLearning.meaning, rulesDaily: settings.ticketLearning.rulesDaily } as LearningSetting;
        })();
        // A person is waiting for their ticket: a slow read means "off" this time, never a slower ticket.
        value = await Promise.race([read, new Promise<LearningSetting>((_, no) => { timer = setTimeout(() => no(new Error('timed out')), SETTING_READ_MS); })]);
    } catch (err) {
        console.warn('[TicketLearning] setting unreadable, learning off:', err instanceof Error ? err.message : err);
    } finally { if (timer) clearTimeout(timer); }
    settingCache.set(orgId, { at: Date.now(), value });
    return value;
}

// ── the examples ────────────────────────────────────────────────────────────────────────────────────────────────────

/** At most this many examples per organisation are compared by words (the newest). */
const MAX_EXAMPLES = 3000;
const EXAMPLE_MS = 60_000;
const exampleCache = new Map<string, { at: number; list: Example[]; missing: boolean }>();

export const exampleOf = (r: Row): Example => ({
    id: String(r.id), ticketId: str(r.ticket_id), propertyId: str(r.property_id), text: String(r.ticket_text ?? ''),
    code: String(r.code), team: asTeam(r.team), source: (['judged_right', 'judged_wrong', 'override'].includes(String(r.source)) ? r.source : 'judged_wrong') as ExampleSource,
    at: String(r.created_at ?? ''),
});

/** The organisation's examples in use (not retired), newest first, kept for a minute. */
export async function loadExamples(orgId: string, admin?: SupabaseClient, opts: { fresh?: boolean } = {}): Promise<{ list: Example[]; missing: boolean }> {
    const hit = exampleCache.get(orgId);
    if (!opts.fresh && hit && Date.now() - hit.at < EXAMPLE_MS) return hit;
    let out = { list: [] as Example[], missing: false };
    try {
        const db = await adminOf(admin);
        const { data, error } = await db.from('ticket_sort_examples')
            .select('id, ticket_id, property_id, ticket_text, code, team, source, created_at')
            .eq('organization_id', orgId).is('retired_at', null)
            .order('created_at', { ascending: false }).limit(MAX_EXAMPLES);
        if (error) { if (!isMissing(error)) console.warn('[TicketLearning] examples unreadable:', error.message); out = { list: [], missing: isMissing(error) }; }
        else out = { list: ((data ?? []) as Row[]).filter(r => str(r.code)).map(exampleOf), missing: false };
    } catch (err) {
        console.warn('[TicketLearning] examples unreadable:', err instanceof Error ? err.message : err);
    }
    const entry = { at: Date.now(), ...out };
    exampleCache.set(orgId, entry);
    return entry;
}

export function forgetExamples(orgId: string): void { exampleCache.delete(orgId); calibrationCache.delete(orgId); }

/** How long finding similar tickets by meaning may take while a person waits for their ticket. */
const MEANING_MS = 1_500;

/** Similar examples by meaning (embedding). Any failure or slowness gives none: the word match still runs. */
export async function meaningNeighbours(orgId: string, text: string, examples: readonly Example[], allowed: ReadonlySet<string>, admin?: SupabaseClient): Promise<Neighbour[]> {
    const byId = new Map(examples.map(e => [e.id, e]));
    const work = (async () => {
        const [{ embedQuery }, { EMBEDDING_MODEL }] = await Promise.all([import('@/backend/lib/candidates/embeddings'), import('@/backend/lib/candidates/config')]);
        const vector = await embedQuery(text.slice(0, 2000));
        const db = await adminOf(admin);
        const { data, error } = await db.rpc('match_ticket_sort_examples', { p_organization_id: orgId, p_query_embedding: vector, p_embedding_model: EMBEDDING_MODEL, p_match_count: 8 });
        if (error) throw new Error(error.message);
        return ((data ?? []) as Row[]).flatMap(r => {
            const e = byId.get(String(r.id));
            const strength = meaningStrength(Number(r.similarity));
            return e && allowed.has(e.code) && strength > 0 ? [{ example: e, strength, by: 'meaning' as const }] : [];
        });
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Neighbour[]>(ok => { timer = setTimeout(() => ok([]), MEANING_MS); });
    try {
        return await Promise.race([work, late]);
    } catch (err) {
        console.warn('[TicketLearning] meaning search unavailable, words only:', err instanceof Error ? err.message.slice(0, 200) : err);
        return [];
    } finally { if (timer) clearTimeout(timer); }
}

export interface NewExample { orgId: string; propertyId: string | null; ticketId: string | null; text: string; code: string; team: SkillGroup | null; source: ExampleSource }

/**
 * Saves (or replaces) the example for a ticket. With meaning search on, its embedding is added too; if that fails the
 * example is still found by words. Never throws.
 */
export async function saveExample(x: NewExample, opts: { admin?: SupabaseClient; meaning?: boolean } = {}): Promise<void> {
    if (!x.text.trim() || !x.code) return;
    try {
        const db = await adminOf(opts.admin);
        const row = { organization_id: x.orgId, property_id: x.propertyId, ticket_id: x.ticketId, ticket_text: x.text, code: x.code, team: x.team, source: x.source, retired_at: null, retired_reason: null, embedding: null, embedding_model: null, updated_at: new Date().toISOString() };
        const saved = x.ticketId
            ? await db.from('ticket_sort_examples').upsert(row, { onConflict: 'ticket_id' }).select('id').single()
            : await db.from('ticket_sort_examples').insert(row).select('id').single();
        if (saved.error) { if (!isMissing(saved.error)) console.warn('[TicketLearning] example not saved:', saved.error.message); return; }
        forgetExamples(x.orgId);
        if (opts.meaning) await embedExample(db, String((saved.data as Row).id), x.text);
    } catch (err) {
        console.warn('[TicketLearning] example not saved:', err instanceof Error ? err.message : err);
    }
}

/** Adds the embedding to one saved example. Never throws. */
export async function embedExample(db: SupabaseClient, id: string, text: string): Promise<boolean> {
    try {
        const [{ embedDocuments }, { EMBEDDING_MODEL }] = await Promise.all([import('@/backend/lib/candidates/embeddings'), import('@/backend/lib/candidates/config')]);
        const [vector] = await embedDocuments([text.slice(0, 2000)]);
        const { error } = await db.from('ticket_sort_examples').update({ embedding: vector, embedding_model: EMBEDDING_MODEL }).eq('id', id);
        if (error) throw new Error(error.message);
        return true;
    } catch (err) {
        console.warn('[TicketLearning] example kept for word matching only (no embedding):', err instanceof Error ? err.message.slice(0, 200) : err);
        return false;
    }
}

/** Removes the example a judgement made (the judgement was undone). An Override example stays. Never throws. */
export async function removeExample(db: SupabaseClient, orgId: string, ticketId: string): Promise<void> {
    const { error } = await db.from('ticket_sort_examples').delete().eq('organization_id', orgId).eq('ticket_id', ticketId).in('source', ['judged_right', 'judged_wrong']);
    if (error && !isMissing(error)) console.warn('[TicketLearning] example not removed:', error.message);
    forgetExamples(orgId);
}

/** Stops using examples (a person settled a disagreement). Only this organisation's. Returns how many were retired. */
export async function retireExamples(db: SupabaseClient, orgId: string, ids: readonly string[], reason: string): Promise<number> {
    if (!ids.length) return 0;
    const { data, error } = await db.from('ticket_sort_examples').update({ retired_at: new Date().toISOString(), retired_reason: reason.slice(0, 200) })
        .eq('organization_id', orgId).in('id', [...ids]).select('id');
    if (error) throw new Error(error.message);
    forgetExamples(orgId);
    return (data ?? []).length;
}

// ── the track record (Phase 2) ──────────────────────────────────────────────────────────────────────────────────────

/** A ticket nobody re-sorted or judged within this many days counts as sorted right (as the accuracy figure does). */
export const ASSUMED_RIGHT_DAYS = 7;
const CAL_DAYS = 180;
const CAL_MS = 10 * 60_000;
const CAL_READ = 2000;
const IN_CHUNK = 100;
const calibrationCache = new Map<string, { at: number; table: CalibrationTable; tickets: number }>();

export interface CalibrationInputs {
    reviews: Row[];
    traces: Row[];
    /** id → { issue_code, classification_source, created_at } for the traced tickets */
    tickets: Map<string, Row>;
    now: number;
}

/**
 * The AI's past ratings and whether each was right. A ticket's right category is known when it was judged (the
 * judgement says), re-sorted by hand (its category now), or left alone for ASSUMED_RIGHT_DAYS (its category now).
 * With a trace, the rating is the one the AI gave in the new way and is compared with what the new way chose;
 * without, it is the judged sorting's own rating (before learning, the saved confidence WAS the AI's rating).
 */
export function trackRecord(x: CalibrationInputs): Array<{ confidence: number; right: boolean }> {
    const out: Array<{ confidence: number; right: boolean }> = [];
    const reviewOf = new Map(x.reviews.map(r => [String(r.ticket_id), r]));
    const traced = new Set<string>();
    for (const t of x.traces) {
        const id = String(t.ticket_id);
        traced.add(id);
        if (typeof t.model_confidence !== 'number' || t.method !== 'ai') continue;
        const rv = reviewOf.get(id);
        const ticket = x.tickets.get(id);
        let truth: string | null | undefined;
        if (rv) truth = rv.verdict === 'wrong' ? str(rv.right_code) : str(rv.chosen_code);
        else if (ticket && (ticket.classification_source === 'manual' || x.now - Date.parse(String(ticket.created_at)) > ASSUMED_RIGHT_DAYS * DAY_MS)) truth = str(ticket.issue_code);
        if (truth === undefined) continue;
        out.push({ confidence: t.model_confidence as number, right: (str(t.new_code) ?? null) === (truth ?? null) });
    }
    for (const r of x.reviews) {
        if (traced.has(String(r.ticket_id)) || r.sorted_by !== 'ai' || typeof r.chosen_confidence !== 'number') continue;
        out.push({ confidence: r.chosen_confidence as number, right: r.verdict === 'right' });
    }
    return out;
}

/** The organisation's calibration table, kept for ten minutes. Empty bands when nothing is known yet. */
export async function loadCalibration(orgId: string, admin?: SupabaseClient, now = Date.now()): Promise<CalibrationTable> {
    const hit = calibrationCache.get(orgId);
    if (hit && now - hit.at < CAL_MS) return hit.table;
    let table = calibrationFrom([]);
    let tickets = 0;
    try {
        const db = await adminOf(admin);
        const since = new Date(now - CAL_DAYS * DAY_MS).toISOString();
        const [rv, tr] = await Promise.all([
            db.from('ticket_sort_reviews').select('ticket_id, sorted_by, chosen_code, chosen_confidence, verdict, right_code').eq('organization_id', orgId).gte('created_at', since).limit(CAL_READ),
            db.from('ticket_sort_traces').select('ticket_id, method, new_code, model_confidence').eq('organization_id', orgId).gte('created_at', since).order('created_at', { ascending: false }).limit(CAL_READ),
        ]);
        const reviews = rv.error ? [] : (rv.data ?? []) as Row[];
        const traces = tr.error ? [] : (tr.data ?? []) as Row[];
        const ids = traces.map(t => String(t.ticket_id));
        const ticketMap = new Map<string, Row>();
        for (let i = 0; i < ids.length; i += IN_CHUNK) {
            const r = await db.from('tickets').select('id, issue_code, classification_source, created_at').eq('organization_id', orgId).in('id', ids.slice(i, i + IN_CHUNK));
            for (const t of (r.data ?? []) as Row[]) ticketMap.set(String(t.id), t);
        }
        const record = trackRecord({ reviews, traces, tickets: ticketMap, now });
        table = calibrationFrom(record);
        tickets = record.length;
    } catch (err) {
        console.warn('[TicketLearning] track record unreadable, the AI\'s own rating is used:', err instanceof Error ? err.message : err);
    }
    calibrationCache.set(orgId, { at: now, table, tickets });
    return table;
}

// ── traces ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What is recorded with a new ticket while learning is watch-only or on. */
export interface LearningTrace {
    organizationId: string;
    mode: 'shadow' | 'live';
    method: 'ai' | 'shortcut' | 'failed';
    search: 'words' | 'meaning' | 'none';
    oldCode: string | null;
    oldConfidence: number | null;
    newCode: string | null;
    modelConfidence: number | null;
    newConfidence: number | null;
    why: string | null;
    neighbours: NeighbourNote[];
    model: string | null;
    latencyMs: number | null;
}

/** Saves the trace of a new ticket. Never throws. */
export async function writeTrace(ticketId: string, t: LearningTrace, admin?: SupabaseClient): Promise<void> {
    try {
        const db = await adminOf(admin);
        const { error } = await db.from('ticket_sort_traces').insert({
            ticket_id: ticketId, organization_id: t.organizationId, mode: t.mode, method: t.method, search: t.search,
            old_code: t.oldCode, old_confidence: t.oldConfidence, new_code: t.newCode, model_confidence: t.modelConfidence,
            new_confidence: t.newConfidence, why: t.why, neighbours: t.neighbours, model: t.model, latency_ms: t.latencyMs,
        });
        if (error && !isMissing(error)) console.warn('[TicketLearning] trace not saved:', error.message);
    } catch (err) {
        console.warn('[TicketLearning] trace not saved:', err instanceof Error ? err.message : err);
    }
}
