/**
 * Ticket sorting rules (owner 2026-11-19): the database side and the run. Server only; every read and write is limited
 * to one organisation in code (service-role client). Tables: migration 20261119000002 (ticket_sort_rule_versions,
 * ticket_sort_rule_runs). Until it is applied, no rules are used and the screen says so.
 *
 * A run: draft (one model call; or a person's own rules) → test, in batches that can stop and carry on (each batch takes
 * a lease, so two workers never test the same run) → offered when it passes, or "not offered" with the reason.
 * Who starts a run: the daily job (/api/cron/ticket-rules, once a day per organisation, only when there are new
 * corrections), the "Suggest rules now" button, or a person testing rules they wrote. The 15-minute housekeeping
 * carries on any run that was cut short.
 * Nothing here makes a rule live: only approveRules (a person) does.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { categoryOptionsFrom, classifyWithAi, type AiDeps, type CategoryOption } from './aiClassifier';
import { isMissing, learningSetting } from './sortLearningStore';
import {
    cleanRules, draftUser, DRAFT_SYSTEM, MAX_FIX_CASES, MAX_TEST_CASES, parseRulesText, rulesText, testSummary,
    type DraftInput, type RuleItem, type TestCase, type TestResult, type TestSummary,
} from './sortRules';

type Row = Record<string, unknown>;
const DAY_MS = 86_400_000;
const IST_MS = 5.5 * 3_600_000;
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);
const IN_CHUNK = 100;
/** Corrections the drafter is shown: the newest, from the last 90 days. */
const DRAFT_INPUTS = 80;
const DRAFT_DAYS = 90;
const PARALLEL = 6;
/** The daily job starts a new run from this hour, India time (the cron runs at 02:45). */
const DAILY_FROM_HOUR = 2;
const LEASE_EXTRA_MS = 30_000;

async function adminOf(admin?: SupabaseClient): Promise<SupabaseClient> {
    if (admin) return admin;
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    return supabaseAdmin;
}

export const istDay = (now: Date) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
export const istHour = (now: Date) => new Date(now.getTime() + IST_MS).getUTCHours();

// ── the rules in use ────────────────────────────────────────────────────────────────────────────────────────────────

const activeCache = new Map<string, { at: number; text: string | null }>();
const ACTIVE_MS = 60_000;
const ACTIVE_READ_MS = 1_500;

/** The approved rules of the organisation (null: none). Read at most once a minute; slow or unreadable = none. */
export async function activeRulesText(orgId: string | null | undefined, admin?: SupabaseClient): Promise<string | null> {
    if (!orgId) return null;
    const hit = activeCache.get(orgId);
    if (hit && Date.now() - hit.at < ACTIVE_MS) return hit.text;
    let text: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const read = (async () => {
            const db = await adminOf(admin);
            const { data, error } = await db.from('ticket_sort_rule_versions').select('rules_text').eq('organization_id', orgId).eq('status', 'active').limit(1).maybeSingle();
            if (error) { if (!isMissing(error)) console.warn('[TicketRules] rules unreadable, none used:', error.message); return null; }
            return str((data as Row | null)?.rules_text);
        })();
        text = await Promise.race([read, new Promise<null>(ok => { timer = setTimeout(() => ok(null), ACTIVE_READ_MS); })]);
    } catch (err) {
        console.warn('[TicketRules] rules unreadable, none used:', err instanceof Error ? err.message : err);
    } finally { if (timer) clearTimeout(timer); }
    activeCache.set(orgId, { at: Date.now(), text });
    return text;
}
export const forgetRules = (orgId: string) => { activeCache.delete(orgId); };

// ── what the drafter and the test use ───────────────────────────────────────────────────────────────────────────────

interface Known { id: string; ticketId: string | null; propertyId: string | null; text: string; code: string; source: string; at: string }

async function knownTickets(db: SupabaseClient, orgId: string): Promise<{ list: Known[]; missing: boolean }> {
    const { data, error } = await db.from('ticket_sort_examples').select('id, ticket_id, property_id, ticket_text, code, source, created_at')
        .eq('organization_id', orgId).is('retired_at', null).order('created_at', { ascending: false }).limit(2000);
    if (error) { if (isMissing(error)) return { list: [], missing: true }; throw new Error(error.message); }
    return { list: ((data ?? []) as Row[]).filter(r => str(r.code) && str(r.ticket_text)).map(r => ({ id: String(r.id), ticketId: str(r.ticket_id), propertyId: str(r.property_id), text: String(r.ticket_text), code: String(r.code), source: String(r.source), at: String(r.created_at) })), missing: false };
}

/** What the AI had chosen for each corrected ticket (the judgement says; for an Override, the category before it). */
async function whatAiChose(db: SupabaseClient, orgId: string, ticketIds: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const catCode = new Map<string, string>();
    for (let i = 0; i < ticketIds.length; i += IN_CHUNK) {
        const part = ticketIds.slice(i, i + IN_CHUNK);
        const rv = await db.from('ticket_sort_reviews').select('ticket_id, chosen_code').eq('organization_id', orgId).in('ticket_id', part);
        for (const r of (rv.data ?? []) as Row[]) out.set(String(r.ticket_id), str(r.chosen_code));
        const missing = part.filter(id => !out.has(id));
        if (!missing.length) continue;
        const logs = await db.from('ticket_activity_log').select('ticket_id, old_value, created_at').eq('action', 'classification_override').in('ticket_id', missing).order('created_at', { ascending: true });
        const first = new Map<string, string | null>();
        for (const l of (logs.data ?? []) as Row[]) if (!first.has(String(l.ticket_id))) first.set(String(l.ticket_id), str(l.old_value));
        const ids = [...new Set([...first.values()].filter(Boolean) as string[])].filter(id => !catCode.has(id));
        if (ids.length) {
            const cats = await db.from('issue_categories').select('id, code').in('id', ids);
            for (const c of (cats.data ?? []) as Row[]) catCode.set(String(c.id), String(c.code));
        }
        for (const [t, cat] of first) out.set(t, cat ? catCode.get(cat) ?? null : null);
    }
    return out;
}

async function categoryRows(db: SupabaseClient): Promise<Row[]> {
    const { data, error } = await db.from('issue_categories').select('id, code, name, priority, is_active, property_id, skill_group:skill_groups(code)').limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
}

/** For tests: everything a run calls, handed in. */
export interface RulesDeps {
    /** The drafting model call: returns the model's raw text and which model answered. */
    draft?: (system: string, user: string) => Promise<{ text: string; model: string }>;
    /** The sorting deps used by the test (the "Sorting new tickets" chain by default). */
    sort?: AiDeps;
    now?: () => Date;
}

async function draftWithModel(system: string, user: string): Promise<{ text: string; model: string }> {
    const [{ chainFor }, { engyBrainLlm, withModelFallback }] = await Promise.all([import('@/task-manager/ai/AiModelSettings'), import('@/task-manager/brain/llm')]);
    const chain = await chainFor('ticket_rules_draft');
    const llm = engyBrainLlm({ timeoutMs: 90_000 });
    const { value } = await withModelFallback(chain, async model => {
        const res = await llm.complete({ model, system, user, maxTokens: 3000, json: true });
        if (!res.text.trim()) throw new Error('empty answer');
        return { text: res.text, model };
    }, 'ticket rules drafting');
    return value;
}

function jsonOf(text: string): unknown {
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : text);
}

// ── a run ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Trigger = 'daily' | 'button' | 'person';
interface RunState {
    rules: RuleItem[];
    rulesText: string;
    currentText: string | null;
    summary: string | null;
    model: string | null;
    sources: Record<string, { text: string; code: string }>;
    cases: Array<TestCase & { propertyId: string | null }>;
    results: TestResult[];
    index: number;
    requireFix: boolean;
}

export type StartResult = { ok: true; runId: string | null; message: string } | { ok: false; status: number; error: string };

/**
 * Starts a run: drafts rules (or takes a person's), picks the test tickets and saves it as "testing". Refused while
 * another run of the organisation is testing. A daily run is recorded once per India-time day.
 */
export async function startRulesRun(orgId: string, trigger: Trigger, o: { admin?: SupabaseClient; by?: string | null; ownText?: string; deps?: RulesDeps } = {}): Promise<StartResult> {
    const db = await adminOf(o.admin);
    const now = o.deps?.now?.() ?? new Date();
    const busy = await db.from('ticket_sort_rule_runs').select('id').eq('organization_id', orgId).eq('status', 'testing').limit(1);
    if (busy.error) { if (isMissing(busy.error)) return { ok: false, status: 503, error: 'Sorting rules need migration 20261119000002 to be applied.' }; throw new Error(busy.error.message); }
    if ((busy.data ?? []).length) return { ok: false, status: 409, error: 'Rules are already being tested. Wait for that to finish.' };

    const record = async (status: string, message: string, extra: Row = {}) => {
        const { data, error } = await db.from('ticket_sort_rule_runs').insert({ organization_id: orgId, trigger, day: istDay(now), status, message: message.slice(0, 500), started_by: o.by ?? null, ...extra }).select('id').single();
        if (error) {
            if (String(error.code) === '23505') return null;   // a daily run already recorded today
            throw new Error(error.message);
        }
        return String((data as Row).id);
    };

    const known = await knownTickets(db, orgId);
    if (known.missing) return { ok: false, status: 503, error: 'Sorting rules need learning examples (migration 20261119000001) first.' };
    const since = new Date(now.getTime() - DRAFT_DAYS * DAY_MS).toISOString();
    const corrections = known.list.filter(k => (k.source === 'judged_wrong' || k.source === 'override') && k.at >= since).slice(0, DRAFT_INPUTS);
    const current = await db.from('ticket_sort_rule_versions').select('rules_text').eq('organization_id', orgId).eq('status', 'active').limit(1).maybeSingle();
    const currentText = str((current.data as Row | null)?.rules_text);

    // Daily: only when there is something new since the last run.
    if (trigger === 'daily') {
        const last = await db.from('ticket_sort_rule_runs').select('created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        const lastAt = str((last.data as Row | null)?.created_at);
        if (lastAt && !corrections.some(c => c.at > lastAt)) {
            const id = await record('no_change', 'No new corrections since the last run, so nothing new to learn.');
            return { ok: true, runId: id, message: 'Nothing new to learn.' };
        }
    }

    let rules: RuleItem[];
    let summary: string | null = null;
    let model: string | null = null;
    if (trigger === 'person') {
        const cleaned = cleanRules(parseRulesText(o.ownText ?? ''), { needSources: false });
        if (cleaned.rejected.length) return { ok: false, status: 400, error: `This rule can't be used: "${cleaned.rejected[0].text.slice(0, 80)}" (${cleaned.rejected[0].why}).` };
        if (!cleaned.rules.length) return { ok: false, status: 400, error: 'Write at least one rule.' };
        rules = cleaned.rules;
    } else {
        if (corrections.length < 2) {
            const id = await record('no_change', 'Fewer than 2 corrections in the last 90 days: not enough to find a pattern.');
            return { ok: true, runId: id, message: 'Not enough corrections yet to find a pattern.' };
        }
        const chose = await whatAiChose(db, orgId, corrections.map(c => c.ticketId).filter(Boolean) as string[]);
        const ids = new Map<string, Known>();
        const inputs: DraftInput[] = corrections.map((c, i) => {
            const id = `c${i + 1}`;
            ids.set(id, c);
            return { id, text: c.text, chose: c.ticketId ? chose.get(c.ticketId) ?? null : null, right: c.code, how: c.source === 'override' ? 're-sorted by hand' : 'judged wrong' };
        });
        const options = categoryOptionsFrom(await categoryRows(db) as never, null);
        try {
            const drafted = await (o.deps?.draft ?? draftWithModel)(DRAFT_SYSTEM, draftUser(inputs, options, currentText));
            model = drafted.model;
            const raw = jsonOf(drafted.text) as { rules?: unknown; summary?: unknown };
            const cleaned = cleanRules(raw?.rules, { knownTickets: new Set(ids.keys()), needSources: true });
            summary = typeof raw?.summary === 'string' ? raw.summary.slice(0, 300) : null;
            // Map the drafter's short ids back to the examples they stand for.
            rules = cleaned.rules.map(r => ({ text: r.text, sources: r.sources.map(s => ids.get(s)!.id) }));
            if (!rules.length) {
                const id = await record('no_change', cleaned.rejected.length ? `The AI's rules were not usable (${cleaned.rejected[0].why}).` : 'The AI found no pattern worth a rule.', { model });
                return { ok: true, runId: id, message: 'No usable pattern found this time.' };
            }
        } catch (err) {
            const id = await record('failed', `Drafting failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`);
            return { ok: true, runId: id, message: 'Drafting failed; it will be tried again on the next run.' };
        }
    }

    const text = rulesText(rules);
    if (currentText && parseRulesText(currentText).join('\n').toLowerCase() === parseRulesText(text).join('\n').toLowerCase()) {
        const id = await record('no_change', 'The suggested rules are the same as the ones in use.', { model });
        return { ok: true, runId: id, message: 'The rules in use still hold; nothing to change.' };
    }

    // The test: tickets the rules were written from (do they get fixed?) and tickets they never saw (is anything broken?)
    const cited = new Set(rules.flatMap(r => r.sources));
    const inputIds = new Set(corrections.map(c => c.id));
    const fixPool = trigger === 'person' ? corrections : corrections.filter(c => cited.has(c.id));
    const fix = fixPool.slice(0, MAX_FIX_CASES).map(k => ({ id: k.id, text: k.text, truth: k.code, set: 'fix' as const, propertyId: k.propertyId }));
    const heldOut = known.list.filter(k => !inputIds.has(k.id)).slice(0, MAX_TEST_CASES - fix.length).map(k => ({ id: k.id, text: k.text, truth: k.code, set: 'held_out' as const, propertyId: k.propertyId }));
    const sources: RunState['sources'] = {};
    for (const k of known.list) if (cited.has(k.id)) sources[k.id] = { text: k.text.slice(0, 160), code: k.code };
    const state: RunState = { rules, rulesText: text, currentText, summary, model, sources, cases: [...fix, ...heldOut], results: [], index: 0, requireFix: trigger !== 'person' };
    const id = await record('testing', `Testing ${rules.length} rule(s) on ${state.cases.length} judged tickets.`, { model, state, total: state.cases.length, done: 0 });
    return { ok: true, runId: id, message: `Testing ${rules.length} rule(s) on ${state.cases.length} judged tickets.` };
}

export interface StepResult { runId: string; status: 'testing' | 'offered' | 'not_offered' | 'busy' | 'gone'; done: number; total: number; message: string }

/** Tests the next tickets of a run until `budgetMs` is used, then saves where it got to. Finishes the run at the end. */
export async function continueRulesRun(runId: string, budgetMs: number, o: { admin?: SupabaseClient; orgId?: string; deps?: RulesDeps } = {}): Promise<StepResult> {
    const db = await adminOf(o.admin);
    const started = Date.now();
    const nowIso = new Date().toISOString();
    let lease = db.from('ticket_sort_rule_runs').update({ lease_until: new Date(Date.now() + budgetMs + LEASE_EXTRA_MS).toISOString() })
        .eq('id', runId).eq('status', 'testing').or(`lease_until.is.null,lease_until.lt.${nowIso}`);
    if (o.orgId) lease = lease.eq('organization_id', o.orgId);
    const got = await lease.select('id, organization_id, state, total');
    if (got.error) throw new Error(got.error.message);
    const row = ((got.data ?? []) as Row[])[0];
    if (!row) {
        const r = await db.from('ticket_sort_rule_runs').select('status, done, total').eq('id', runId).maybeSingle();
        const x = r.data as Row | null;
        return { runId, status: !x ? 'gone' : x.status === 'testing' ? 'busy' : (x.status as StepResult['status']), done: Number(x?.done ?? 0), total: Number(x?.total ?? 0), message: x?.status === 'testing' ? 'Another worker is testing this run.' : 'This run has finished.' };
    }
    const orgId = String(row.organization_id);
    const state = row.state as RunState;
    const cats = await categoryRows(db);
    const optionsFor = new Map<string, CategoryOption[]>();
    const options = (p: string | null) => { const k = p ?? '*'; if (!optionsFor.has(k)) optionsFor.set(k, categoryOptionsFrom(cats as never, p)); return optionsFor.get(k)!; };

    // At least one batch per step, so every step makes progress.
    for (let first = true; state.index < state.cases.length && (first || Date.now() - started < budgetMs); first = false) {
        const part = state.cases.slice(state.index, state.index + PARALLEL);
        const done = await Promise.all(part.map(async c => {
            try {
                const opts = options(c.propertyId);
                const [before, after] = await Promise.all([
                    classifyWithAi(c.text, opts, o.deps?.sort ?? {}, [], state.currentText),
                    classifyWithAi(c.text, opts, o.deps?.sort ?? {}, [], state.rulesText),
                ]);
                return { id: c.id, beforeCode: before.verdict.code, beforeConfidence: before.verdict.confidence, beforePriority: before.verdict.priority, afterCode: after.verdict.code, afterConfidence: after.verdict.confidence, afterPriority: after.verdict.priority } as TestResult;
            } catch { return null; }
        }));
        state.results.push(...done.filter((x): x is TestResult => !!x));
        state.index += part.length;
    }

    if (state.index < state.cases.length) {
        await db.from('ticket_sort_rule_runs').update({ state, done: state.index, lease_until: null, updated_at: new Date().toISOString() }).eq('id', runId);
        return { runId, status: 'testing', done: state.index, total: state.cases.length, message: `Tested ${state.index} of ${state.cases.length} tickets.` };
    }

    const summary = testSummary(state.cases, state.results);
    if (!state.requireFix && !summary.passes && summary.why.includes('fixed none') && summary.why.split(';').length === 1) {
        // A person's own rules only need to do no harm.
        summary.passes = true;
        summary.why = `Passed: right on ${summary.heldOut.afterRight} of ${summary.heldOut.tickets} checked tickets (before: ${summary.heldOut.beforeRight}), no danger ticket lowered.`;
    }
    const detail = testDetail(state, summary);
    if (!summary.passes) {
        await db.from('ticket_sort_rule_runs').update({ status: 'not_offered', message: summary.why.slice(0, 500), test: detail, done: state.index, state: null, lease_until: null, updated_at: new Date().toISOString() }).eq('id', runId);
        return { runId, status: 'not_offered', done: state.index, total: state.cases.length, message: summary.why };
    }
    const last = await db.from('ticket_sort_rule_versions').select('version').eq('organization_id', orgId).order('version', { ascending: false }).limit(1).maybeSingle();
    const version = Number((last.data as Row | null)?.version ?? 0) + 1;
    await db.from('ticket_sort_rule_versions').update({ status: 'retired', decided_at: new Date().toISOString() }).eq('organization_id', orgId).eq('status', 'offered');
    const run = await db.from('ticket_sort_rule_runs').select('trigger, started_by').eq('id', runId).maybeSingle();
    const ins = await db.from('ticket_sort_rule_versions').insert({
        organization_id: orgId, version, status: 'offered', rules_text: state.rulesText, rules: state.rules.map(r => ({ text: r.text, sources: r.sources.map(s => ({ id: s, ...(state.sources[s] ?? { text: '', code: '' }) })) })),
        summary: state.summary, test: detail, run_id: runId, source: str((run.data as Row | null)?.trigger) ?? 'button', model: state.model, created_by: str((run.data as Row | null)?.started_by),
    });
    if (ins.error) throw new Error(ins.error.message);
    await db.from('ticket_sort_rule_runs').update({ status: 'offered', message: `Version ${version} offered. ${summary.why}`.slice(0, 500), test: detail, done: state.index, state: null, lease_until: null, updated_at: new Date().toISOString() }).eq('id', runId);
    return { runId, status: 'offered', done: state.index, total: state.cases.length, message: `Version ${version} is ready for you to check. ${summary.why}` };
}

export interface TestDetail extends Omit<TestSummary, 'fixed' | 'broke' | 'dangerLowered'> {
    fixed: Array<{ text: string; right: string }>;
    broke: Array<{ text: string; right: string }>;
    dangerLowered: Array<{ text: string }>;
}
function testDetail(state: RunState, s: TestSummary): TestDetail {
    const byId = new Map(state.cases.map(c => [c.id, c]));
    const show = (id: string) => ({ text: (byId.get(id)?.text ?? '').slice(0, 160), right: byId.get(id)?.truth ?? '' });
    return { ...s, fixed: s.fixed.slice(0, 10).map(show), broke: s.broke.slice(0, 10).map(show), dangerLowered: s.dangerLowered.slice(0, 10).map(id => ({ text: show(id).text })) };
}

// ── a person's decisions ────────────────────────────────────────────────────────────────────────────────────────────

export type Decision = { ok: true; message: string } | { ok: false; status: number; error: string };

/** Makes a version the one in use: an offered one (approve) or an older one (put back). The previous one is retired. */
export async function applyRulesVersion(db: SupabaseClient, orgId: string, versionId: unknown, by: string): Promise<Decision> {
    if (typeof versionId !== 'string' || !versionId) return { ok: false, status: 400, error: 'Choose a version.' };
    const v = await db.from('ticket_sort_rule_versions').select('id, version, status').eq('organization_id', orgId).eq('id', versionId).maybeSingle();
    if (v.error) { if (isMissing(v.error)) return { ok: false, status: 503, error: 'Sorting rules need migration 20261119000002 to be applied.' }; throw new Error(v.error.message); }
    const row = v.data as Row | null;
    if (!row) return { ok: false, status: 404, error: 'That version could not be found.' };
    if (row.status === 'active') return { ok: true, message: `Version ${row.version} is already in use.` };
    if (row.status === 'rejected') return { ok: false, status: 400, error: 'A rejected version cannot be used. Suggest or write new rules.' };
    const at = new Date().toISOString();
    await db.from('ticket_sort_rule_versions').update({ status: 'retired', decided_at: at }).eq('organization_id', orgId).eq('status', 'active');
    const up = await db.from('ticket_sort_rule_versions').update({ status: 'active', decided_by: by, decided_at: at }).eq('organization_id', orgId).eq('id', versionId).select('id');
    if (up.error) throw new Error(up.error.message);
    forgetRules(orgId);
    return { ok: true, message: `Version ${row.version} is now used for every new ticket (within a minute).` };
}

export async function rejectRulesVersion(db: SupabaseClient, orgId: string, versionId: unknown, by: string): Promise<Decision> {
    if (typeof versionId !== 'string' || !versionId) return { ok: false, status: 400, error: 'Choose a version.' };
    const up = await db.from('ticket_sort_rule_versions').update({ status: 'rejected', decided_by: by, decided_at: new Date().toISOString() })
        .eq('organization_id', orgId).eq('id', versionId).eq('status', 'offered').select('version');
    if (up.error) { if (isMissing(up.error)) return { ok: false, status: 503, error: 'Sorting rules need migration 20261119000002 to be applied.' }; throw new Error(up.error.message); }
    if (!(up.data ?? []).length) return { ok: false, status: 404, error: 'Only a version waiting for approval can be rejected.' };
    return { ok: true, message: 'Rejected. The rules in use stay as they are.' };
}

/** No rules at all: tickets are sorted with the fixed instructions only. */
export async function stopRules(db: SupabaseClient, orgId: string, by: string): Promise<Decision> {
    const up = await db.from('ticket_sort_rule_versions').update({ status: 'retired', decided_by: by, decided_at: new Date().toISOString() }).eq('organization_id', orgId).eq('status', 'active').select('version');
    if (up.error) { if (isMissing(up.error)) return { ok: false, status: 503, error: 'Sorting rules need migration 20261119000002 to be applied.' }; throw new Error(up.error.message); }
    forgetRules(orgId);
    return { ok: true, message: (up.data ?? []).length ? 'No rules are used now. Any version can be put back from the history.' : 'No rules were in use.' };
}

// ── the daily job ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface DailyResult { continued: StepResult[]; started: Array<{ orgId: string; result: StartResult }>; skipped: string | null }

/**
 * Carries on unfinished runs, then (with `startNew`, from DAILY_FROM_HOUR India time) starts today's run for every
 * organisation that has learning examples and has "Draft new rules every day" on. Stops when `budgetMs` is used.
 */
export async function dailyRulesStep(now: Date, budgetMs: number, o: { admin?: SupabaseClient; startNew?: boolean; deps?: RulesDeps } = {}): Promise<DailyResult> {
    const db = await adminOf(o.admin);
    const started = Date.now();
    const left = () => budgetMs - (Date.now() - started);
    const out: DailyResult = { continued: [], started: [], skipped: null };

    const open = await db.from('ticket_sort_rule_runs').select('id').eq('status', 'testing').limit(20);
    if (open.error) { out.skipped = isMissing(open.error) ? 'migration 20261119000002 not applied' : open.error.message; return out; }
    for (const r of (open.data ?? []) as Row[]) {
        if (left() < 10_000) return out;
        out.continued.push(await continueRulesRun(String(r.id), left() - 5_000, { admin: db, deps: o.deps }));
    }
    if (!o.startNew) return out;
    if (istHour(now) < DAILY_FROM_HOUR) { out.skipped = 'before the daily hour'; return out; }

    const ex = await db.from('ticket_sort_examples').select('organization_id').is('retired_at', null).limit(5000);
    if (ex.error) { out.skipped = isMissing(ex.error) ? 'migration 20261119000001 not applied' : ex.error.message; return out; }
    const orgs = [...new Set(((ex.data ?? []) as Row[]).map(r => String(r.organization_id)))];
    const today = istDay(now);
    for (const orgId of orgs) {
        if (left() < 30_000) break;
        const setting = await learningSetting(orgId, db);
        if (setting.rulesDaily === false) continue;
        const ran = await db.from('ticket_sort_rule_runs').select('id').eq('organization_id', orgId).eq('trigger', 'daily').eq('day', today).limit(1);
        if ((ran.data ?? []).length) continue;
        const result = await startRulesRun(orgId, 'daily', { admin: db, deps: o.deps });
        out.started.push({ orgId, result });
        if (result.ok && result.runId) {
            const step = await continueRulesRun(result.runId, Math.max(5_000, left() - 10_000), { admin: db, deps: o.deps });
            out.continued.push(step);
        }
    }
    return out;
}

// ── the screen ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RuleVersionView {
    id: string; version: number; status: 'offered' | 'active' | 'retired' | 'rejected'; source: string;
    rules: Array<{ text: string; sources: Array<{ text: string; code: string }> }>;
    summary: string | null; test: TestDetail | null; at: string; decidedAt: string | null;
}
export interface RulesView {
    tableMissing: boolean;
    daily: boolean;
    active: RuleVersionView | null;
    offered: RuleVersionView | null;
    running: { id: string; trigger: string; done: number; total: number; at: string } | null;
    runs: Array<{ id: string; trigger: string; status: string; message: string; at: string }>;
    history: RuleVersionView[];
}

const versionOf = (r: Row): RuleVersionView => ({
    id: String(r.id), version: Number(r.version), status: r.status as RuleVersionView['status'], source: String(r.source ?? ''),
    rules: Array.isArray(r.rules) ? (r.rules as Row[]).map(x => ({ text: String(x.text ?? ''), sources: Array.isArray(x.sources) ? (x.sources as Row[]).map(s => ({ text: String(s.text ?? ''), code: String(s.code ?? '') })) : [] })) : parseRulesText(String(r.rules_text ?? '')).map(text => ({ text, sources: [] })),
    summary: str(r.summary), test: (r.test as TestDetail | null) ?? null, at: String(r.created_at ?? ''), decidedAt: str(r.decided_at),
});

export async function rulesView(db: SupabaseClient, orgId: string, daily: boolean): Promise<RulesView> {
    const view: RulesView = { tableMissing: false, daily, active: null, offered: null, running: null, runs: [], history: [] };
    const [vs, rs] = await Promise.all([
        db.from('ticket_sort_rule_versions').select('id, version, status, source, rules, rules_text, summary, test, created_at, decided_at').eq('organization_id', orgId).order('version', { ascending: false }).limit(12),
        db.from('ticket_sort_rule_runs').select('id, trigger, status, message, done, total, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(8),
    ]);
    if (vs.error || rs.error) {
        if (isMissing(vs.error) || isMissing(rs.error)) { view.tableMissing = true; return view; }
        throw new Error((vs.error ?? rs.error)!.message);
    }
    const versions = ((vs.data ?? []) as Row[]).map(versionOf);
    view.active = versions.find(v => v.status === 'active') ?? null;
    view.offered = versions.find(v => v.status === 'offered') ?? null;
    view.history = versions.filter(v => v.status === 'retired' || v.status === 'rejected');
    const runs = (rs.data ?? []) as Row[];
    const running = runs.find(r => r.status === 'testing');
    if (running) view.running = { id: String(running.id), trigger: String(running.trigger), done: Number(running.done ?? 0), total: Number(running.total ?? 0), at: String(running.created_at) };
    view.runs = runs.map(r => ({ id: String(r.id), trigger: String(r.trigger), status: String(r.status), message: String(r.message ?? ''), at: String(r.created_at) }));
    return view;
}
