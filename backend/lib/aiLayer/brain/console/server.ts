/**
 * Brain Console: what the screens read and the few things they may change. Server only.
 *
 * Every function here is called AFTER the Tech-team check in the route (requireControlCentre with the organisation's
 * id). Reads use the service-role client, so EVERY query is limited to that organisation in code.
 * Privacy (owner 2026-11-14): rows with a user id never leave this file as they are; they go through view.ts, which
 * drops the user id and the message id and masks the text. The only names returned are the pilot picker's.
 * Writes: the organisation's own brain settings (with a change-log row) and a reviewer's judgement of a turn. Nothing
 * here can run a skill, send a message, or touch a ticket, a booking or a task.
 */
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadActor } from '../../scope';
import { CATALOG } from '@/backend/lib/aiLayer';
import { validateExample } from '@/backend/lib/aiLayer/learning';
import { clearLearningCache } from '@/backend/lib/aiLayer/server';
import { BRAIN_PLATFORM_LIMITS, brainSettingsSchema, parseBrainSettings, roleClass, type BrainSettings } from '../config';
import { GOLDEN_CASES, expectLine } from '../eval/cases';
import lastRun from '../eval/lastRun.json';
import { BRAIN_CLAUDE_KEY_NAMES, keyPoolStatus } from '../providers/anthropic';
import { forgetLearning } from '../server';
import { describeSkills, skillById } from '../skills/registry';
import type { Outcome } from '../types';
import type {
    ConsoleStatus, ConversationSummary, CostView, EvalCaseView, HistoryEntry, KeyView, MemoryView, OtherBotItem, Overview, PersonOption, ReviewView, ScoreModel, ScorecardView,
    SettingsView, ShadowView, SkillView, TurnLabel, TurnView,
} from './types';
import { asRoleClass, conversations, costView, cycleWindow, diffSettings, flagTurns, indiaDay, maskIdentity, overview, refuseAudience, refuseSettingsChange, skillViews, toTurnView, type TurnRow } from './view';

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42703', 'PGRST204']);
const isMissing = (e: { code?: string } | null | undefined) => !!e && MISSING.has(String(e.code ?? ''));
const PAGE = 1000;
/** Ids per .in() filter: keeps the request well inside the URL length a proxy accepts. */
const IN_CHUNK = 100;
const DAY_MS = 86_400_000;

/** The key for person tags. Derived from a server secret, so it exists wherever the console can run and is never sent anywhere. */
export function consoleSecret(env: Record<string, string | undefined> = process.env): string {
    const base = String(env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    if (!base) throw new Error('the console cannot run without the server key');
    return createHmac('sha256', base).update('brain-console/person-tag/v1').digest('hex');
}

// ── Reading turns ─────────────────────────────────────────────────────────────────────────────────────────────────

const COLUMNS = 'id, user_id, channel, shadow, message_id, user_text, reply_text, outcome, reason, skill_id, handoff_to, lang, model, key_slot, tokens_in, tokens_out, cache_read, cost_usd, latency_ms, grounded, had_file, tool_calls, hops, created_at';
/** Columns of ai_brain_turns that arrive with later migrations (3: role_class, 4: learning). A missing one is left out of the read and looked for again after five minutes. */
const LATER_COLUMNS = ['role_class', 'learning'] as const;
const absentColumns = new Map<string, number>();

export interface TurnQuery { from: string; to?: string; shadow?: boolean; detail?: boolean; max?: number }

export async function loadTurns(admin: SupabaseClient, orgId: string, q: TurnQuery): Promise<{ rows: TurnRow[]; truncated: boolean; tableMissing: boolean }> {
    const max = q.max ?? 5000;
    const rows: TurnRow[] = [];
    for (const [col, at] of absentColumns) if (Date.now() - at > 300_000) absentColumns.delete(col);
    for (let offset = 0; offset < max; offset += PAGE) {
        const page = async () => {
            const later = LATER_COLUMNS.filter(c => !absentColumns.has(c)).map(c => `, ${c}`).join('');
            let query = admin.from('ai_brain_turns').select(`${COLUMNS}${q.detail ? ', model_calls' : ''}${later}`).eq('organization_id', orgId).gte('created_at', q.from);
            if (q.to) query = query.lt('created_at', q.to);
            if (q.shadow !== undefined) query = query.eq('shadow', q.shadow);
            return query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + Math.min(PAGE, max - offset) - 1);
        };
        let res = await page();
        for (let tries = 0; res.error && tries < LATER_COLUMNS.length; tries++) {
            const message = res.error.message || '';
            const absent = LATER_COLUMNS.find(c => !absentColumns.has(c) && new RegExp(`\\b${c}\\b`).test(message));
            if (!absent) break;
            absentColumns.set(absent, Date.now());
            res = await page();
        }
        if (res.error) {
            if (isMissing(res.error)) return { rows: [], truncated: false, tableMissing: true };
            throw new Error(res.error.message);
        }
        const got = (res.data || []) as unknown as TurnRow[];
        rows.push(...got);
        if (got.length < PAGE) return { rows, truncated: false, tableMissing: false };
    }
    return { rows, truncated: true, tableMissing: false };
}

interface CaseRow {
    id: string; source_turn_id: string | null; message_text: string; role_class: string; channel: string; verdict: string; got_outcome: string | null; got_skill: string | null;
    expected_outcome: string; expected_skill: string | null; note: string | null; active: boolean; created_at: string;
}

async function loadCases(admin: SupabaseClient, orgId: string): Promise<{ cases: CaseRow[]; missing: boolean }> {
    const { data, error } = await admin.from('ai_brain_eval_cases')
        .select('id, source_turn_id, message_text, role_class, channel, verdict, got_outcome, got_skill, expected_outcome, expected_skill, note, active, created_at')
        .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(2000);
    if (error) { if (isMissing(error)) return { cases: [], missing: true }; throw new Error(error.message); }
    return { cases: (data || []) as CaseRow[], missing: false };
}

const labelsOf = (cases: CaseRow[]): Map<string, TurnLabel> => new Map(cases.filter(c => c.source_turn_id).map(c =>
    [c.source_turn_id as string, { verdict: c.verdict === 'wrong' ? 'wrong' : 'right', expectedOutcome: c.expected_outcome as Outcome, expectedSkill: c.expected_skill, note: c.note }]));

/** Which of today's bots took each WhatsApp message, from the inbound ledger. Best effort: an error means "not recorded". */
async function ledgerRoutes(admin: SupabaseClient, messageIds: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const ids = [...new Set(messageIds)];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data, error } = await admin.from('whatsapp_inbound_ledger').select('message_id, route').in('message_id', ids.slice(i, i + IN_CHUNK));
        if (error) return out;
        for (const r of (data || []) as Array<{ message_id: string; route: string | null }>) out.set(r.message_id, r.route);
    }
    return out;
}

// ── Status and settings ───────────────────────────────────────────────────────────────────────────────────────────

async function settingsRow(admin: SupabaseClient, orgId: string): Promise<{ settings: BrainSettings; raw: unknown; updatedAt: string | null; tableMissing: boolean }> {
    const { data, error } = await admin.from('ai_brain_settings').select('config, updated_at').eq('organization_id', orgId).maybeSingle();
    if (error) {
        if (isMissing(error)) return { settings: parseBrainSettings({ mode: 'off' }), raw: null, updatedAt: null, tableMissing: true };
        throw new Error(error.message);
    }
    return { settings: parseBrainSettings(data?.config ?? { mode: 'off' }), raw: data?.config ?? null, updatedAt: data?.updated_at ?? null, tableMissing: false };
}

/** Is the review table of migration 20261114000003 there? One row at most is read. A real database error is thrown, not read as "missing". */
async function reviewMissing(admin: SupabaseClient, orgId: string): Promise<boolean> {
    const { error } = await admin.from('ai_brain_eval_cases').select('id').eq('organization_id', orgId).limit(1);
    if (!error) return false;
    if (isMissing(error)) return true;
    throw new Error(error.message);
}

/** Is the guidance table of migration 20261114000004 there? One row at most is read. */
async function learningMissing(admin: SupabaseClient, orgId: string): Promise<boolean> {
    const { error } = await admin.from('ai_brain_guidance').select('id').eq('organization_id', orgId).limit(1);
    if (!error) return false;
    if (isMissing(error)) return true;
    throw new Error(error.message);
}

export async function consoleStatus(admin: SupabaseClient, orgId: string, env: Record<string, string | undefined> = process.env): Promise<{ status: ConsoleStatus; settings: BrainSettings }> {
    const [row, missing, noGuidance] = await Promise.all([settingsRow(admin, orgId), reviewMissing(admin, orgId), learningMissing(admin, orgId)]);
    return { status: { tableMissing: row.tableMissing, reviewMissing: missing, learningMissing: noGuidance, killSwitch: env.AI_BRAIN_DISABLED === 'true', mode: row.settings.mode }, settings: row.settings };
}

export function keyViews(env: Record<string, string | undefined> = process.env): KeyView[] {
    const resting = keyPoolStatus();
    return BRAIN_CLAUDE_KEY_NAMES.map((name, i) => {
        const rest = resting.find(r => r.slot === i + 1);
        return { slot: i + 1, name, set: !!String(env[name] ?? '').trim(), resting: rest ? { why: rest.why, minutesLeft: rest.minutesLeft } : null };
    });
}

/** Everyone with an active membership in this organisation: the pilot picker. Name and role only; no email, no phone. */
async function people(admin: SupabaseClient, orgId: string): Promise<PersonOption[]> {
    const props = await admin.from('properties').select('id').eq('organization_id', orgId).limit(2000);
    if (props.error) throw new Error(props.error.message);
    const propertyIds = ((props.data || []) as Array<{ id: string }>).map(p => p.id);
    const orgs = await admin.from('organization_memberships').select('user_id, role').eq('organization_id', orgId).eq('is_active', true).limit(5000);
    if (orgs.error) throw new Error(orgs.error.message);
    // Long id lists go in pieces: one request with hundreds of ids is refused for its length, which would silently drop people.
    const pms: Array<{ user_id: string; role: string | null }> = [];
    for (let i = 0; i < propertyIds.length; i += IN_CHUNK) {
        const { data, error } = await admin.from('property_memberships').select('user_id, role').in('property_id', propertyIds.slice(i, i + IN_CHUNK)).eq('is_active', true).limit(5000);
        if (error) throw new Error(error.message);
        pms.push(...((data || []) as typeof pms));
    }
    const roles = new Map<string, Set<string>>();
    const tech = new Set<string>();
    for (const m of (orgs.data || []) as Array<{ user_id: string; role: string | null }>) {
        if (!m.user_id) continue;
        roles.set(m.user_id, (roles.get(m.user_id) ?? new Set()).add(String(m.role ?? 'member')));
        if (m.role === 'tech') tech.add(m.user_id);
    }
    for (const m of pms) {
        if (!m.user_id) continue;
        roles.set(m.user_id, (roles.get(m.user_id) ?? new Set()).add(String(m.role ?? 'member')));
    }
    const ids = [...roles.keys()];
    const names = new Map<string, string>();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data, error } = await admin.from('users').select('id, full_name').in('id', ids.slice(i, i + IN_CHUNK));
        if (error) throw new Error(error.message);
        for (const u of (data || []) as Array<{ id: string; full_name: string | null }>) names.set(u.id, (u.full_name || '').trim());
    }
    return ids.map(id => ({ id, name: names.get(id) || 'Unnamed member', role: [...(roles.get(id) ?? [])].sort().join(', '), isTech: tech.has(id) }))
        .sort((a, b) => Number(b.isTech) - Number(a.isTech) || a.name.localeCompare(b.name));
}

async function history(admin: SupabaseClient, orgId: string): Promise<HistoryEntry[]> {
    const { data, error } = await admin.from('ai_brain_settings_history').select('changed_by, before, after, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(30);
    if (error) return [];
    const rows = (data || []) as Array<{ changed_by: string | null; before: unknown; after: unknown; created_at: string }>;
    const ids = [...new Set(rows.map(r => r.changed_by).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (ids.length) {
        const users = await admin.from('users').select('id, full_name').in('id', ids);
        for (const u of (users.data || []) as Array<{ id: string; full_name: string | null }>) names.set(u.id, (u.full_name || '').trim());
    }
    // The change log names the Tech member who changed a switch (an administrator's action), never a person who chatted.
    return rows.map(r => ({ at: r.created_at, by: (r.changed_by && names.get(r.changed_by)) || 'A Tech team member', changes: diffSettings(parseBrainSettings(r.before ?? { mode: 'off' }), parseBrainSettings(r.after)) }))
        .filter(h => h.changes.length);
}

export async function settingsView(admin: SupabaseClient, orgId: string): Promise<SettingsView> {
    const row = await settingsRow(admin, orgId);
    const [team, log, chain] = await Promise.all([
        people(admin, orgId),
        row.tableMissing ? Promise.resolve([]) : history(admin, orgId),
        import('@/task-manager/ai/AiModelSettings').then(m => m.chainFor('brain_turn')).catch(() => [] as string[]),
    ]);
    return { settings: row.settings, updatedAt: row.updatedAt, keys: keyViews(), chain, history: log, people: team, ceilings: { ...BRAIN_PLATFORM_LIMITS } };
}

export type SaveResult = { ok: true } | { ok: false; status: 400 | 409 | 503; error: string };

/**
 * Saves the organisation's brain settings. The whole object is validated again here (the browser is not trusted), a
 * write skill cannot jump from off to live, the people chosen must be members of THIS organisation, and a save based
 * on an older copy is refused instead of overwriting someone else's change. Every save adds a change-log row.
 */
export async function saveSettings(admin: SupabaseClient, orgId: string, changedBy: string, body: { settings?: unknown; updatedAt?: unknown }): Promise<SaveResult> {
    const parsed = brainSettingsSchema.safeParse(body.settings);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { ok: false, status: 400, error: `That setting is not valid${issue ? ` (${issue.path.join(' → ') || 'settings'}: ${issue.message})` : ''}. Nothing was saved.` };
    }
    const next = parsed.data;
    const row = await settingsRow(admin, orgId);
    if (row.tableMissing) return { ok: false, status: 503, error: 'The brain\'s database tables are not applied yet, so settings cannot be saved.' };
    const basedOn = typeof body.updatedAt === 'string' ? body.updatedAt : null;
    if ((row.updatedAt ?? null) !== basedOn && !(row.updatedAt && basedOn && Date.parse(row.updatedAt) === Date.parse(basedOn))) {
        return { ok: false, status: 409, error: 'Someone else changed these settings while you were editing. Reload to see their change, then make yours again.' };
    }
    const refuse = refuseSettingsChange(row.settings, next);
    if (refuse) return { ok: false, status: 400, error: refuse };

    if (!diffSettings(row.settings, next).length) return { ok: true };

    const members = await people(admin, orgId);
    const known = new Set(members.map(p => p.id));
    const chosen = [...new Set([...next.pilotUserIds, ...next.blockedUserIds])];
    const added = chosen.filter(id => !row.settings.pilotUserIds.includes(id) && !row.settings.blockedUserIds.includes(id));
    const strangers = added.filter(id => !known.has(id)).length;
    if (strangers) return { ok: false, status: 400, error: `${strangers} of the people you added are not active members of this organisation. Nothing was saved.` };
    const tooFew = refuseAudience(next, members);
    if (tooFew) return { ok: false, status: 400, error: tooFew };

    // The change-log row is written FIRST and removed again if the save does not go through: a setting can never be
    // in force without its log row (the other order could lose the row on exactly the save someone later asks about).
    const logId = crypto.randomUUID();
    const log = await admin.from('ai_brain_settings_history').insert({ id: logId, organization_id: orgId, changed_by: changedBy, before: row.raw, after: next });
    if (log.error) throw new Error(`change log: ${log.error.message}`);
    const undoLog = async () => {
        const gone = await admin.from('ai_brain_settings_history').delete().eq('id', logId).eq('organization_id', orgId);
        if (gone.error) console.error('[BrainConsole] a change-log row for a save that did not happen could not be removed:', gone.error.message);
    };
    const conflict: SaveResult = { ok: false, status: 409, error: 'Someone else changed these settings while you were editing. Reload to see their change, then make yours again.' };
    const now = new Date().toISOString();
    try {
        if (row.updatedAt) {
            // Only the copy this save was based on is replaced: a save that lost the race changes nothing.
            const { data, error } = await admin.from('ai_brain_settings').update({ config: next, updated_by: changedBy, updated_at: now })
                .eq('organization_id', orgId).eq('updated_at', row.updatedAt).select('organization_id');
            if (error) throw new Error(error.message);
            if (!(data || []).length) { await undoLog(); return conflict; }
        } else {
            const { error } = await admin.from('ai_brain_settings').insert({ organization_id: orgId, config: next, updated_by: changedBy, updated_at: now });
            if (error) {
                if (String(error.code) === '23505') { await undoLog(); return conflict; }
                throw new Error(error.message);
            }
        }
    } catch (err) {
        await undoLog();
        throw err;
    }
    return { ok: true };
}

// ── Screens ───────────────────────────────────────────────────────────────────────────────────────────────────────

const sinceDays = (days: number, now = new Date()) => new Date(now.getTime() - days * DAY_MS).toISOString();
export const clampDays = (v: unknown, fallback = 7): number => ([1, 7, 30].includes(Number(v)) ? Number(v) : fallback);

interface Loaded { rows: TurnRow[]; views: TurnView[]; truncated: boolean; cases: CaseRow[] }

async function loadViews(admin: SupabaseClient, orgId: string, q: TurnQuery, o: { detail?: boolean; routes?: boolean } = {}): Promise<Loaded> {
    const [{ rows, truncated }, cases] = await Promise.all([loadTurns(admin, orgId, { ...q, detail: o.detail }), loadCases(admin, orgId).catch(() => ({ cases: [] as CaseRow[], missing: true }))]);
    const flags = flagTurns(rows);
    const routes = o.routes ? await ledgerRoutes(admin, rows.filter(r => r.shadow && r.message_id).map(r => r.message_id as string)) : undefined;
    const secret = consoleSecret();
    const labels = labelsOf(cases.cases);
    return { rows, truncated, cases: cases.cases, views: rows.map(r => toTurnView(r, { secret, orgId, flags, labels, routes, detail: o.detail })) };
}

export async function overviewView(admin: SupabaseClient, orgId: string, days: number): Promise<Overview> {
    const { rows, views, truncated } = await loadViews(admin, orgId, { from: sinceDays(days) });
    return overview(rows, views, days, truncated);
}

export async function conversationsView(admin: SupabaseClient, orgId: string, days: number, shadow: boolean, flaggedOnly: boolean): Promise<ConversationSummary[]> {
    const { views } = await loadViews(admin, orgId, { from: sinceDays(days), shadow });
    const all = conversations(views);
    return (flaggedOnly ? all.filter(c => c.flagged > 0) : all).slice(0, 300);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_RE = /^[A-Z0-9]{6}$/;

/** One person's turns on one India day. The tag is checked against every turn of that day; it cannot be reversed. */
export async function conversationView(admin: SupabaseClient, orgId: string, person: string, day: string, shadow: boolean): Promise<TurnView[] | null> {
    if (!DAY_RE.test(day) || !TAG_RE.test(person)) return null;
    // The India day starts at 18:30 UTC the evening before. Ten more minutes are read so a "no, I meant…" just after midnight still flags the turn before it.
    const start = new Date(`${day}T00:00:00+05:30`);
    if (Number.isNaN(start.getTime())) return null;
    const { views } = await loadViews(admin, orgId, { from: start.toISOString(), to: new Date(start.getTime() + DAY_MS + 600_000).toISOString(), shadow }, { detail: true, routes: shadow });
    return views.filter(v => v.person === person && v.day === day).sort((a, b) => a.at.localeCompare(b.at));
}

export async function shadowView(admin: SupabaseClient, orgId: string, days: number): Promise<ShadowView> {
    const { views } = await loadViews(admin, orgId, { from: sinceDays(days), shadow: true, max: 2000 }, { detail: true, routes: true });
    return {
        days,
        totals: {
            turns: views.length,
            wouldAnswer: views.filter(v => v.outcome === 'answer' || v.outcome === 'ask').length,
            wouldAct: views.filter(v => v.outcome === 'propose').length,
            wouldHandOff: views.filter(v => v.outcome === 'handoff').length,
            right: views.filter(v => v.label?.verdict === 'right').length,
            wrong: views.filter(v => v.label?.verdict === 'wrong').length,
            unlabelled: views.filter(v => !v.label).length,
        },
        turns: views.slice(0, 200),
    };
}

export async function skillsView(admin: SupabaseClient, orgId: string, settings: BrainSettings): Promise<SkillView[]> {
    const { rows } = await loadTurns(admin, orgId, { from: sinceDays(30) });
    return skillViews(settings, rows);
}

export async function memoryView(admin: SupabaseClient, orgId: string, settings: BrainSettings): Promise<MemoryView> {
    const empty = { enabled: settings.memory.enabled, profileDays: settings.memory.profileDays, episodeDays: settings.memory.episodeDays };
    const facts = await admin.from('ai_brain_memory').select('user_id, key, label').eq('organization_id', orgId).limit(10_000);
    if (facts.error) {
        if (isMissing(facts.error)) return { ...empty, people: 0, facts: [], episodes: { total: 0, last7Days: 0, bySkill: [] } };
        throw new Error(facts.error.message);
    }
    const rows = (facts.data || []) as Array<{ user_id: string; key: string; label: string }>;
    const byKey = new Map<string, { label: string; count: number }>();
    for (const r of rows) byKey.set(r.key, { label: r.label, count: (byKey.get(r.key)?.count ?? 0) + 1 });
    const eps = await admin.from('ai_brain_episodes').select('skill_id, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(10_000);
    const episodes = (eps.error ? [] : eps.data || []) as Array<{ skill_id: string; created_at: string }>;
    const weekAgo = sinceDays(7);
    const bySkill = new Map<string, number>();
    for (const e of episodes) bySkill.set(e.skill_id, (bySkill.get(e.skill_id) ?? 0) + 1);
    return {
        ...empty,
        // A count of people, never a list: nobody's memory is shown in the console.
        people: new Set(rows.map(r => r.user_id)).size,
        facts: [...byKey.entries()].map(([key, v]) => ({ key, label: v.label, count: v.count })).sort((a, b) => b.count - a.count),
        episodes: { total: episodes.length, last7Days: episodes.filter(e => e.created_at >= weekAgo).length, bySkill: [...bySkill.entries()].map(([skillId, count]) => ({ skillId, count })).sort((a, b) => b.count - a.count) },
    };
}

export async function costViewFor(admin: SupabaseClient, orgId: string, settings: BrainSettings, now = new Date()): Promise<CostView> {
    const keys = keyViews();
    const today = indiaDay(now);
    const starts = keys.map(k => cycleWindow(settings.keys.cycleEnd[`k${k.slot as 1 | 2}`] ?? null, today).start);
    const earliest = [...starts, indiaDay(new Date(now.getTime() - 30 * DAY_MS))].sort()[0];
    const from = new Date(`${earliest}T00:00:00+05:30`).toISOString();
    const rows: Array<Pick<TurnRow, 'created_at' | 'key_slot' | 'cost_usd' | 'model' | 'skill_id'>> = [];
    for (let offset = 0; offset < 50_000; offset += PAGE) {
        const { data, error } = await admin.from('ai_brain_turns').select('created_at, key_slot, cost_usd, model, skill_id').eq('organization_id', orgId).gte('created_at', from)
            .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGE - 1);
        if (error) { if (isMissing(error)) break; throw new Error(error.message); }
        rows.push(...((data || []) as typeof rows));
        if ((data || []).length < PAGE) break;
    }
    return costView(rows, settings, keys, now);
}

interface LastRun { ranAt: string | null; grader: { model: string; audited: number; auditedAgree: number } | null; models: ScoreModel[] }

export function scorecardView(): ScorecardView {
    const run = lastRun as unknown as LastRun;
    return {
        ranAt: run.ranAt ?? null, grader: run.grader ?? null, models: run.models ?? [],
        golden: GOLDEN_CASES.map(c => ({ id: c.id, group: c.group, role: c.role, text: c.text || (c.photo ? '(a photo with no words)' : ''), expect: expectLine(c) })),
    };
}

// ── Review: the learning loop ─────────────────────────────────────────────────────────────────────────────────────

/** What a reviewer may pick as the right ending of a turn. */
export const REVIEW_OUTCOMES: readonly Outcome[] = ['answer', 'ask', 'propose', 'executed', 'cancelled', 'handoff', 'refuse'];

const toCaseView = (c: CaseRow): EvalCaseView => ({
    id: c.id, text: c.message_text, role: asRoleClass(c.role_class) ?? 'staff', channel: c.channel === 'app_chat' ? 'app_chat' : 'whatsapp', verdict: c.verdict === 'wrong' ? 'wrong' : 'right',
    gotOutcome: c.got_outcome, gotSkill: c.got_skill, expectedOutcome: c.expected_outcome as Outcome, expectedSkill: c.expected_skill, note: c.note, active: !!c.active, at: c.created_at,
});

const OTHER_REASON: Record<string, string> = {
    unknown: 'The assistant did not understand the message.',
    repeated_clarify: 'The assistant asked two questions in a row.',
    too_many_questions: 'The assistant asked too many questions.',
    apology: 'The assistant apologised.',
    correction: 'The person\'s next message corrected it ("no", "wrong", "I meant ...").',
    undo: 'The person undid what the assistant did.',
    rephrase: 'The person asked for the same thing again.',
};
const reasons = (triggers: unknown): string[] => (Array.isArray(triggers) ? triggers : []).map(t => OTHER_REASON[String(t)]).filter((x): x is string => !!x);

/** What a reviewer may teach the older AI assistant: the same list as that assistant's own learning screen offers. */
export function aiAnswers(): ReviewView['aiAnswers'] {
    return [
        ...CATALOG.map(e => ({ id: e.id, kind: String(e.kind), label: e.abilities.en })),
        { id: 'tasks', kind: 'special', label: 'about tasks (send to Task Manager)' },
        { id: 'none', kind: 'special', label: "nothing (the AI should say it can't help)" },
    ];
}

/**
 * The flagged messages of the older AI assistant. Only the words, the reasons and the state are read: never the user
 * id, which says who the person is. Best effort: a missing table or an error shows nothing.
 *
 * The Task Manager's flagged messages are no longer listed here (2026-11-15): its whole review panel is shown in the
 * Review screen, served by its own Tech-only API (app/api/task-manager/bot-learning), which strips who sent a message.
 */
async function otherBotItems(admin: SupabaseClient, orgId: string): Promise<OtherBotItem[]> {
    const out: OtherBotItem[] = [];
    try {
        const ai = await admin.from('ai_review_items').select('id, message_text, follow_up_text, bot_reply, entry_id, triggers, status, created_at')
            .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(60);
        const state: Record<string, OtherBotItem['state']> = { open: 'waiting', taught: 'judged', ignored: 'ignored' };
        const labels = new Map(aiAnswers().map(a => [a.id, a.label]));
        for (const r of (ai.error ? [] : ai.data || []) as Array<{ id: string; message_text: string | null; follow_up_text: string | null; bot_reply: string | null; entry_id: string | null; triggers: unknown; status: string; created_at: string }>) {
            const text = maskIdentity(r.message_text, 1500);
            if (!text) continue;
            out.push({ id: `ai-${r.id}`, bot: 'ai_assistant', at: r.created_at, chose: r.entry_id ? labels.get(r.entry_id) ?? r.entry_id : null, text, reply: maskIdentity(r.bot_reply, 2000), followUp: maskIdentity(r.follow_up_text, 1500), reasons: reasons(r.triggers), state: state[r.status] ?? 'waiting' });
        }
    } catch { /* that assistant's items are simply not shown */ }
    return out.sort((a, b) => b.at.localeCompare(a.at));
}

export async function reviewView(admin: SupabaseClient, orgId: string, settings: BrainSettings): Promise<ReviewView> {
    const [{ views, cases }, others] = await Promise.all([loadViews(admin, orgId, { from: sinceDays(30), max: 3000 }, { detail: true, routes: true }), otherBotItems(admin, orgId)]);
    return {
        others,
        aiAnswers: aiAnswers(),
        lessonsOn: settings.learning.lessons,
        // A turn whose text is gone cannot be judged, so it is not queued.
        queue: views.filter(v => v.flags.length && !v.label && v.userText).slice(0, 50),
        judged: { right: cases.filter(c => c.verdict === 'right').length, wrong: cases.filter(c => c.verdict === 'wrong').length },
        cases: cases.slice(0, 200).map(toCaseView),
        outcomes: [...REVIEW_OUTCOMES],
        skills: describeSkills().map(s => ({ id: s.id, kind: s.kind })),
    };
}

export type ReviewResult = { ok: true } | { ok: false; status: 400 | 404 | 503; error: string };

/**
 * A Tech reviewer's judgement of one turn. The turn is read again here, inside this organisation; the test case keeps
 * the masked message, the kind of login, and what should have happened. It never keeps who sent the message.
 */
export async function labelTurn(admin: SupabaseClient, orgId: string, reviewerId: string, body: { turnId?: unknown; verdict?: unknown; expectedOutcome?: unknown; expectedSkill?: unknown; note?: unknown }): Promise<ReviewResult> {
    const turnId = typeof body.turnId === 'string' ? body.turnId : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(turnId)) return { ok: false, status: 400, error: 'That turn could not be found.' };
    if (body.verdict !== 'right' && body.verdict !== 'wrong') return { ok: false, status: 400, error: 'Say whether the answer was right or wrong.' };

    const read = async (withRole: boolean) => admin.from('ai_brain_turns')
        .select(`id, user_id, channel, user_text, outcome, skill_id, reason${withRole ? ', role_class' : ''}`).eq('id', turnId).eq('organization_id', orgId).maybeSingle();
    let got = await read(true);
    if (got.error && /role_class/.test(got.error.message || '')) got = await read(false);
    if (got.error) { if (isMissing(got.error)) return { ok: false, status: 503, error: 'The brain\'s database tables are not applied yet.' }; throw new Error(got.error.message); }
    const turn = got.data as unknown as { id: string; user_id: string | null; channel: string; user_text: string | null; outcome: string; skill_id: string | null; reason: string | null; role_class?: string | null } | null;
    if (!turn) return { ok: false, status: 404, error: 'That turn could not be found.' };
    const text = turn.reason === 'hr_matter' ? null : maskIdentity(turn.user_text, 1500);
    if (!text?.trim()) return { ok: false, status: 400, error: 'The words of this message are no longer kept, so it cannot become a test case.' };

    let role = asRoleClass(turn.role_class);
    if (!role && turn.user_id) {
        const actor = await loadActor(admin, turn.user_id, orgId).catch(() => null);
        role = actor ? roleClass(actor) : null;
    }
    if (!role) return { ok: false, status: 400, error: 'The kind of login behind this message can no longer be worked out, so it cannot become a test case.' };

    let expectedOutcome = turn.outcome, expectedSkill = turn.skill_id;
    if (body.verdict === 'wrong') {
        if (typeof body.expectedOutcome !== 'string' || !REVIEW_OUTCOMES.includes(body.expectedOutcome as Outcome)) return { ok: false, status: 400, error: 'Choose what should have happened.' };
        if (body.expectedSkill !== null && body.expectedSkill !== undefined && (typeof body.expectedSkill !== 'string' || !skillById(body.expectedSkill))) return { ok: false, status: 400, error: 'That skill does not exist.' };
        expectedOutcome = body.expectedOutcome;
        expectedSkill = typeof body.expectedSkill === 'string' ? body.expectedSkill : null;
    }
    const note = typeof body.note === 'string' && body.note.trim() ? maskIdentity(body.note.trim(), 500) : null;

    const { error } = await admin.from('ai_brain_eval_cases').upsert({
        organization_id: orgId, source_turn_id: turn.id, message_text: text, role_class: role, channel: turn.channel === 'app_chat' ? 'app_chat' : 'whatsapp',
        verdict: body.verdict, got_outcome: turn.outcome, got_skill: turn.skill_id, expected_outcome: expectedOutcome, expected_skill: expectedSkill, note,
        active: true, created_by: reviewerId, updated_at: new Date().toISOString(),
    }, { onConflict: 'source_turn_id' });
    if (error) {
        if (isMissing(error)) return { ok: false, status: 503, error: 'Judging is not available yet: migration 20261114000003 has not been applied.' };
        throw new Error(error.message);
    }
    forgetLearning(orgId);
    return { ok: true };
}

const AI_ITEM = /^ai-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * A Tech reviewer's judgement of a message the older AI assistant got wrong (owner 2026-11-15: one place to judge).
 * It does what that assistant's own learning screen does, with the same check of the answer (validateExample):
 *   teach  → the message becomes an example for the AI assistant of this organisation, and the item is closed;
 *   ignore → the item is closed and nothing is taught.
 * The item is read and closed inside this organisation only, and closed only if it is still open, so two reviewers
 * cannot teach the same message twice. If the example cannot be saved the item is opened again.
 */
export async function judgeAiItem(admin: SupabaseClient, orgId: string, reviewerId: string, body: { id?: unknown; verdict?: unknown; entryId?: unknown; fields?: unknown }): Promise<ReviewResult> {
    const id = typeof body.id === 'string' ? AI_ITEM.exec(body.id)?.[1] : undefined;
    const NOT_FOUND: ReviewResult = { ok: false, status: 404, error: 'That flagged message could not be found.' };
    if (!id) return NOT_FOUND;
    if (body.verdict !== 'teach' && body.verdict !== 'ignore') return { ok: false, status: 400, error: 'Choose the right answer, or ignore the message.' };
    let entryId = '', fields: Record<string, unknown> = {};
    if (body.verdict === 'teach') {
        if (typeof body.entryId !== 'string' || !body.entryId || body.entryId.length > 64) return { ok: false, status: 400, error: 'Choose what the right answer was.' };
        const checked = validateExample(body.entryId, body.fields ?? {});
        if (!checked.ok) return { ok: false, status: 400, error: checked.error };
        entryId = body.entryId; fields = checked.fields;
    }
    const NOT_APPLIED: ReviewResult = { ok: false, status: 503, error: "The AI assistant's review tables are not applied yet." };

    const read = await admin.from('ai_review_items').select('id, message_text, status, expires_at').eq('id', id).eq('organization_id', orgId).maybeSingle();
    if (read.error) { if (isMissing(read.error)) return NOT_APPLIED; throw new Error(read.error.message); }
    const item = read.data as { id: string; message_text: string | null; status: string; expires_at: string | null } | null;
    if (!item) return NOT_FOUND;
    if (item.status !== 'open') return { ok: false, status: 400, error: 'Someone has judged this message already.' };
    // Kept as they are now, so the item can be put back exactly if the example cannot be saved.
    const words = String(item.message_text ?? ''), expiresAt = item.expires_at;

    const now = new Date();
    const closed = await admin.from('ai_review_items')
        .update({ status: body.verdict === 'teach' ? 'taught' : 'ignored', resolved_by: reviewerId, resolved_at: now.toISOString(), ...(body.verdict === 'teach' ? { expires_at: new Date(now.getTime() + 365 * DAY_MS).toISOString() } : {}) })
        .eq('id', id).eq('organization_id', orgId).eq('status', 'open').select('id');
    if (closed.error) throw new Error(closed.error.message);
    if (!(closed.data || []).length) return { ok: false, status: 400, error: 'Someone has judged this message already.' };
    if (body.verdict === 'ignore') return { ok: true };

    const saved = await admin.from('ai_examples').insert({ organization_id: orgId, message_text: words, entry_id: entryId, fields, source_review_id: id, created_by: reviewerId });
    if (saved.error) {
        await admin.from('ai_review_items').update({ status: 'open', resolved_by: null, resolved_at: null, expires_at: expiresAt }).eq('id', id).eq('organization_id', orgId).eq('status', 'taught');
        if (isMissing(saved.error)) return NOT_APPLIED;
        throw new Error(saved.error.message);
    }
    clearLearningCache(orgId);
    return { ok: true };
}

export async function setCaseActive(admin: SupabaseClient, orgId: string, body: { caseId?: unknown; active?: unknown }): Promise<ReviewResult> {
    if (typeof body.caseId !== 'string' || typeof body.active !== 'boolean') return { ok: false, status: 400, error: 'That test case could not be found.' };
    const { data, error } = await admin.from('ai_brain_eval_cases').update({ active: body.active, updated_at: new Date().toISOString() }).eq('id', body.caseId).eq('organization_id', orgId).select('id');
    if (error) {
        if (isMissing(error)) return { ok: false, status: 503, error: 'Judging is not available yet: migration 20261114000003 has not been applied.' };
        if (String(error.code) === '22P02') return { ok: false, status: 404, error: 'That test case could not be found.' };
        throw new Error(error.message);
    }
    forgetLearning(orgId);
    return (data || []).length ? { ok: true } : { ok: false, status: 404, error: 'That test case could not be found.' };
}
