/**
 * One turn of the AI Action Layer. Pure orchestration over injected dependencies, so every path is testable.
 *
 *   gate (route) → rate limit → catalog for this person → [draft in progress?] → forbidden? → interpret (AI)
 *   → validate → scope check → question: run fixed query → reply from template
 *                            → write: fill gaps one at a time → confirm card (code) → Yes → run → reply
 *   → audit row for every turn
 *
 * The conversation state travels with the client (in-app chat). It is never trusted: every value in it is re-validated
 * against the person's current access before anything runs, so a tampered state can't do more than the person could
 * already do through the app's own ticket form.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ActorContext, AiData, Channel, Lang, TurnReply } from './types';
import { CATALOG, catalogFor, matchProperty, suggestProperties, ticketCreate, type CatalogEntry, type QuestionEntry } from './catalog';
import { followUpTriggers, selectExamples, type FlagTrigger, type LearningContext, type ReviewFlag } from './learning';
import { interpret, isForbiddenRequest, isHrMatter, type InterpretLlm } from './interpret';
import { CHANGE, NO, SKIP, YES, detectLang, t } from './language';
import { buildAuditRow, type AuditInput, type AuditStore } from './audit';
import { effectiveLimits, type AiSettings } from './settings';
import { istDate, istStart } from './dates';

export const stateSchema = z.object({
    lang: z.enum(['en', 'hi', 'hinglish']).optional(),
    draft: z.object({
        entryId: z.literal('ticket.create'),
        opId: z.string().uuid(),
        propertyId: z.string().uuid().nullish(),
        description: z.string().max(1000).nullish(),
        location: z.string().max(200).nullish(),
        locationAsked: z.boolean().default(false),
        urgent: z.boolean().default(false),
        asked: z.enum(['property', 'description', 'location', 'confirm', 'change']).nullish(),
        askCount: z.number().int().min(0).max(50).default(0),
    }).strict().nullish(),
    /** The previous turn, kept 10 minutes: lets "what is missing" follow an answer, and spots "no, I meant…" / asking again. */
    last: z.object({
        text: z.string().max(300),
        at: z.string().max(40),
        entryId: z.string().max(64).nullish(),
        fields: z.record(z.string(), z.unknown()).nullish(),
        reply: z.string().max(300).nullish(),
    }).strict().nullish(),
}).strict();
export type TurnState = z.infer<typeof stateSchema>;
type Draft = NonNullable<TurnState['draft']>;

export interface PipelineDeps {
    data: AiData;
    llm: InterpretLlm;
    audit: AuditStore;
    now(): Date;
    /** true = allowed. Per person per hour. */
    allowMessage(key: string, perHour: number): boolean;
    /** Learning loop (optional): what this org has taught the AI, and where likely mistakes are flagged for review. */
    learning?: { load(orgId: string): Promise<LearningContext>; flag(f: ReviewFlag): Promise<void> };
}

const NO_LEARNING: LearningContext = { enabled: false, examples: [], instructions: null };
const FOLLOW_UP_MS = 10 * 60_000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface TurnInput {
    actor: ActorContext;
    settings: AiSettings;
    channel: Channel;
    message: string;
    state: TurnState | null;
}

/**
 * outcome = 'unsupported' when the layer had nothing to offer (no entry fits, or nothing is switched on for this person)
 * and no draft is in progress. On WhatsApp such a message is handed back to the existing bot instead of being answered.
 */
export interface TurnOutput { reply: TurnReply; state: TurnState; outcome: 'handled' | 'unsupported' }

const MAX_ASKS = 6;

export async function handleTurn(deps: PipelineDeps, input: TurnInput): Promise<TurnOutput> {
    const started = Date.now();
    const { actor, settings, channel } = input;
    const message = input.message.trim().slice(0, 1500);
    const state: TurnState = input.state ?? {};
    const shortReply = message.length <= 12 && (YES.test(message) || NO.test(message) || /^\d+$/.test(message));
    // Mid-conversation answers ("2", "3rd floor cabin 304", "haan") keep the language the person started in, unless the
    // new message is clearly Hindi or Hinglish.
    const detected = detectLang(message);
    const lang: Lang = state.lang && (shortReply || (state.draft && detected === 'en')) ? state.lang : detected;

    const audit = async (a: Omit<AuditInput, 'orgId' | 'userId' | 'channel' | 'lang'>) => {
        try {
            await deps.audit.write(buildAuditRow({ ...a, orgId: actor.orgId, userId: actor.userId, channel, lang, latencyMs: Date.now() - started }));
        } catch (err) {
            // The log must never break the conversation, but a write that can't be logged doesn't run (see runWrite).
            console.error('[AiLayer] audit write failed', err instanceof Error ? err.message : err);
            throw err;
        }
    };
    const safeAudit = (a: Parameters<typeof audit>[0]) => audit(a).catch(() => undefined);
    // What this turn answered, remembered for the next one (follow-ups and "no, I meant…").
    let lastEntryId: string | null = state.draft ? state.draft.entryId : null;
    let lastFields: Record<string, unknown> | null = null;
    const last = (text: string): NonNullable<TurnState['last']> =>
        ({ text: clip(message, 300), at: deps.now().toISOString(), entryId: lastEntryId, fields: lastFields, reply: clip(text, 300) });
    const done = (text: string, extra: Partial<TurnReply> = {}, draft: Draft | null = null): TurnOutput =>
        ({ reply: { text, ...extra }, state: { lang, draft, last: last(text) }, outcome: 'handled' });
    const unsupported = (text: string): TurnOutput => ({ reply: { text }, state: { lang, draft: null, last: last(text) }, outcome: 'unsupported' });

    // Learning loop: what this org taught the AI, and flagging likely mistakes (only while the org has it switched on).
    const learning: LearningContext = deps.learning ? await deps.learning.load(actor.orgId).catch(() => NO_LEARNING) : NO_LEARNING;
    // Taught examples and the live instructions always apply; FLAGGING only while the org's learning loop is on.
    const flag = (triggers: FlagTrigger[], f: Partial<ReviewFlag>) => {
        if (settings.learning?.enabled !== true || !deps.learning || !triggers.length) return;
        void deps.learning.flag({ orgId: actor.orgId, userId: actor.userId, channel, messageText: message, triggers, ...f }).catch(() => undefined);
    };
    const aliases = settings.aliases ?? {};
    // WhatsApp (owner 2026-11-04): this layer reads the message BEFORE the Task Manager AI. Whatever it can't or shouldn't
    // answer (tasks, a request it may not do, its own limit, the AI being down) is passed on, so the Task Manager AI and
    // the old bot answer exactly as before. In-app chat has nobody to pass to, so it answers.
    const passOn = (text: string, extra: Partial<TurnReply> = {}): TurnOutput =>
        channel === 'whatsapp' && !state.draft ? unsupported(text) : done(text, extra, state.draft ?? null);

    const limits = effectiveLimits(settings);
    // Per-hour limit: the in-memory check is fast but per server instance, so the database count backs it up.
    const hourAgo = new Date(deps.now().getTime() - 3_600_000).toISOString();
    const recentTurns = await deps.audit.countTurnsSince(actor.orgId, actor.userId, hourAgo).catch(() => 0);
    if (!deps.allowMessage(`ai-layer:${actor.orgId}:${actor.userId}`, limits.perUserPerHour) || recentTurns >= limits.perUserPerHour) {
        await safeAudit({ entryId: null, decision: 'refused', refusalReason: 'rate_limited' });
        return passOn(t('rate_limited', lang));
    }

    const available = catalogFor(actor, settings);
    if (!available.length) {
        await safeAudit({ entryId: null, decision: 'refused', refusalReason: 'nothing_enabled' });
        return unsupported(t('nothing_enabled', lang));
    }
    const abilities = available.map(a => a.entry.abilities[lang]).join(', ');
    const writeMode = available.find(a => a.entry.id === ticketCreate.id)?.mode ?? null;

    // HR matters never go to the AI or into a facility ticket, even in the middle of a draft (the draft is dropped).
    if (isHrMatter(message)) {
        await safeAudit({ entryId: 'hr.redirect', decision: 'refused', refusalReason: 'hr_matter' });
        return done(t('hr_redirect', lang));
    }

    // "no, I meant…" or the same question again: the PREVIOUS answer was probably wrong. Flag that one for review.
    if (!state.draft && state.last) {
        const fu = followUpTriggers(state.last, message, deps.now());
        if (fu.length) flag(fu, { messageText: state.last.text, followUpText: message, botReply: state.last.reply ?? null, entryId: state.last.entryId ?? null });
    }

    // A draft in progress, but only while ticket creation is still allowed for this person.
    if (state.draft && writeMode) {
        return continueDraft(state.draft);
    }

    if (isForbiddenRequest(message)) {
        await safeAudit({ entryId: null, decision: 'refused', refusalReason: 'forbidden_request' });
        // On WhatsApp the Task Manager AI decides about its own tasks (e.g. "delete task 3"); this layer still does nothing.
        return passOn(t('forbidden', lang));
    }

    let result;
    try {
        const recent = state.last && state.last.entryId && deps.now().getTime() - Date.parse(state.last.at) <= FOLLOW_UP_MS ? state.last : null;
        const context = recent
            ? `The previous question (a few minutes ago) was ${JSON.stringify({ entry: recent.entryId, fields: recent.fields ?? {} })}. If this message is a short follow-up to it (e.g. "what is missing", "and yesterday?", "only SS Plaza", "details"), use the same entry and change only what the person changed.`
            : null;
        const propertyList = actor.propertyIds.map(id => actor.propertyNames[id] + (aliases[id]?.length ? ` (${aliases[id].join(', ')})` : ''));
        result = await interpret(deps.llm, message, available.map(a => a.entry), propertyList, context, {
            examples: selectExamples(message, learning.examples, available.map(a => a.entry.id)),
            instructions: learning.instructions,
        });
    } catch {
        await safeAudit({ entryId: null, decision: 'error', refusalReason: 'ai_unavailable' });
        return passOn(t('ai_down', lang));
    }
    const usage = { model: result.model, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
    const v = result.value;

    if (v.entry === 'forbidden') {
        await safeAudit({ entryId: null, decision: 'refused', refusalReason: 'forbidden_request', ...usage });
        return passOn(t('forbidden', lang));
    }
    if (v.entry === 'tasks') {
        await safeAudit({ entryId: null, decision: 'handed_off', refusalReason: 'to_task_manager', ...usage });
        return unsupported(t('tasks_elsewhere', lang));
    }
    if (v.entry === 'none') {
        await safeAudit({ entryId: null, decision: 'refused', refusalReason: 'unsupported', topic: 'topic' in v ? v.topic : null, ...usage });
        const reply = t('unknown', lang, { abilities });
        flag(['unknown'], { botReply: reply });
        return unsupported(reply);
    }
    const entry = CATALOG.find(e => e.id === v.entry) as CatalogEntry;
    const fields = 'fields' in v ? v.fields : {};

    // Scope: a building the person named must be one of theirs.
    const named = typeof fields.property_name === 'string' && fields.property_name.trim() ? fields.property_name.trim() : null;
    let propertyIds = actor.propertyIds;
    if (named) {
        const match = matchProperty(named, actor.propertyNames, aliases);
        if (!match) {
            await safeAudit({ entryId: entry.id, decision: 'refused', refusalReason: 'out_of_scope_property', ...usage });
            return done(t('out_of_scope', lang, { properties: Object.values(actor.propertyNames).slice(0, 5).join(', ') }));
        }
        propertyIds = [match];
    }

    if (entry.kind === 'question') {
        const q = entry as QuestionEntry<Record<string, unknown>>;
        const parsed = q.fields.safeParse(fields);
        const f = parsed.success ? parsed.data : q.fields.parse({});
        try {
            const out = await q.run({ actor, data: deps.data, lang, now: deps.now() }, f, propertyIds);
            lastEntryId = entry.id;
            lastFields = { ...f, ...(named ? { property_name: named } : {}) };
            await safeAudit({ entryId: entry.id, decision: 'answered', fields: { ...f, property_count: propertyIds.length }, ...usage });
            return done(out.reply);
        } catch (err) {
            console.error('[AiLayer] question failed', entry.id, err instanceof Error ? err.message : err);
            await safeAudit({ entryId: entry.id, decision: 'error', refusalReason: 'query_failed', ...usage });
            return done(t('failed', lang));
        }
    }

    // ticket.create: start a draft from what the message already contains.
    const description = grounded(typeof fields.description === 'string' ? fields.description : null, message) ?? null;
    const draft: Draft = {
        entryId: 'ticket.create', opId: randomUUID(),
        propertyId: propertyIds.length === 1 ? propertyIds[0] : null,
        description: description ?? (looksLikeProblem(message) ? message.slice(0, 1000) : null),
        location: typeof fields.location === 'string' && fields.location.trim() ? grounded(fields.location, message) : null,
        locationAsked: false,
        urgent: fields.urgent === true,
        asked: null, askCount: 0,
    };
    return nextStep(draft, usage);

    // ── draft helpers (closures over deps, actor, lang) ──

    async function nextStep(d: Draft, usage: Partial<AuditInput> = {}): Promise<TurnOutput> {
        if (d.askCount >= MAX_ASKS) {
            await safeAudit({ entryId: d.entryId, decision: 'handed_off', refusalReason: 'too_many_questions', fields: d, ...usage });
            flag(['too_many_questions'], { entryId: d.entryId, botReply: t('handoff', lang) });
            return done(t('handoff', lang));
        }
        if (!d.propertyId && actor.propertyIds.length === 1) d = { ...d, propertyId: actor.propertyIds[0] };
        if (!d.propertyId) {
            // Always numbered (owner 2026-11-04: "where are the numbers"), up to 40; beyond that, by name.
            const names = actor.propertyIds.map(id => actor.propertyNames[id]);
            const options = names.length <= 40 ? names : undefined;
            const text = options ? `${t('ask_property', lang)}\n${options.map((n, i) => `${i + 1}) ${n}`).join('\n')}\n${t('pick_number', lang)}` : `${t('ask_property', lang)} ${t('pick_number', lang)}`;
            await safeAudit({ entryId: d.entryId, decision: 'asked', fields: { asked: 'property' }, ...usage });
            return done(text, { options }, { ...d, asked: 'property', askCount: d.askCount + 1 });
        }
        if (!d.description) {
            await safeAudit({ entryId: d.entryId, decision: 'asked', fields: { asked: 'description' }, ...usage });
            return done(t('ask_description', lang), {}, { ...d, asked: 'description', askCount: d.askCount + 1 });
        }
        if (!d.location && !d.locationAsked) {
            await safeAudit({ entryId: d.entryId, decision: 'asked', fields: { asked: 'location' }, ...usage });
            return done(t('ask_location', lang), {}, { ...d, asked: 'location', locationAsked: true, askCount: d.askCount + 1 });
        }
        // The confirmation card is built by code from the exact values that will run (gap S20).
        const card = t('confirm_ticket', lang, {
            property: actor.propertyNames[d.propertyId] ?? '',
            location: d.location ? `, ${d.location}` : '',
            description: d.description + (d.urgent ? ' (urgent)' : ''),
        });
        await safeAudit({ entryId: d.entryId, decision: 'confirm_shown', fields: { property_id: d.propertyId, description: d.description, location: d.location, urgent: d.urgent }, ...usage });
        return done(card, { awaitingConfirm: true, options: lang === 'hi' ? ['हाँ', 'बदलें', 'रद्द करें'] : ['Yes', 'Change', 'Cancel'] }, { ...d, asked: 'confirm' });
    }

    async function continueDraft(d: Draft): Promise<TurnOutput> {
        if (NO.test(message) && d.asked !== 'location') {
            await safeAudit({ entryId: d.entryId, decision: 'cancelled' });
            return done(t('cancelled', lang));
        }
        // Access may have changed since the draft started: re-check the building every turn.
        if (d.propertyId && !actor.propertyIds.includes(d.propertyId)) d = { ...d, propertyId: null };
        switch (d.asked) {
            case 'property': {
                const n = /^\d+$/.test(message) ? Number(message) : NaN;
                const byNumber = Number.isInteger(n) && n >= 1 && n <= actor.propertyIds.length ? actor.propertyIds[n - 1] : null;
                const id = byNumber ?? matchProperty(message, actor.propertyNames, aliases);
                if (id) return nextStep({ ...d, propertyId: id });
                // Not clear: "Did you mean…?" with the same numbers as the full list, or the full list again.
                if (d.askCount >= 2) flag(['repeated_clarify'], { entryId: d.entryId });
                const near = suggestProperties(message, actor.propertyNames, aliases);
                if (!near.length || d.askCount >= MAX_ASKS) return nextStep({ ...d, propertyId: null });
                await safeAudit({ entryId: d.entryId, decision: 'asked', fields: { asked: 'property' } });
                const lines = near.map(pid => `${actor.propertyIds.indexOf(pid) + 1}) ${actor.propertyNames[pid]}`);
                return done(`${t('property_not_found', lang, { typed: clip(message, 40) })}\n${lines.join('\n')}\n${t('pick_number', lang)}`, {}, { ...d, asked: 'property', askCount: d.askCount + 1 });
            }
            case 'description':
                return nextStep({ ...d, description: message.length >= 3 ? message.slice(0, 1000) : null });
            case 'location':
                return nextStep({ ...d, location: SKIP.test(message) ? null : message.slice(0, 200) });
            case 'confirm':
                if (YES.test(message)) return runWrite(d);
                if (CHANGE.test(message)) return done(t('change_what', lang), {}, { ...d, asked: 'change' });
                return applyChange(d);
            case 'change':
                return applyChange(d);
            default:
                return nextStep(d);
        }
    }

    /** "no, 3rd floor" or "it's Lower Parel": read the change with the AI, limited to the ticket entry, then confirm again. */
    async function applyChange(d: Draft): Promise<TurnOutput> {
        let usage: Partial<AuditInput> = {};
        let next = { ...d };
        try {
            const r = await interpret(deps.llm, message, [ticketCreate], Object.values(actor.propertyNames),
                'The person is correcting a ticket they are about to raise. Fill only the fields they are changing.');
            usage = { model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
            if (r.value.entry === ticketCreate.id && 'fields' in r.value) {
                const f = r.value.fields;
                if (typeof f.property_name === 'string' && f.property_name.trim()) {
                    const m = matchProperty(f.property_name, actor.propertyNames, aliases);
                    if (!m) return done(t('out_of_scope', lang, { properties: Object.values(actor.propertyNames).slice(0, 5).join(', ') }), {}, { ...d, asked: 'change' });
                    next.propertyId = m;
                }
                const desc = grounded(typeof f.description === 'string' ? f.description : null, message);
                if (desc) next.description = desc;
                const loc = grounded(typeof f.location === 'string' ? f.location : null, message);
                if (loc) next.location = loc;
                if (f.urgent === true) next.urgent = true;
            }
        } catch {
            return done(t('ai_down', lang), {}, d);
        }
        next = { ...next, askCount: d.askCount + 1 };
        return nextStep(next, usage);
    }

    async function runWrite(d: Draft): Promise<TurnOutput> {
        // Re-validate everything from the (untrusted) state against current access.
        if (!d.propertyId || !actor.propertyIds.includes(d.propertyId) || !d.description) return nextStep({ ...d, asked: null });
        const since = istStart(istDate(deps.now())).toISOString();
        const fieldsForLog = { property_id: d.propertyId, description: d.description, location: d.location, urgent: d.urgent };
        const overCap = async () => (await deps.audit.countActionsSince(actor.orgId, actor.userId, since).catch(() => Infinity)) > limits.actionsPerUserPerDay;
        if (writeMode === 'shadow') {
            await safeAudit({ entryId: d.entryId, decision: 'shadow', opId: d.opId, fields: fieldsForLog });
            if (await overCap()) return done(t('daily_limit', lang));
            return done(t('ticket_shadow', lang));
        }
        // Idempotency: the same draft confirmed twice (double tap, retried request) runs once. The unique index on
        // (op_id) WHERE decision = 'accepted' makes this race-safe in the database too.
        const status = await deps.audit.opStatus(actor.orgId, actor.userId, d.opId).catch(() => 'accepted' as const);
        if (status === 'accepted') return done(t('already_done', lang));
        if (status === 'failed') return done(t('failed', lang));
        // Live: the audit row is written FIRST. If it can't be written, nothing is created (no unlogged writes).
        try {
            await audit({ entryId: d.entryId, decision: 'accepted', opId: d.opId, fields: fieldsForLog });
        } catch {
            return done(t('failed', lang));
        }
        // The daily cap is counted AFTER our own row exists, so parallel "Yes" requests can't all slip under it.
        if (await overCap()) {
            await safeAudit({ entryId: d.entryId, decision: 'refused', opId: d.opId, refusalReason: 'daily_limit' });
            return done(t('daily_limit', lang));
        }
        try {
            const description = d.location ? `${d.description} (Location: ${d.location})` : d.description;
            // Only staff may mark a ticket urgent; for tenants and vendors the classifier decides the priority.
            const priority = d.urgent && !actor.ownRecordsOnly ? 'high' : undefined;
            const created = await deps.data.createTicket({ opId: d.opId, propertyId: d.propertyId, description, title: d.description.slice(0, 100), priority });
            await safeAudit({ entryId: d.entryId, decision: 'acted', opId: d.opId, resultRef: created.ticketNumber });
            return done(t('ticket_created', lang, {
                number: created.ticketNumber, property: actor.propertyNames[d.propertyId], status: created.status,
                assignee: created.assigneeName ? (lang === 'en' ? `, assigned to ${created.assigneeName}` : `, ${created.assigneeName}`) : '',
            }));
        } catch (err) {
            console.error('[AiLayer] ticket create failed', err instanceof Error ? err.message : err);
            await safeAudit({ entryId: d.entryId, decision: 'error', opId: d.opId, refusalReason: 'write_failed' });
            return done(t('failed', lang));
        }
    }
}

/**
 * Grounding: a value the AI extracted must come from the person's own words. At least 60% of its words must appear in
 * the message, otherwise it's dropped (the AI invented or "improved" it).
 */
export function grounded(value: string | null, message: string): string | null {
    if (!value || !value.trim()) return null;
    const norm = (s: string) => s.toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [];
    const words = norm(value);
    if (!words.length) return null;
    const have = new Set(norm(message));
    const hit = words.filter(w => have.has(w)).length;
    return hit / words.length >= 0.6 ? value.trim().slice(0, 1000) : null;
}

/** "raise a ticket" alone isn't a description; "AC not working in cabin 304" is. */
function looksLikeProblem(message: string): boolean {
    const stripped = message.toLowerCase().replace(/\b(please|pls|raise|create|make|open|log|a|an|the|new|ticket|complaint|banao|bana|do|karo|ek)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return stripped.split(' ').filter(Boolean).length >= 3;
}
