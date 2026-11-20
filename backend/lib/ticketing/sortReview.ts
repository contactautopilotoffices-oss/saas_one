/**
 * Brain → Review → Tickets (owner 2026-11-15): the Tech team checks how tickets were sorted.
 *
 * In the queue: tickets of the last 30 days that the AI sorted with less than High confidence (below 85%), and tickets
 * the keyword rules sorted because every model failed. Each is judged once:
 *   right  → recorded.
 *   wrong  → the right category is recorded and becomes a past correction the AI is shown for the organisation's next
 *            tickets (aiClassifier.ts loadCorrections), and, while the ticket is still open (open, assigned or waitlist),
 *            the ticket itself moves to that category and team and is assigned again within the new team (owner: "yes
 *            to both"). A ticket already being worked on, waiting for validation or closed is not moved; that is said.
 * The accuracy shown: of the tickets created in the last 30 days, the share nobody had to re-sort (judged wrong here,
 * or changed with the Override button on the ticket). Tickets nobody looked at count as right.
 *
 * 2026-11-19 (owner: "with corrections, it must improve the classification accuracy and confidence"): every judgement,
 * right ones too, is saved as a learning example (sortLearningStore.saveExample) that similar new tickets are shown;
 * a judgement can be undone for UNDO_DAYS days (the example goes, and a ticket it moved goes back); near-identical
 * examples that disagree are listed and a person keeps one. The screen also shows each ticket's similar tickets and
 * why its confidence is what it is (sortLearningView.ts).
 *
 * Server only, and only after the Tech-team check in the route (consoleGuard). Every query is limited to the
 * organisation in code (service-role client). Privacy (owner): the ticket's words are shown with phone numbers, emails
 * and ids masked, and nothing says who raised the ticket.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { maskIdentity } from '@/backend/lib/aiLayer/brain/console/view';
import { CONFIDENCE_HIGH, categoryOptionsFrom, confidenceWord, forgetCorrections, type CategoryOption } from './aiClassifier';
import type { SkillGroup } from './classifyTicket';
import { learningSetting, removeExample, retireExamples, saveExample } from './sortLearningStore';
import { learningView, type LearningView, type TicketLearningNote } from './sortLearningView';
import { rulesView, type RulesView } from './sortRulesStore';
import { photoDescriptionFor, photoView, type PhotoNote, type PhotoView } from './ticketPhoto';

export const REVIEW_DAYS = 30;
/** At most this many tickets are looked at for the queue, and this many are sent to the screen. */
const QUEUE_READ = 300;
const QUEUE_SHOWN = 100;
const IN_CHUNK = 100;
const DAY_MS = 86_400_000;
/** A ticket in one of these states may still be moved to another team. */
export const MOVABLE_STATUSES: readonly string[] = ['open', 'assigned', 'waitlist'];
/** A judgement can be undone for this many days. */
export const UNDO_DAYS = 7;

const MISSING = new Set(['42P01', 'PGRST205', '42703', 'PGRST204']);
const isMissing = (e: { code?: string } | null | undefined) => !!e && MISSING.has(String(e.code ?? ''));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CategoryChoice { code: string; name: string; team: SkillGroup | null }

export interface TicketReviewItem {
    id: string;
    number: string | null;
    at: string;
    status: string;
    property: string | null;
    /** The ticket's words, masked. Never who raised it. */
    text: string;
    sortedBy: 'ai' | 'rules';
    categoryCode: string | null;
    categoryName: string | null;
    team: string | null;
    priority: string | null;
    /** The AI's own rating, 0–100, and its word; null when the keyword rules sorted it. */
    confidence: number | null;
    confidenceWord: 'High' | 'Medium' | 'Low' | null;
    reason: string | null;
    risk: string | null;
    /** Marking it wrong also moves the ticket (it is still open). */
    canMove: boolean;
    /** Key into TicketReviewView.choices: the categories this ticket's property can use. */
    choicesKey: string;
    /** 2026-11-19: the similar tickets used and why the confidence is what it is; null without a trace. */
    learning: TicketLearningNote | null;
    /** 2026-11-19: the ticket's photo (its address in the app) and what the AI read in it; null without a photo. */
    photoUrl: string | null;
    photo: PhotoNote | null;
}

export interface TicketJudgement { ticketId: string | null; at: string; text: string; verdict: 'right' | 'wrong'; chosen: string | null; right: string | null; moved: boolean; canUndo: boolean }

export interface TicketReviewView {
    /** The table is not applied yet (migration 20261115000003): the queue can be read but not judged. */
    tableMissing: boolean;
    queue: TicketReviewItem[];
    /** How many are waiting (counted among the newest QUEUE_READ tickets of the window). */
    waiting: number;
    choices: Record<string, CategoryChoice[]>;
    accuracy: {
        days: number;
        sorted: number;
        byAi: number;
        byRules: number;
        /** Re-sorted by a person: judged wrong here, or changed with the Override button. */
        resorted: number;
        /** (sorted − resorted) / sorted, rounded; null when no tickets. */
        percent: number | null;
        judgedRight: number;
        judgedWrong: number;
    };
    recent: TicketJudgement[];
    /** 2026-11-19: the learning (examples, watch-only comparison, weeks, disagreements); null when unreadable. */
    learning: LearningView | null;
    /** 2026-11-19: the sorting rules (in use, waiting for approval, runs, history); null when unreadable. */
    rules: RulesView | null;
    /** 2026-11-19: photo reading (the setting, the photo against the words); null when unreadable. */
    photos: PhotoView | null;
}

type Row = Record<string, unknown>;
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);

/**
 * Hides an @-mention of a person: "@Anil", "@anil", "@Anil Jena", "@Anil Kumar Jena", "@ANIL JENA" (owner: privacy).
 * The words after the mention are taken as part of the name only when they look like a name (Capitalised, or all
 * capitals of four letters or more), so "@Ravi AC leaking" keeps "AC leaking". A name written without "@" cannot be
 * told apart from other words and is not hidden.
 */
export function hideMentions(text: string): string {
    return text.replace(/@[^\s@]+(?:\s+(?:[A-Z][a-z]+|[A-Z]{4,})){0,2}/g, '@[person]');
}

/** The ticket's words, with @-mentions of people hidden. */
export function ticketText(t: Row): string {
    const parts = [t.title, t.description].map(s => String(s ?? '').trim()).filter(Boolean);
    return hideMentions(parts.filter((s, i) => parts.indexOf(s) === i).join('\n'));
}

async function categoryRows(admin: SupabaseClient): Promise<Row[]> {
    const { data, error } = await admin.from('issue_categories').select('id, code, name, priority, is_active, property_id, skill_group_id, skill_group:skill_groups(code)');
    if (error) throw new Error(`category list: ${error.message}`);
    return (data ?? []) as Row[];
}

const choicesFrom = (opts: CategoryOption[]): CategoryChoice[] => opts.map(o => ({ code: o.code, name: o.name, team: o.team })).sort((a, b) => a.name.localeCompare(b.name));

async function count(q: PromiseLike<{ count: number | null; error: { code?: string; message: string } | null }>): Promise<number> {
    const { count: n, error } = await q;
    if (error) throw new Error(error.message);
    return n ?? 0;
}

// ── the view ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function ticketReviewView(admin: SupabaseClient, orgId: string, now = new Date()): Promise<TicketReviewView> {
    const since = new Date(now.getTime() - REVIEW_DAYS * DAY_MS).toISOString();

    const read = await admin.from('tickets')
        .select('id, ticket_number, title, description, created_at, status, priority, confidence_score, classification_source, llm_reasoning, risk_flag, property_id, issue_code, skill_group_code, photo_before_url, category:issue_categories(code, name), skill_group:skill_groups(code, name), property:properties(name)')
        .eq('organization_id', orgId)
        .gte('created_at', since)
        .or(`classification_source.eq.rule,and(classification_source.eq.llm,confidence_score.lt.${CONFIDENCE_HIGH})`)
        .order('created_at', { ascending: false })
        .limit(QUEUE_READ);
    if (read.error) throw new Error(`tickets: ${read.error.message}`);
    const tickets = (read.data ?? []) as Row[];

    // Leave out the tickets already judged.
    let tableMissing = false;
    const judged = new Set<string>();
    const ids = tickets.map(t => String(t.id));
    for (let i = 0; i < ids.length && !tableMissing; i += IN_CHUNK) {
        const r = await admin.from('ticket_sort_reviews').select('ticket_id').eq('organization_id', orgId).in('ticket_id', ids.slice(i, i + IN_CHUNK));
        if (r.error) { if (isMissing(r.error)) tableMissing = true; else throw new Error(r.error.message); }
        for (const x of (r.data ?? []) as Row[]) if (x.ticket_id) judged.add(String(x.ticket_id));
    }
    const waitingRows = tickets.filter(t => !judged.has(String(t.id)));

    const cats = await categoryRows(admin);
    const choices: Record<string, CategoryChoice[]> = {};
    const queue: TicketReviewItem[] = waitingRows.slice(0, QUEUE_SHOWN).map(t => {
        const key = str(t.property_id) ?? '*';
        if (!choices[key]) choices[key] = choicesFrom(categoryOptionsFrom(cats as never, key === '*' ? null : key));
        const byAi = t.classification_source === 'llm';
        const confidence = byAi && typeof t.confidence_score === 'number' ? t.confidence_score : null;
        const cat = one(t.category as Row | Row[] | null);
        const sg = one(t.skill_group as Row | Row[] | null);
        return {
            id: String(t.id),
            number: str(t.ticket_number),
            at: String(t.created_at),
            status: String(t.status ?? ''),
            property: str(one(t.property as Row | Row[] | null)?.name),
            text: maskIdentity(ticketText(t), 1000) ?? '',
            sortedBy: byAi ? 'ai' : 'rules',
            categoryCode: str(cat?.code) ?? str(t.issue_code),
            categoryName: str(cat?.name),
            team: str(sg?.code) ?? str(t.skill_group_code),
            priority: str(t.priority),
            confidence,
            confidenceWord: confidence === null ? null : confidenceWord(confidence),
            reason: byAi ? maskIdentity(hideMentions(String(t.llm_reasoning ?? '')), 300) || null : null,
            risk: str(t.risk_flag),
            canMove: MOVABLE_STATUSES.includes(String(t.status ?? '')),
            choicesKey: key,
            learning: null,
            photoUrl: str(t.photo_before_url),
            photo: null,
        };
    });

    const base = () => admin.from('tickets').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', since);
    const [sorted, byAi, byRules, resorted] = await Promise.all([
        count(base()),
        count(base().eq('classification_source', 'llm')),
        count(base().eq('classification_source', 'rule')),
        count(base().eq('classification_source', 'manual')),
    ]);

    let judgedRight = 0, judgedWrong = 0;
    let recent: TicketJudgement[] = [];
    if (!tableMissing) {
        const rv = () => admin.from('ticket_sort_reviews').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', since);
        [judgedRight, judgedWrong] = await Promise.all([count(rv().eq('verdict', 'right')), count(rv().eq('verdict', 'wrong'))]);
        const last = await admin.from('ticket_sort_reviews').select('ticket_id, created_at, ticket_text, verdict, chosen_code, right_code, ticket_moved')
            .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(20);
        if (last.error) throw new Error(last.error.message);
        recent = ((last.data ?? []) as Row[]).map(r => ({
            ticketId: str(r.ticket_id), at: String(r.created_at), text: String(r.ticket_text ?? ''), verdict: r.verdict === 'wrong' ? 'wrong' : 'right',
            chosen: str(r.chosen_code), right: str(r.right_code), moved: r.ticket_moved === true,
            canUndo: !!str(r.ticket_id) && now.getTime() - Date.parse(String(r.created_at)) < UNDO_DAYS * DAY_MS,
        }));
    }

    // The learning: never a reason for the screen to fail.
    let learning: LearningView | null = null;
    let rules: RulesView | null = null;
    const setting = await learningSetting(orgId, admin);
    try {
        learning = await learningView(admin, orgId, setting, queue.map(q => q.id), now);
        for (const q of queue) q.learning = learning.notes[q.id] ?? null;
    } catch (err) {
        console.warn('[TicketReview] the learning part could not be read:', err instanceof Error ? err.message : err);
    }
    try { rules = await rulesView(admin, orgId, setting.rulesDaily !== false); } catch (err) {
        console.warn('[TicketReview] the sorting rules could not be read:', err instanceof Error ? err.message : err);
    }
    let photos: PhotoView | null = null;
    try {
        photos = await photoView(admin, orgId, setting.photos ?? 'off', queue.map(q => q.id), now);
        for (const q of queue) q.photo = photos.notes[q.id] ?? null;
    } catch (err) {
        console.warn('[TicketReview] the photo readings could not be read:', err instanceof Error ? err.message : err);
    }

    return {
        tableMissing,
        queue,
        waiting: waitingRows.length,
        choices,
        accuracy: { days: REVIEW_DAYS, sorted, byAi, byRules, resorted, percent: sorted ? Math.round((100 * (sorted - resorted)) / sorted) : null, judgedRight, judgedWrong },
        recent,
        learning,
        rules,
        photos,
    };
}

// ── judging one ticket ──────────────────────────────────────────────────────────────────────────────────────────────

export type JudgeResult = { ok: true; message: string } | { ok: false; status: 400 | 404 | 503; error: string };

/**
 * Assigns a moved ticket again within its new team. Throws when it could not. Injected so tests never assign anyone.
 * The title and description go with it, so an @-mention still picks the mentioned person, as when the ticket was made.
 */
export type Reassign = (ticket: { id: string; property_id: string; skill_group_code: string | null; title?: string; description?: string }) => Promise<void>;

export async function judgeTicketSort(
    admin: SupabaseClient,
    orgId: string,
    reviewerId: string,
    body: { ticketId?: unknown; verdict?: unknown; code?: unknown },
    reassign: Reassign,
): Promise<JudgeResult> {
    const ticketId = typeof body.ticketId === 'string' && UUID.test(body.ticketId) ? body.ticketId : null;
    if (!ticketId) return { ok: false, status: 404, error: 'That ticket could not be found.' };
    if (body.verdict !== 'right' && body.verdict !== 'wrong') return { ok: false, status: 400, error: 'Say whether the sorting was right or wrong.' };
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (body.verdict === 'wrong' && !code) return { ok: false, status: 400, error: 'Choose the right category.' };

    const read = await admin.from('tickets')
        .select('id, organization_id, property_id, title, description, status, classification_source, confidence_score, category_id, issue_code, skill_group_code, category:issue_categories(code)')
        .eq('id', ticketId).eq('organization_id', orgId).maybeSingle();
    if (read.error) throw new Error(read.error.message);
    const t = read.data as Row | null;
    if (!t) return { ok: false, status: 404, error: 'That ticket could not be found.' };
    if (t.classification_source === 'manual') return { ok: false, status: 400, error: 'Someone has already changed this ticket\'s category by hand.' };

    const chosenCode = str(one(t.category as Row | Row[] | null)?.code) ?? str(t.issue_code);
    let right: { code: string; team: SkillGroup | null; categoryId: string | null; skillGroupId: string | null } | null = null;
    if (body.verdict === 'wrong') {
        const propertyId = str(t.property_id);
        const cats = await categoryRows(admin);
        const option = categoryOptionsFrom(cats as never, propertyId).find(o => o.code === code);
        if (!option) return { ok: false, status: 400, error: 'That category is not available for this ticket\'s property.' };
        if (option.code === chosenCode) return { ok: false, status: 400, error: 'That is the category it already has. Mark it right instead.' };
        const rows = cats.filter(c => c.code === code && c.is_active !== false);
        const row = rows.find(c => propertyId && c.property_id === propertyId) ?? rows.find(c => !c.property_id) ?? rows[0];
        right = { code, team: option.team, categoryId: str(row?.id), skillGroupId: str(row?.skill_group_id) };
    }

    const sortedBy = t.classification_source === 'rule' ? 'rules' : 'ai';
    const ins = await admin.from('ticket_sort_reviews').insert({
        organization_id: orgId,
        ticket_id: ticketId,
        ticket_text: maskIdentity(ticketText(t), 1000) ?? '',
        sorted_by: sortedBy,
        chosen_code: chosenCode,
        chosen_team: str(t.skill_group_code),
        chosen_confidence: sortedBy === 'ai' && typeof t.confidence_score === 'number' ? t.confidence_score : null,
        verdict: body.verdict,
        right_code: right?.code ?? null,
        right_team: right?.team ?? null,
        ticket_moved: false,
        reviewed_by: reviewerId,
    }).select('id').single();
    if (ins.error) {
        if (isMissing(ins.error)) return { ok: false, status: 503, error: 'Ticket review needs migration 20261115000003 to be applied.' };
        if (String(ins.error.code) === '23505') return { ok: false, status: 400, error: 'Someone has judged this ticket already.' };
        throw new Error(ins.error.message);
    }
    // 2026-11-19: the judgement becomes a learning example (right ones too). Never a reason for the judgement to fail.
    const setting = await learningSetting(orgId, admin);
    // 2026-11-19: what the AI read in the ticket's photo is kept with the example ("port" + a switch board photo).
    const photoNote = await photoDescriptionFor(admin, ticketId);
    const text = `${maskIdentity(ticketText(t), 1000) ?? ''}${photoNote ? ` (photo: ${photoNote})` : ''}`;
    const learnCode = right?.code ?? chosenCode;
    if (learnCode) {
        await saveExample({ orgId, propertyId: str(t.property_id), ticketId, text, code: learnCode, team: right ? right.team : asTeam(t.skill_group_code), source: right ? 'judged_wrong' : 'judged_right' }, { admin, meaning: setting.meaning });
    }
    if (!right) return { ok: true, message: 'Marked right.' };
    forgetCorrections(orgId);

    if (!MOVABLE_STATUSES.includes(String(t.status ?? ''))) {
        return { ok: true, message: 'Marked wrong. The AI learns from it. The ticket was not moved because it is no longer open.' };
    }

    // Move the ticket to the right category and team, then assign it again within that team.
    let skillGroupId = right.skillGroupId;
    if (!skillGroupId && right.team) {
        const sg = await admin.from('skill_groups').select('id').eq('code', right.team).limit(1).maybeSingle();
        skillGroupId = str((sg.data as Row | null)?.id);
    }
    // Only while it is still open at this moment: a ticket someone started or closed since it was read is left alone.
    const moved = await admin.from('tickets').update({
        category_id: right.categoryId,
        skill_group_id: skillGroupId,
        issue_code: right.code,
        skill_group_code: right.team,
        classification_source: 'manual',
        is_vague: false,
        updated_at: new Date().toISOString(),
    }).eq('id', ticketId).eq('organization_id', orgId).in('status', [...MOVABLE_STATUSES]).select('id');
    if (moved.error) {
        // Nothing half-done: the judgement is taken back, so it can simply be made again.
        console.error('[TicketReview] could not move the ticket:', moved.error.message);
        await admin.from('ticket_sort_reviews').delete().eq('ticket_id', ticketId).eq('organization_id', orgId);
        await removeExample(admin, orgId, ticketId);
        forgetCorrections(orgId);
        return { ok: false, status: 400, error: 'The ticket could not be moved, so nothing was saved. Try again.' };
    }
    if (!(moved.data ?? []).length) {
        return { ok: true, message: 'Marked wrong. The AI learns from it. The ticket was not moved because it is no longer open.' };
    }
    const flagged = await admin.from('ticket_sort_reviews').update({ ticket_moved: true }).eq('ticket_id', ticketId).eq('organization_id', orgId);
    if (flagged.error) console.warn('[TicketReview] could not note that the ticket moved:', flagged.error.message);
    const logged = await admin.from('ticket_activity_log').insert({ ticket_id: ticketId, user_id: reviewerId, action: 'classification_override', old_value: str(t.category_id), new_value: right.categoryId });
    if (logged.error) console.warn('[TicketReview] activity log not written:', logged.error.message);
    const propertyId = str(t.property_id);
    if (propertyId) {
        try { await reassign({ id: ticketId, property_id: propertyId, skill_group_code: right.team, title: String(t.title ?? ''), description: String(t.description ?? '') }); } catch (err) {
            console.error('[TicketReview] the moved ticket could not be assigned again:', err instanceof Error ? err.message : err);
            return { ok: true, message: 'Marked wrong and moved to the right team. It could not be assigned again automatically; assign it on the ticket.' };
        }
    }
    return { ok: true, message: 'Marked wrong. The ticket moved to the right team and the AI learns from it.' };
}

const asTeam = (x: unknown): SkillGroup | null => (['technical', 'plumbing', 'vendor', 'soft_services', 'it'].includes(String(x)) ? (x as SkillGroup) : null);

// ── undoing a judgement (2026-11-19) ────────────────────────────────────────────────────────────────────────────────

/**
 * Takes a judgement back, within UNDO_DAYS days: the judgement and its learning example are removed, so the ticket is
 * back in the queue. A ticket the judgement moved goes back to the category and team it had, and is assigned again
 * within that team, while it is still open; otherwise it stays where it is and the message says so.
 */
export async function undoTicketJudgement(admin: SupabaseClient, orgId: string, reviewerId: string, body: { ticketId?: unknown }, reassign: Reassign, now = new Date()): Promise<JudgeResult> {
    const ticketId = typeof body.ticketId === 'string' && UUID.test(body.ticketId) ? body.ticketId : null;
    if (!ticketId) return { ok: false, status: 404, error: 'That judgement could not be found.' };
    const rv = await admin.from('ticket_sort_reviews').select('ticket_id, created_at, verdict, sorted_by, chosen_code, chosen_team, ticket_moved')
        .eq('organization_id', orgId).eq('ticket_id', ticketId).maybeSingle();
    if (rv.error) { if (isMissing(rv.error)) return { ok: false, status: 503, error: 'Ticket review needs migration 20261115000003 to be applied.' }; throw new Error(rv.error.message); }
    const review = rv.data as Row | null;
    if (!review) return { ok: false, status: 404, error: 'That judgement could not be found.' };
    if (now.getTime() - Date.parse(String(review.created_at)) >= UNDO_DAYS * DAY_MS) return { ok: false, status: 400, error: `A judgement can only be undone within ${UNDO_DAYS} days.` };

    let movedBack = false, leftAlone = false;
    if (review.verdict === 'wrong' && review.ticket_moved === true) {
        const read = await admin.from('tickets').select('id, property_id, title, description, status, classification_source, category_id')
            .eq('id', ticketId).eq('organization_id', orgId).maybeSingle();
        if (read.error) throw new Error(read.error.message);
        const t = read.data as Row | null;
        const chosen = str(review.chosen_code);
        if (t && chosen && t.classification_source === 'manual' && MOVABLE_STATUSES.includes(String(t.status ?? ''))) {
            const propertyId = str(t.property_id);
            const cats = await categoryRows(admin);
            const rows = cats.filter(c => c.code === chosen && c.is_active !== false);
            const row = rows.find(c => propertyId && c.property_id === propertyId) ?? rows.find(c => !c.property_id) ?? rows[0];
            const team = asTeam(review.chosen_team) ?? categoryOptionsFrom(cats as never, propertyId).find(o => o.code === chosen)?.team ?? null;
            let skillGroupId = str(row?.skill_group_id);
            if (!skillGroupId && team) {
                const sg = await admin.from('skill_groups').select('id').eq('code', team).limit(1).maybeSingle();
                skillGroupId = str((sg.data as Row | null)?.id);
            }
            const back = await admin.from('tickets').update({
                category_id: str(row?.id), skill_group_id: skillGroupId, issue_code: chosen, skill_group_code: team,
                classification_source: review.sorted_by === 'rules' ? 'rule' : 'llm', updated_at: new Date().toISOString(),
            }).eq('id', ticketId).eq('organization_id', orgId).in('status', [...MOVABLE_STATUSES]).select('id');
            if (back.error) return { ok: false, status: 400, error: 'The ticket could not be moved back, so nothing was undone. Try again.' };
            movedBack = (back.data ?? []).length > 0;
            if (movedBack) {
                const logged = await admin.from('ticket_activity_log').insert({ ticket_id: ticketId, user_id: reviewerId, action: 'classification_override', old_value: str(t.category_id), new_value: str(row?.id) });
                if (logged.error) console.warn('[TicketReview] activity log not written:', logged.error.message);
                if (propertyId) {
                    try { await reassign({ id: ticketId, property_id: propertyId, skill_group_code: team, title: String(t.title ?? ''), description: String(t.description ?? '') }); } catch (err) {
                        console.error('[TicketReview] the ticket moved back could not be assigned again:', err instanceof Error ? err.message : err);
                    }
                }
            }
        }
        leftAlone = !movedBack;
    }

    const del = await admin.from('ticket_sort_reviews').delete().eq('organization_id', orgId).eq('ticket_id', ticketId);
    if (del.error) throw new Error(del.error.message);
    await removeExample(admin, orgId, ticketId);
    forgetCorrections(orgId);
    if (movedBack) return { ok: true, message: 'Undone. The ticket went back to its first category and team, and is in the queue again.' };
    if (leftAlone) return { ok: true, message: 'Undone. The AI no longer learns from it. The ticket was not moved back because it is no longer open or someone changed it since; change it on the ticket if needed.' };
    return { ok: true, message: 'Undone. The ticket is in the queue again and the AI no longer learns from it.' };
}

// ── settling a disagreement (2026-11-19) ────────────────────────────────────────────────────────────────────────────

/** Two near-identical examples disagree: `keep` stays, `drop` is no longer shown to the AI. Only this organisation's. */
export async function keepExample(admin: SupabaseClient, orgId: string, body: { keep?: unknown; drop?: unknown }): Promise<JudgeResult> {
    const keep = typeof body.keep === 'string' && UUID.test(body.keep) ? body.keep : null;
    const drop = typeof body.drop === 'string' && UUID.test(body.drop) ? body.drop : null;
    if (!keep || !drop || keep === drop) return { ok: false, status: 400, error: 'Choose which answer to keep.' };
    const both = await admin.from('ticket_sort_examples').select('id').eq('organization_id', orgId).in('id', [keep, drop]);
    if (both.error) { if (isMissing(both.error)) return { ok: false, status: 503, error: 'Learning needs migration 20261119000001 to be applied.' }; throw new Error(both.error.message); }
    if ((both.data ?? []).length !== 2) return { ok: false, status: 404, error: 'Those examples could not be found.' };
    await retireExamples(admin, orgId, [drop], `a person kept ${keep} instead`);
    return { ok: true, message: 'Kept. The other answer is no longer shown to the AI.' };
}
