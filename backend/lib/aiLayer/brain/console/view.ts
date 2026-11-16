/**
 * Brain Console: turns database rows into what the screens show. Pure (no database, no network), so every rule here
 * is covered by tests.
 *
 * Privacy (owner 2026-11-14): the console shows messages, never the person. This file is the ONE place a row with a
 * user id becomes something a browser may see: toTurnView() drops the user id and the WhatsApp message id, masks phone
 * numbers, email addresses and ids inside the text, and replaces the person with a tag that is the same for one person
 * within one day and cannot be turned back (a keyed hash; the key never leaves the server).
 */
import { createHmac } from 'node:crypto';
import { isRephrase, learningTriggers } from '@/task-manager/LearningLoop';
import { defaultLevel, skillModeFor, type BrainSettings, type RoleClass } from '../config';
import { describeSkills } from '../skills/registry';
import type { BrainChannel, Outcome } from '../types';
import type {
    ConversationSummary, CostView, Flag, KeyCost, KeyView, ModelCallView, Note, Overview, SeriesPoint, SkillView, ToolCallView, TurnLabel, TurnView,
} from './types';

export interface TurnRow {
    id: string;
    user_id: string | null;
    channel: BrainChannel;
    shadow: boolean;
    message_id?: string | null;
    user_text: string | null;
    reply_text: string | null;
    outcome: string;
    reason: string | null;
    skill_id: string | null;
    handoff_to: string | null;
    lang: string | null;
    model: string | null;
    key_slot: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
    cache_read: number | null;
    cost_usd: number | string | null;
    latency_ms: number | null;
    grounded: boolean | null;
    had_file: boolean | null;
    role_class?: string | null;
    /** { lessons: string[], guidance: number | null } (migration 20261114000004). */
    learning?: unknown;
    model_calls?: unknown;
    tool_calls?: unknown;
    hops?: unknown;
    created_at: string;
}

// ── Text and identity ─────────────────────────────────────────────────────────────────────────────────────────────

const PHONE = /(?:\+?\d[\s().-]*){10,15}/g;
const EMAIL = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Phone numbers, email addresses and database ids never reach the console. Names typed inside a sentence are not detectable. */
export function maskIdentity(text: string | null | undefined, max = 2000): string | null {
    if (text == null) return null;
    return String(text).replace(UUID, '[id]').replace(EMAIL, '[email]').replace(PHONE, '[phone]').slice(0, max);
}

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
/** YYYY-MM-DD in India time. */
export const indiaDay = (iso: string | Date): string => DAY.format(typeof iso === 'string' ? new Date(iso) : iso);
const HOUR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const indiaHour = (iso: string): string => {
    const p = Object.fromEntries(HOUR.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}`;
};

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no I, L, O, U, 0, 1: easy to read aloud

/**
 * The tag shown instead of a person: the same for one person within one day, different the next day, and different in
 * another organisation. Without the server's key it cannot be worked out from a user id, so the pilot picker (which
 * does show names) cannot be used to find out who wrote a message.
 */
export function personTag(secret: string, orgId: string, who: string, day: string): string {
    const mac = createHmac('sha256', secret).update(`${orgId}|${who}|${day}`).digest();
    let out = '';
    for (let i = 0; i < 6; i++) out += ALPHABET[mac[i] % ALPHABET.length];
    return out;
}

// ── Flags: which turns deserve a human look ───────────────────────────────────────────────────────────────────────

const CORRECTION_WINDOW_MS = 10 * 60_000;
const THREAD_GAP_MS = 2 * 3600_000;
export const SLOW_MS = 12_000;

/**
 * Worked out from the trace and from what the same person did next. The follow-up rules ("no, I meant…", asking the
 * same thing again) are the Task Manager learning loop's own (task-manager/LearningLoop.ts), so one definition of a
 * likely mistake serves every bot. In shadow the person is reacting to the bot that answered, not to the brain, so the
 * follow-up rules do not apply there.
 */
export function flagTurns(rows: TurnRow[]): Map<string, Flag[]> {
    const out = new Map<string, Flag[]>();
    const byPerson = new Map<string, TurnRow[]>();
    for (const r of rows) {
        const flags: Flag[] = [];
        if (r.outcome === 'error') flags.push('gave_up');
        // A practice-only skill and a repeated Yes end as "not executed" by design: neither is a mistake.
        if (r.outcome === 'not_executed' && r.reason !== 'test_mode' && r.reason !== 'already_done') flags.push('not_done');
        if (r.grounded === false) flags.push('ungrounded');
        if (r.handoff_to === 'human') flags.push('handed_to_person');
        out.set(r.id, flags);
        if (!r.user_id) continue;
        const key = `${r.user_id}|${r.shadow ? 's' : 'l'}`;
        byPerson.set(key, [...(byPerson.get(key) ?? []), r]);
    }
    for (const turns of byPerson.values()) {
        turns.sort((a, b) => a.created_at.localeCompare(b.created_at));
        for (let i = 0; i < turns.length; i++) {
            const cur = turns[i], next = turns[i + 1], prev = turns[i - 1];
            const flags = out.get(cur.id)!;
            if (prev && cur.outcome === 'ask' && prev.outcome === 'ask' && Date.parse(cur.created_at) - Date.parse(prev.created_at) <= THREAD_GAP_MS) flags.push('question_loop');
            if (!next || cur.shadow || !next.user_text) continue;
            const gap = Date.parse(next.created_at) - Date.parse(cur.created_at);
            // While the brain is waiting for an answer, a bare "no" answers its question; only a clear "wrong / I meant" counts.
            const waiting = cur.outcome === 'ask' || cur.outcome === 'propose';
            const rephrase = isRephrase(cur.user_text, next.user_text, gap);
            const t = learningTriggers({ text: next.user_text, rephrase, pending: waiting });
            if (t.includes('correction') && gap >= 0 && gap <= CORRECTION_WINDOW_MS) flags.push('correction');
            else if (t.includes('rephrase')) flags.push('asked_again');
        }
    }
    return out;
}

// ── One turn ──────────────────────────────────────────────────────────────────────────────────────────────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
const ROLE_CLASSES: readonly RoleClass[] = ['staff', 'client', 'vendor'];
export const asRoleClass = (v: unknown): RoleClass | null => (ROLE_CLASSES.includes(v as RoleClass) ? (v as RoleClass) : null);

/** Which of today's bots took a message, from the inbound ledger's route. */
const ROUTE_LABEL: Record<string, string> = {
    task_import: 'Task importer', smart_chat: 'Task assistant (smart chat)', task_router: 'Task assistant (commands)',
    crm_lead_reply: 'Lead replies', agent_unknown: 'Unknown-sender agent', brain: 'The brain',
};
export const routeLabel = (route: string | null | undefined): string | null => (route ? ROUTE_LABEL[route] ?? null : null);

export interface ViewOptions {
    secret: string;
    orgId: string;
    flags?: Map<string, Flag[]>;
    labels?: Map<string, TurnLabel>;
    /** message id → the ledger route, for shadow turns. Looked up on the server; the id itself is never sent. */
    routes?: Map<string, string | null>;
    detail?: boolean;
}

export function toTurnView(r: TurnRow, o: ViewOptions): TurnView {
    const day = indiaDay(r.created_at);
    const hr = r.reason === 'hr_matter';
    const tools = list(r.tool_calls), models = list(r.model_calls), hops = list(r.hops);
    const learning = (r.learning && typeof r.learning === 'object' ? r.learning : {}) as { lessons?: unknown; guidance?: unknown };
    const notes: Note[] = [];
    if (hops.length) notes.push('backup_model');
    if (num(r.latency_ms) >= SLOW_MS) notes.push('slow');
    if (r.had_file) notes.push('photo');
    if (hr) notes.push('hr_hidden');
    else if (r.user_text == null && r.reply_text == null) notes.push('text_cleared');
    const view: TurnView = {
        id: r.id,
        at: r.created_at,
        // A row with no user (an HR matter) gets a tag of its own, so it can never be grouped with anyone's conversation.
        person: personTag(o.secret, o.orgId, r.user_id ?? `turn:${r.id}`, day),
        day,
        role: asRoleClass(r.role_class),
        channel: r.channel,
        shadow: !!r.shadow,
        userText: hr ? null : maskIdentity(r.user_text, 1500),
        replyText: hr ? null : maskIdentity(r.reply_text, 2000),
        outcome: r.outcome as Outcome,
        reason: r.reason,
        skillId: r.skill_id,
        handoffTo: r.handoff_to,
        lang: r.lang,
        model: r.model,
        keySlot: r.key_slot,
        tokensIn: num(r.tokens_in),
        tokensOut: num(r.tokens_out),
        cacheRead: num(r.cache_read),
        costUsd: numOrNull(r.cost_usd),
        latencyMs: num(r.latency_ms),
        grounded: r.grounded,
        toolCount: tools.length,
        lessons: Array.isArray(learning.lessons) ? learning.lessons.length : 0,
        guidance: typeof learning.guidance === 'number' ? learning.guidance : null,
        flags: o.flags?.get(r.id) ?? [],
        notes,
        label: o.labels?.get(r.id) ?? null,
        answeredBy: r.shadow && r.message_id ? routeLabel(o.routes?.get(r.message_id)) : null,
    };
    if (o.detail) {
        view.toolCalls = hr ? [] : tools.map((t, i): ToolCallView => ({
            seq: num(t.seq) || i + 1, skillId: String(t.skillId ?? ''), kind: (['read', 'write', 'control'].includes(String(t.kind)) ? t.kind : 'read') as ToolCallView['kind'],
            args: maskIdentity(JSON.stringify(t.args ?? {}), 600) ?? '{}', ok: t.ok !== false, ms: num(t.ms), error: t.error ? maskIdentity(String(t.error), 200) : null,
        }));
        view.modelCalls = models.map((m, i): ModelCallView => ({
            seq: num(m.seq) || i + 1, model: String(m.model ?? ''), keySlot: numOrNull(m.keySlot), tokensIn: num(m.tokensIn), tokensOut: num(m.tokensOut),
            cacheRead: num(m.cacheRead), costUsd: numOrNull(m.costUsd), ms: num(m.ms), stopReason: String(m.stopReason ?? ''),
        }));
        view.hops = hops.map(h => ({ model: String(h.model ?? ''), error: maskIdentity(String(h.error ?? ''), 200) ?? '' }));
    }
    return view;
}

// ── Lists and totals ──────────────────────────────────────────────────────────────────────────────────────────────

export function median(values: number[]): number { return percentile(values, 0.5); }
export function percentile(values: number[], p: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
const tally = <K extends string>(keys: K[]): Array<{ key: K; count: number }> => {
    const m = new Map<K, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};
const round = (n: number, places = 6) => Math.round(n * 10 ** places) / 10 ** places;

/** One conversation = one person's turns in one India day, on one track (live or shadow). Newest first. */
export function conversations(views: TurnView[]): ConversationSummary[] {
    const groups = new Map<string, TurnView[]>();
    for (const v of views) {
        const key = `${v.person}|${v.day}|${v.shadow ? 's' : 'l'}`;
        groups.set(key, [...(groups.get(key) ?? []), v]);
    }
    return [...groups.values()].map(turns => {
        turns.sort((a, b) => a.at.localeCompare(b.at));
        const first = turns[0], last = turns[turns.length - 1];
        const opening = turns.find(t => t.userText)?.userText ?? null;
        return {
            person: first.person, day: first.day, role: turns.find(t => t.role)?.role ?? null, channels: [...new Set(turns.map(t => t.channel))], shadow: first.shadow,
            turns: turns.length, firstAt: first.at, lastAt: last.at, preview: opening ? opening.replace(/\s+/g, ' ').slice(0, 140) : null,
            lastOutcome: last.outcome, flagged: turns.filter(t => t.flags.length).length, costUsd: round(turns.reduce((n, t) => n + (t.costUsd ?? 0), 0)),
        };
    }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

const HANDLED: readonly string[] = ['answer', 'ask', 'propose', 'executed', 'cancelled'];

export function overview(rows: TurnRow[], views: TurnView[], days: number, truncated: boolean): Overview {
    const bucket: Overview['bucket'] = days <= 1 ? 'hour' : 'day';
    const series = new Map<string, SeriesPoint>();
    for (const v of views) {
        const t = bucket === 'hour' ? indiaHour(v.at) : v.day;
        const p = series.get(t) ?? { t, turns: 0, flagged: 0, costUsd: 0 };
        p.turns++; if (v.flags.length) p.flagged++; p.costUsd = round(p.costUsd + (v.costUsd ?? 0));
        series.set(t, p);
    }
    const tokensIn = views.reduce((n, v) => n + v.tokensIn, 0), cacheRead = views.reduce((n, v) => n + v.cacheRead, 0);
    const skills = new Map<string, { calls: number; failed: number }>();
    for (const r of rows) for (const t of list(r.tool_calls)) {
        const id = String(t.skillId ?? ''); if (!id) continue;
        const s = skills.get(id) ?? { calls: 0, failed: 0 };
        s.calls++; if (t.ok === false) s.failed++;
        skills.set(id, s);
    }
    const byModel = new Map<string, TurnView[]>();
    for (const v of views) if (v.model) byModel.set(v.model, [...(byModel.get(v.model) ?? []), v]);
    const live = views.filter(v => !v.shadow);
    return {
        days, truncated,
        totals: {
            turns: views.length, live: live.length, shadow: views.length - live.length,
            people: new Set(views.map(v => `${v.person}|${v.day}`)).size,
            flagged: views.filter(v => v.flags.length).length,
            costUsd: round(views.reduce((n, v) => n + (v.costUsd ?? 0), 0)),
            turnsWithoutCost: views.filter(v => v.costUsd === null && v.model).length,
            medianLatencyMs: median(views.map(v => v.latencyMs)), p95LatencyMs: percentile(views.map(v => v.latencyMs), 0.95),
            // tokens_in counts every prompt token; cache_read is the part of them that came from the cache.
            cacheHitRate: tokensIn > 0 ? round(Math.min(1, cacheRead / tokensIn), 4) : null,
            toolCallsPerTurn: views.length ? round(views.reduce((n, v) => n + v.toolCount, 0) / views.length, 2) : 0,
            handledRate: views.length ? round(views.filter(v => HANDLED.includes(v.outcome)).length / views.length, 4) : null,
        },
        bucket,
        series: [...series.values()].sort((a, b) => a.t.localeCompare(b.t)),
        outcomes: tally(views.map(v => v.outcome)).map(x => ({ outcome: x.key, count: x.count })),
        skills: [...skills.entries()].map(([skillId, s]) => ({ skillId, ...s })).sort((a, b) => b.calls - a.calls || a.skillId.localeCompare(b.skillId)),
        models: [...byModel.entries()].map(([model, vs]) => ({ model, turns: vs.length, costUsd: round(vs.reduce((n, v) => n + (v.costUsd ?? 0), 0)), medianLatencyMs: median(vs.map(v => v.latencyMs)) })).sort((a, b) => b.turns - a.turns),
        channels: tally(views.map(v => v.channel)).map(x => ({ channel: x.key, turns: x.count })),
        roles: tally(views.map(v => v.role ?? 'unknown')).map(x => ({ role: x.key, turns: x.count })),
        flags: tally(views.flatMap(v => v.flags)).map(x => ({ flag: x.key, count: x.count })),
        latestFlagged: views.filter(v => v.flags.length && !v.label).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5),
    };
}

// ── Skills ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function skillViews(settings: BrainSettings, rows: TurnRow[]): SkillView[] {
    const usage = new Map<string, { calls: number; failed: number; lastUsedAt: string | null }>();
    for (const r of rows) for (const t of list(r.tool_calls)) {
        const id = String(t.skillId ?? ''); if (!id) continue;
        const u = usage.get(id) ?? { calls: 0, failed: 0, lastUsedAt: null };
        u.calls++; if (t.ok === false) u.failed++;
        if (!u.lastUsedAt || r.created_at > u.lastUsedAt) u.lastUsedAt = r.created_at;
        usage.set(id, u);
    }
    return describeSkills().map(s => ({
        id: s.id, module: s.module, kind: s.kind, risk: s.risk, description: s.description, examples: s.examples, defaultMode: s.defaultMode,
        mode: skillModeFor(settings, s.id, s.defaultMode),
        roles: Object.fromEntries(ROLE_CLASSES.map(c => {
            const level = defaultLevel(c, s.module);
            return [c, s.kind === 'write' ? level === 'questions_actions' : level !== 'off'];
        })) as Record<RoleClass, boolean>,
        usage: usage.get(s.id) ?? { calls: 0, failed: 0, lastUsedAt: null },
    }));
}

// ── Settings: what changed, and what may not change in one step ───────────────────────────────────────────────────

const MODE_WORD: Record<string, string> = { off: 'off', shadow: 'practice only', live: 'live' };

/** What a skill really does for this organisation: nothing, practice (it proposes, nothing runs), or acting for real. */
type Acting = 'off' | 'practice' | 'live';
function acting(s: BrainSettings, skillId: string, fallback: 'off' | 'shadow' | 'live'): Acting {
    const mode = skillModeFor(s, skillId, fallback);
    if (s.mode === 'off' || mode === 'off') return 'off';
    return s.mode === 'live' && mode === 'live' ? 'live' : 'practice';
}

/**
 * What a save may not do, in plain words, or null when the change is fine.
 *   - A skill that changes something (raise a ticket, book a room, attach a file) may not go from doing nothing straight
 *     to acting for real. It has to be in practice first, whichever switch gets it there: its own mode OR the
 *     organisation's mode (review 2026-11-14: a skill saved as live while the brain was off went live with the brain).
 *     Memory skills are live by design (they only touch the person's own preferences) and are not held back.
 *   - Skill names must be real skills.
 *   - The role grid is not edited from the console yet, so a save that changes it is refused rather than trusted.
 */
export function refuseSettingsChange(before: BrainSettings, after: BrainSettings): string | null {
    const skills = describeSkills();
    const unknown = Object.keys(after.skillModes).find(id => !skills.some(s => s.id === id));
    if (unknown) return `"${unknown.slice(0, 40)}" is not a skill of the brain. Nothing was saved.`;
    if (JSON.stringify(before.grid) !== JSON.stringify(after.grid)) return 'Access per role cannot be changed from the console yet. Nothing was saved.';
    for (const s of skills) {
        if (s.kind !== 'write' || s.defaultMode === 'live') continue;
        if (acting(before, s.id, s.defaultMode) === 'off' && acting(after, s.id, s.defaultMode) === 'live') {
            return `"${s.id}" would start acting for real without ever having been in practice. Save it as practice only first (or put the brain in shadow), look at what it proposes, then make it live.`;
        }
    }
    return null;
}

/** Fewer people than this from outside the Tech team, and their messages could be traced back to them. */
export const MIN_OUTSIDE_PILOT = 5;

/**
 * Owner 2026-11-14: the console must not show who a person is. A Tech member chooses the pilot by name, so a pilot of
 * one or two people from outside the Tech team would tell them whose messages they are reading (review 2026-11-14).
 * The people who can use the brain must therefore be Tech team members only (testing on themselves), or include at
 * least MIN_OUTSIDE_PILOT people from outside it. Returns the reason in plain words, or null.
 * This cannot stop someone adding people one at a time and watching what appears; the change log records every change.
 */
export function refuseAudience(after: BrainSettings, members: ReadonlyArray<{ id: string; isTech: boolean }>): string | null {
    if (after.mode === 'off') return null;
    const blocked = new Set(after.blockedUserIds);
    const tech = new Set(members.filter(m => m.isTech).map(m => m.id));
    const reach = (after.audience === 'everyone' ? members.map(m => m.id) : after.pilotUserIds).filter(id => !blocked.has(id));
    const outside = reach.filter(id => !tech.has(id)).length;
    if (outside > 0 && outside < MIN_OUTSIDE_PILOT) {
        return `Only ${outside} ${outside === 1 ? 'person' : 'people'} from outside the Tech team would be able to use the brain. With so few, their messages could be traced back to them. Include at least ${MIN_OUTSIDE_PILOT} people from outside the Tech team, or only Tech team members.`;
    }
    return null;
}

/** The change log line(s) for a save. Counts only for people: the log never lists who is in the pilot. */
export function diffSettings(before: BrainSettings, after: BrainSettings): string[] {
    const out: string[] = [];
    const say = (label: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${label}: ${String(a)} → ${String(b)}`); };
    if (before.mode !== after.mode) out.push(`Mode: ${MODE_WORD[before.mode]} → ${MODE_WORD[after.mode]}`);
    say('Audience', before.audience, after.audience);
    const people = (label: string, a: string[], b: string[]) => {
        const added = b.filter(x => !a.includes(x)).length, removed = a.filter(x => !b.includes(x)).length;
        if (added || removed) out.push(`${label}: ${[added ? `${added} added` : '', removed ? `${removed} removed` : ''].filter(Boolean).join(', ')} (now ${b.length})`);
    };
    people('Pilot people', before.pilotUserIds, after.pilotUserIds);
    people('Blocked people', before.blockedUserIds, after.blockedUserIds);
    say('WhatsApp', before.channels.whatsapp ? 'on' : 'off', after.channels.whatsapp ? 'on' : 'off');
    say('App chat', before.channels.app_chat ? 'on' : 'off', after.channels.app_chat ? 'on' : 'off');
    for (const s of describeSkills()) {
        const was = skillModeFor(before, s.id, s.defaultMode), now = skillModeFor(after, s.id, s.defaultMode);
        if (was !== now) out.push(`Skill ${s.id}: ${MODE_WORD[was]} → ${MODE_WORD[now]}`);
    }
    say('Messages per person per hour', before.limits.perUserPerHour, after.limits.perUserPerHour);
    say('Actions per person per day', before.limits.actionsPerUserPerDay, after.limits.actionsPerUserPerDay);
    say('Look-ups per message', before.limits.maxToolCalls, after.limits.maxToolCalls);
    say('Questions in a row', before.limits.maxQuestionsInRow, after.limits.maxQuestionsInRow);
    say('Model effort', before.model.effort, after.model.effort);
    say('Model reply length (tokens)', before.model.maxTokens, after.model.maxTokens);
    say('Model sees photos', before.model.vision ? 'yes' : 'no', after.model.vision ? 'yes' : 'no');
    say('Memory', before.memory.enabled ? 'on' : 'off', after.memory.enabled ? 'on' : 'off');
    say('Remembered facts kept (days)', before.memory.profileDays, after.memory.profileDays);
    say('Past actions kept (days)', before.memory.episodeDays, after.memory.episodeDays);
    say('Lessons from judged messages', before.learning.lessons ? 'on' : 'off', after.learning.lessons ? 'on' : 'off');
    say('Lessons shown per message', before.learning.maxLessons, after.learning.maxLessons);
    say('Claude key order', before.keys.order.join(', '), after.keys.order.join(', '));
    say('Key 1 cycle ends', before.keys.cycleEnd.k1 ?? 'not set', after.keys.cycleEnd.k1 ?? 'not set');
    say('Key 2 cycle ends', before.keys.cycleEnd.k2 ?? 'not set', after.keys.cycleEnd.k2 ?? 'not set');
    say('Key 1 monthly credit (USD)', before.keys.monthlyCreditUsd.k1, after.keys.monthlyCreditUsd.k1);
    say('Key 2 monthly credit (USD)', before.keys.monthlyCreditUsd.k2, after.keys.monthlyCreditUsd.k2);
    say('Message text kept (days)', before.textRetentionDays, after.textRetentionDays);
    if (JSON.stringify(before.grid) !== JSON.stringify(after.grid)) out.push('Role access grid changed');
    return out;
}

// ── Cost ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (day: string, n: number): string => {
    const [y, m, d] = day.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return iso(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))));
};

/**
 * The billing cycle that contains `today`. With a saved end date the cycle is the month ending on it, rolled forward a
 * month at a time once it has passed; without one, the calendar month. Start is the first day counted, end the last.
 */
export function cycleWindow(cycleEnd: string | null, today: string): { start: string; end: string; known: boolean } {
    if (!cycleEnd) {
        const [y, m] = today.split('-').map(Number);
        return { start: `${today.slice(0, 7)}-01`, end: iso(new Date(Date.UTC(y, m, 0))), known: false };
    }
    let end = cycleEnd, guard = 0;
    while (end < today && guard++ < 240) end = addMonths(end, 1);
    while (addMonths(end, -1) >= today && guard++ < 480) end = addMonths(end, -1);
    const prev = addMonths(end, -1);
    const [y, m, d] = prev.split('-').map(Number);
    return { start: iso(new Date(Date.UTC(y, m - 1, d + 1))), end, known: true };
}

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

export function costView(rows: Array<Pick<TurnRow, 'created_at' | 'key_slot' | 'cost_usd' | 'model' | 'skill_id'>>, settings: BrainSettings, keys: KeyView[], now: Date): CostView {
    const today = indiaDay(now);
    const keyCosts: KeyCost[] = keys.map(k => {
        const slot = k.slot as 1 | 2;
        const w = cycleWindow(settings.keys.cycleEnd[`k${slot}`] ?? null, today);
        const mine = rows.filter(r => r.key_slot === k.slot && indiaDay(r.created_at) >= w.start && indiaDay(r.created_at) <= w.end);
        const spent = mine.reduce((n, r) => n + (numOrNull(r.cost_usd) ?? 0), 0);
        const elapsed = Math.max(1, dayNumber(today) - dayNumber(w.start) + 1), length = Math.max(elapsed, dayNumber(w.end) - dayNumber(w.start) + 1);
        return {
            slot: k.slot, name: k.name, set: k.set, resting: k.resting, cycleStart: w.start, cycleEnd: w.end, cycleKnown: w.known,
            creditUsd: settings.keys.monthlyCreditUsd[`k${slot}`] ?? 0, spentUsd: round(spent, 4), projectedUsd: round((spent / elapsed) * length, 4), turns: mine.length,
        };
    });
    const cutoff = indiaDay(new Date(now.getTime() - 29 * 86_400_000));
    const recent = rows.filter(r => indiaDay(r.created_at) >= cutoff);
    const sum = (rs: typeof rows) => round(rs.reduce((n, r) => n + (numOrNull(r.cost_usd) ?? 0), 0), 4);
    const group = <K extends string>(key: (r: (typeof rows)[number]) => K | null) => {
        const m = new Map<K, typeof rows>();
        for (const r of recent) { const k = key(r); if (k !== null) m.set(k, [...(m.get(k) ?? []), r]); }
        return [...m.entries()].map(([k, rs]) => ({ k, costUsd: sum(rs), turns: rs.length }));
    };
    const priced = recent.filter(r => numOrNull(r.cost_usd) !== null);
    return {
        keys: keyCosts,
        last30: { costUsd: sum(recent), turns: recent.length, turnsWithoutCost: recent.filter(r => r.model && numOrNull(r.cost_usd) === null).length, perTurnUsd: priced.length ? round(sum(priced) / priced.length, 6) : null },
        byDay: group(r => indiaDay(r.created_at)).map(x => ({ day: x.k, costUsd: x.costUsd, turns: x.turns })).sort((a, b) => a.day.localeCompare(b.day)),
        byModel: group(r => r.model).map(x => ({ model: x.k, costUsd: x.costUsd, turns: x.turns })).sort((a, b) => b.costUsd - a.costUsd),
        bySkill: group(r => r.skill_id).map(x => ({ skillId: x.k, costUsd: x.costUsd, turns: x.turns })).sort((a, b) => b.costUsd - a.costUsd),
    };
}
