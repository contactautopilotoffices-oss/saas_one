/**
 * Brain → Review → Tickets: what the learning shows (owner 2026-11-19). Server only, one organisation per call.
 *
 *   per ticket in the queue   the similar past tickets used and why the confidence is what it is (its trace)
 *   watch only                the old way and the new way side by side on tickets whose right answer is known
 *   week by week              tickets, re-sorted by a person, sent to Review, and how honest the confidence was
 *   disagreements             near-identical examples with different categories: a person keeps one
 *
 * Every part is optional: a missing table (migration 20261119000001 not applied) gives empty parts, never an error.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { CONFIDENCE_HIGH } from './confidenceWord';
import { exampleConflicts, type NeighbourNote } from './sortLearning';
import { ASSUMED_RIGHT_DAYS, isMissing, loadExamples, type LearningSetting } from './sortLearningStore';

type Row = Record<string, unknown>;
const DAY_MS = 86_400_000;
const IN_CHUNK = 100;
const WEEKS = 8;
const TREND_READ = 5000;
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** One ticket's learning record, as the Review screen shows it. */
export interface TicketLearningNote {
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
}

export interface WatchComparison {
    /** Tickets recorded in watch-only mode whose right category is known. */
    known: number;
    oldRight: number;
    newRight: number;
    /** The two ways chose differently. */
    differed: number;
    /** Below High, so sent to Review. */
    oldToReview: number;
    newToReview: number;
    /** Wrong although rated High: nobody would have checked it. */
    oldWrongButHigh: number;
    newWrongButHigh: number;
    /** Sorted by the repeat shortcut, without the AI. */
    shortcuts: number;
}

export interface WeekRow {
    from: string;
    tickets: number;
    resorted: number;
    toReview: number;
    judgedRight: number;
    judgedWrong: number;
    /** Judged AI sortings of the week: the average confidence given, and how many were really right (percent). */
    saidAvg: number | null;
    actuallyRight: number | null;
}

export interface ConflictView { strength: number; a: { id: string; text: string; code: string; source: string; at: string }; b: { id: string; text: string; code: string; source: string; at: string } }

export interface LearningView {
    setting: LearningSetting;
    /** Migration 20261119000001 is not applied: examples, traces and the comparison are not available. */
    tableMissing: boolean;
    examples: number;
    notes: Record<string, TicketLearningNote>;
    watch: WatchComparison | null;
    weeks: WeekRow[];
    conflicts: ConflictView[];
}

export function noteFromTrace(t: Row): TicketLearningNote {
    const nb = Array.isArray(t.neighbours) ? (t.neighbours as Row[]) : [];
    return {
        mode: t.mode === 'live' ? 'live' : 'shadow',
        method: t.method === 'shortcut' ? 'shortcut' : t.method === 'failed' ? 'failed' : 'ai',
        search: t.search === 'meaning' ? 'meaning' : t.search === 'none' ? 'none' : 'words',
        oldCode: str(t.old_code), oldConfidence: num(t.old_confidence), newCode: str(t.new_code),
        modelConfidence: num(t.model_confidence), newConfidence: num(t.new_confidence), why: str(t.why),
        neighbours: nb.slice(0, 8).map(n => ({ id: String(n.id ?? ''), text: String(n.text ?? ''), code: String(n.code ?? ''), source: (n.source as NeighbourNote['source']) ?? 'judged_wrong', strength: Number(n.strength ?? 0), by: n.by === 'meaning' ? 'meaning' : 'words' })),
    };
}

/** Monday of the week, as YYYY-MM-DD. */
export function weekOf(iso: string): string {
    const d = new Date(iso);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
}

/** The week-by-week rows, from the tickets and judgements of the last WEEKS weeks (pure). */
export function weekRows(tickets: readonly Row[], reviews: readonly Row[], now: Date): WeekRow[] {
    const weeks: WeekRow[] = [];
    const first = new Date(weekOf(now.toISOString()));
    for (let i = WEEKS - 1; i >= 0; i--) {
        const d = new Date(first.getTime() - i * 7 * DAY_MS).toISOString().slice(0, 10);
        weeks.push({ from: d, tickets: 0, resorted: 0, toReview: 0, judgedRight: 0, judgedWrong: 0, saidAvg: null, actuallyRight: null });
    }
    const at = new Map(weeks.map(w => [w.from, w]));
    for (const t of tickets) {
        const w = at.get(weekOf(String(t.created_at)));
        if (!w) continue;
        w.tickets++;
        if (t.classification_source === 'manual') w.resorted++;
        if (t.classification_source === 'rule' || (t.classification_source === 'llm' && typeof t.confidence_score === 'number' && t.confidence_score < CONFIDENCE_HIGH)) w.toReview++;
    }
    const judged = new Map<string, Array<{ c: number; ok: boolean }>>();
    for (const r of reviews) {
        const w = at.get(weekOf(String(r.created_at)));
        if (!w) continue;
        if (r.verdict === 'wrong') w.judgedWrong++; else w.judgedRight++;
        if (r.sorted_by === 'ai' && typeof r.chosen_confidence === 'number') judged.set(w.from, [...(judged.get(w.from) ?? []), { c: r.chosen_confidence, ok: r.verdict === 'right' }]);
    }
    for (const w of weeks) {
        const j = judged.get(w.from) ?? [];
        if (!j.length) continue;
        w.saidAvg = Math.round(j.reduce((s, x) => s + x.c, 0) / j.length);
        w.actuallyRight = Math.round((100 * j.filter(x => x.ok).length) / j.length);
    }
    return weeks;
}

/** The old and the new way side by side, on watch-only tickets whose right category is known (pure). */
export function watchComparison(traces: readonly Row[], reviews: readonly Row[], tickets: ReadonlyMap<string, Row>, now: number): WatchComparison | null {
    const shadow = traces.filter(t => t.mode === 'shadow' && t.method !== 'failed');
    if (!shadow.length) return null;
    const reviewOf = new Map(reviews.map(r => [String(r.ticket_id), r]));
    const c: WatchComparison = { known: 0, oldRight: 0, newRight: 0, differed: 0, oldToReview: 0, newToReview: 0, oldWrongButHigh: 0, newWrongButHigh: 0, shortcuts: 0 };
    for (const t of shadow) {
        const id = String(t.ticket_id);
        const rv = reviewOf.get(id);
        const ticket = tickets.get(id);
        let truth: string | null | undefined;
        if (rv) truth = rv.verdict === 'wrong' ? str(rv.right_code) : str(rv.chosen_code);
        else if (ticket && (ticket.classification_source === 'manual' || now - Date.parse(String(ticket.created_at)) > ASSUMED_RIGHT_DAYS * DAY_MS)) truth = str(ticket.issue_code);
        if (t.method === 'shortcut') c.shortcuts++;
        if (str(t.old_code) !== str(t.new_code)) c.differed++;
        const oc = num(t.old_confidence), nc = num(t.new_confidence);
        if (oc !== null && oc < CONFIDENCE_HIGH) c.oldToReview++;
        if (nc !== null && nc < CONFIDENCE_HIGH) c.newToReview++;
        if (truth === undefined) continue;
        c.known++;
        const oldOk = str(t.old_code) === (truth ?? null), newOk = str(t.new_code) === (truth ?? null);
        if (oldOk) c.oldRight++;
        if (newOk) c.newRight++;
        if (!oldOk && oc !== null && oc >= CONFIDENCE_HIGH) c.oldWrongButHigh++;
        if (!newOk && nc !== null && nc >= CONFIDENCE_HIGH) c.newWrongButHigh++;
    }
    return c;
}

export async function learningView(admin: SupabaseClient, orgId: string, setting: LearningSetting, queueIds: readonly string[], now = new Date()): Promise<LearningView> {
    const view: LearningView = { setting, tableMissing: false, examples: 0, notes: {}, watch: null, weeks: [], conflicts: [] };
    const since = new Date(now.getTime() - WEEKS * 7 * DAY_MS).toISOString();

    // Week by week: needs only tables that exist today.
    const [tk, rv] = await Promise.all([
        admin.from('tickets').select('id, created_at, classification_source, confidence_score').eq('organization_id', orgId).gte('created_at', since).limit(TREND_READ),
        admin.from('ticket_sort_reviews').select('ticket_id, created_at, sorted_by, chosen_code, chosen_confidence, verdict, right_code').eq('organization_id', orgId).gte('created_at', since).limit(TREND_READ),
    ]);
    const reviews = rv.error ? [] : (rv.data ?? []) as Row[];
    if (!tk.error) view.weeks = weekRows((tk.data ?? []) as Row[], reviews, now);

    // Examples and disagreements
    const ex = await loadExamples(orgId, admin, { fresh: true });
    if (ex.missing) { view.tableMissing = true; return view; }
    view.examples = ex.list.length;
    view.conflicts = exampleConflicts(ex.list.slice(0, 1500)).map(c => ({
        strength: c.strength,
        a: { id: c.a.id, text: c.a.text.slice(0, 300), code: c.a.code, source: c.a.source, at: c.a.at },
        b: { id: c.b.id, text: c.b.text.slice(0, 300), code: c.b.code, source: c.b.source, at: c.b.at },
    }));

    // The queue's traces
    for (let i = 0; i < queueIds.length; i += IN_CHUNK) {
        const r = await admin.from('ticket_sort_traces').select('ticket_id, mode, method, search, old_code, old_confidence, new_code, model_confidence, new_confidence, why, neighbours').eq('organization_id', orgId).in('ticket_id', queueIds.slice(i, i + IN_CHUNK));
        if (r.error) { if (isMissing(r.error)) view.tableMissing = true; else throw new Error(r.error.message); break; }
        for (const t of (r.data ?? []) as Row[]) view.notes[String(t.ticket_id)] = noteFromTrace(t);
    }

    // Watch only: the last 30 days of traces
    const tr = await admin.from('ticket_sort_traces').select('ticket_id, mode, method, old_code, old_confidence, new_code, new_confidence').eq('organization_id', orgId).gte('created_at', new Date(now.getTime() - 30 * DAY_MS).toISOString()).limit(TREND_READ);
    if (!tr.error) {
        const traces = (tr.data ?? []) as Row[];
        const ids = traces.filter(t => t.mode === 'shadow').map(t => String(t.ticket_id));
        const tickets = new Map<string, Row>();
        for (let i = 0; i < ids.length; i += IN_CHUNK) {
            const r = await admin.from('tickets').select('id, issue_code, classification_source, created_at').eq('organization_id', orgId).in('id', ids.slice(i, i + IN_CHUNK));
            for (const t of (r.data ?? []) as Row[]) tickets.set(String(t.id), t);
        }
        const allReviews = ids.length ? await reviewsFor(admin, orgId, ids) : [];
        view.watch = watchComparison(traces, allReviews, tickets, now.getTime());
    }
    return view;
}

async function reviewsFor(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Row[]> {
    const out: Row[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const r = await admin.from('ticket_sort_reviews').select('ticket_id, verdict, chosen_code, right_code').eq('organization_id', orgId).in('ticket_id', ids.slice(i, i + IN_CHUNK));
        if (!r.error) out.push(...((r.data ?? []) as Row[]));
    }
    return out;
}
