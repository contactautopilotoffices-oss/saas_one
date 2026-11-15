/**
 * Brain Console → Guidance: a short note the Tech team writes for the brain, in versions, with a test it must pass
 * before it can go live. Server only; called after the Tech-team check in the route, and every query is limited to the
 * organisation in code.
 *
 * The test plays the brain's whole test set on the REAL model, with and without the note, in the fake world of
 * eval/world.ts: it spends model credit, but it reads and writes no business data and cannot send a message. It runs a
 * few steps per request (a request may not run for minutes), so the console calls `testStep` until it is done.
 *
 * How the spending and the result are protected (review 2026-11-14):
 *   - One step at a time. A step first CLAIMS the draft (a lease plus a revision number, changed only if the revision
 *     is still the one it read). A second request, another tab or a retry finds the claim and is refused before it
 *     spends anything.
 *   - Progress is saved after every batch, again only if the revision is still its own. So two writers can never
 *     overwrite each other, and an unsafe result can never be replaced by a later pass from a stale copy. If the draft
 *     is edited or discarded while a test runs, the next save fails and the test stops.
 *   - Tests started are counted in their own append-only table (ai_brain_guidance_runs). Editing or discarding a draft
 *     does not give a test back: five a day per organisation, two dollars each.
 *   - What goes live is decided here, never by the browser: `activate` re-reads the row, re-checks the stored result
 *     against the words, the model and the test set as they are NOW, and promotes it only if the revision is unchanged.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { GOLDEN_CASES } from '../eval/cases';
import { MAX_TEST_USD, gateView, goldenFingerprint, isCurrent, newGate, parseGate, pendingSteps, record, sha, type GateState, type StepResult } from '../eval/gate';
import { gradeCase } from '../eval/grade';
import lastRun from '../eval/lastRun.json';
import { runCase } from '../eval/run';
import { GUIDANCE_MAX, cleanGuidance } from '../learning/lessons';
import { forgetLearning } from '../server';
import type { BrainModel, ModelCall, ModelReply } from '../types';
import type { GuidanceTest, GuidanceVersion, GuidanceView } from './types';
import { indiaDay } from './view';

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42703', 'PGRST204']);
const isMissing = (e: { code?: string } | null | undefined) => !!e && MISSING.has(String(e.code ?? ''));

export const TESTS_PER_DAY = 5;
/** Room in the daily count for suggestions (console/suggest.ts allows three a day), so they never hide a test. */
const SUGGEST_ROOM = 3;
const PARALLEL = 4;
/** How long one request keeps starting new batches. A batch in flight is finished, and what it found is saved. */
const CALL_BUDGET_MS = 20_000;
/** How long a claim lasts if the request holding it dies: a little longer than a request may run. */
const LEASE_MS = 75_000;
const CASE_IDS = GOLDEN_CASES.map(c => c.id);
const TABLE = 'ai_brain_guidance';

export interface GuidanceDeps {
    model: BrainModel;
    /** The models the brain tries, in order; the test runs on the first. */
    chain(): Promise<string[]>;
    now(): Date;
    env?: Record<string, string | undefined>;
}

export type GuidanceResult = { ok: true } | { ok: false; status: 400 | 404 | 409 | 429 | 503; error: string };

interface Row {
    id: string; version: number; body: string; status: 'draft' | 'live' | 'retired'; test: unknown;
    created_by: string | null; created_at: string; activated_at: string | null; rev: number | null; busy_until: string | null;
}
const COLS = 'id, version, body, status, test, created_by, created_at, activated_at, rev, busy_until';
const NOT_APPLIED: GuidanceResult = { ok: false, status: 503, error: 'Guidance is not available yet: migration 20261114000004 has not been applied.' };
const BUSY: GuidanceResult = { ok: false, status: 409, error: 'A step of this test is already running. Wait a moment, then continue the test.' };
const CHANGED: GuidanceResult = { ok: false, status: 409, error: 'The draft was changed while this was running, so it stopped. Reload to see the draft as it is now.' };
const revOf = (r: Row): number => Number(r.rev) || 0;

async function rows(admin: SupabaseClient, orgId: string): Promise<{ rows: Row[]; missing: boolean }> {
    const { data, error } = await admin.from(TABLE).select(COLS).eq('organization_id', orgId).order('version', { ascending: false }).limit(20);
    if (error) { if (isMissing(error)) return { rows: [], missing: true }; throw new Error(error.message); }
    return { rows: (data || []) as Row[], missing: false };
}

/** Tests started today (India time), from the append-only run log: an edit or a discard never gives one back. */
async function startedToday(admin: SupabaseClient, orgId: string, now: Date): Promise<number> {
    const dayStart = new Date(`${indiaDay(now)}T00:00:00+05:30`).toISOString();
    const count = (withKind: boolean) => admin.from('ai_brain_guidance_runs').select(withKind ? 'id, kind' : 'id')
        .eq('organization_id', orgId).gte('started_at', dayStart).limit(TESTS_PER_DAY + SUGGEST_ROOM + 20);
    // The log also counts suggestions (console/suggest.ts), each kind against its own limit: anything that is not a
    // suggestion is a test. Until migration 20261115000002 is applied the log has no `kind` and every row is a test.
    let { data, error } = await count(true);
    if (error && String(error.code) === '42703') ({ data, error } = await count(false));
    if (error) { if (isMissing(error)) return TESTS_PER_DAY; throw new Error(error.message); } // no log, no tests
    return ((data || []) as Array<{ kind?: string | null }>).filter(r => r.kind !== 'suggest').length;
}

const firstModel = async (deps: GuidanceDeps): Promise<string | null> => (await deps.chain().catch(() => [] as string[]))[0] ?? null;

/** A draft's stored result, as the console shows it: stale when it is no longer about these words, this model or this test set. */
function testView(row: Row, model: string | null, liveText: string): GuidanceTest | null {
    const g = parseGate(row.test);
    if (!g) return null;
    const view = gateView(g, CASE_IDS);
    if (row.status === 'draft' && (!model || !isCurrent(g, { model, text: row.body, baselineText: liveText }))) {
        return { ...view, state: 'stale', verdict: 'The words, the model order or the test set changed since this was tested. Test it again.' };
    }
    return view;
}

/**
 * The live note's own result as "without the new note" for the next test, so it is not paid for twice. Only a run
 * that finished and passed, on this model and this test set, about exactly the words that are live.
 */
function reusableBaseline(live: Row | undefined, model: string): Record<string, StepResult> | undefined {
    const g = live ? parseGate(live.test) : null;
    if (!live || !g || g.model !== model || g.textHash !== sha(live.body) || g.fingerprint !== goldenFingerprint()) return undefined;
    return gateView(g, CASE_IDS).state === 'passed' ? g.candidate : undefined;
}

export async function guidanceView(admin: SupabaseClient, orgId: string, deps: GuidanceDeps): Promise<Omit<GuidanceView, 'suggest'>> {
    const [{ rows: all, missing }, model] = await Promise.all([rows(admin, orgId), firstModel(deps)]);
    const live = all.find(r => r.status === 'live');
    const ids = [...new Set(all.map(r => r.created_by).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (ids.length) {
        const users = await admin.from('users').select('id, full_name').in('id', ids);
        for (const u of (users.data || []) as Array<{ id: string; full_name: string | null }>) names.set(u.id, (u.full_name || '').trim());
    }
    // The name shown is the Tech member who wrote the note (an administrator's action), never a person who chatted.
    const toVersion = (r: Row): GuidanceVersion => ({
        id: r.id, version: r.version, text: r.body, status: r.status, createdBy: (r.created_by && names.get(r.created_by)) || 'A Tech team member',
        createdAt: r.created_at, activatedAt: r.activated_at, test: testView(r, model, live?.body ?? ''),
    });
    const perStep = (lastRun as unknown as { models?: Array<{ model: string; avgCostUsd: number | null }> }).models?.find(m => m.model === model)?.avgCostUsd ?? null;
    const sides = model && reusableBaseline(live, model) ? 1 : 2;
    return {
        live: live ? toVersion(live) : null,
        versions: all.map(toVersion),
        model,
        cases: CASE_IDS.length,
        estimateUsd: perStep === null ? null : Math.round(perStep * CASE_IDS.length * sides * 100) / 100,
        testsLeftToday: missing ? 0 : Math.max(0, TESTS_PER_DAY - await startedToday(admin, orgId, deps.now())),
        maxChars: GUIDANCE_MAX,
    };
}

export async function saveDraft(admin: SupabaseClient, orgId: string, userId: string, text: unknown): Promise<GuidanceResult> {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, status: 400, error: 'Write the note first.' };
    if (text.trim().length > GUIDANCE_MAX) return { ok: false, status: 400, error: `The note can be at most ${GUIDANCE_MAX} characters. Nothing was saved.` };
    const body = cleanGuidance(text);
    if (!body) return { ok: false, status: 400, error: 'Write the note first.' };
    const { rows: all, missing } = await rows(admin, orgId);
    if (missing) return NOT_APPLIED;
    if (all.find(r => r.status === 'live')?.body === body) return { ok: false, status: 400, error: 'These are the words that are already live.' };
    const draft = all.find(r => r.status === 'draft');
    const now = new Date().toISOString();
    if (draft) {
        if (draft.body === body) return { ok: true };
        // New words make the old result worthless, so it is cleared. The revision moves on, which also stops a test
        // that is running on the old words at its next save.
        const { data, error } = await admin.from(TABLE).update({ body, test: null, busy_until: null, created_by: userId, rev: revOf(draft) + 1, updated_at: now })
            .eq('id', draft.id).eq('organization_id', orgId).eq('status', 'draft').eq('rev', revOf(draft)).select('id');
        if (error) throw new Error(error.message);
        return (data || []).length ? { ok: true } : CHANGED;
    }
    const max = await admin.from(TABLE).select('version').eq('organization_id', orgId).order('version', { ascending: false }).limit(1);
    if (max.error) throw new Error(max.error.message);
    const version = (Number(((max.data || []) as Array<{ version: number }>)[0]?.version) || 0) + 1;
    const { error } = await admin.from(TABLE).insert({ organization_id: orgId, version, body, status: 'draft', created_by: userId, rev: 0 });
    if (error) {
        if (String(error.code) === '23505') return { ok: false, status: 400, error: 'Someone else saved a draft a moment ago. Reload to see it.' };
        throw new Error(error.message);
    }
    return { ok: true };
}

async function draftOf(admin: SupabaseClient, orgId: string, versionId: unknown): Promise<{ draft: Row; live: Row | undefined } | GuidanceResult> {
    if (typeof versionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId)) return { ok: false, status: 404, error: 'That draft could not be found.' };
    const { rows: all, missing } = await rows(admin, orgId);
    if (missing) return NOT_APPLIED;
    const draft = all.find(r => r.id === versionId && r.status === 'draft');
    if (!draft) return { ok: false, status: 404, error: 'That draft could not be found. It may have been discarded or made live already.' };
    return { draft, live: all.find(r => r.status === 'live') };
}

/** Adds up what a step's model calls cost, including the earlier messages of a conversation case. */
function metered(inner: BrainModel): { model: BrainModel; spent(): number } {
    let usd = 0;
    return {
        spent: () => usd,
        model: { async call(req: ModelCall): Promise<ModelReply> { const r = await inner.call(req); usd += r.usage.costUsd ?? 0; return r; } },
    };
}

/** Plays the next few steps of a draft's test, saving after every batch. The first call starts (and counts) the test. */
export async function testStep(admin: SupabaseClient, orgId: string, userId: string, versionId: unknown, deps: GuidanceDeps): Promise<GuidanceResult> {
    if ((deps.env ?? process.env).AI_BRAIN_DISABLED === 'true') return { ok: false, status: 400, error: 'The brain is stopped by the platform kill switch, so tests are paused.' };
    const found = await draftOf(admin, orgId, versionId);
    if ('ok' in found) return found;
    const { draft, live } = found;
    const model = await firstModel(deps);
    if (!model) return { ok: false, status: 400, error: 'No model is set for the brain, so there is nothing to test on.' };
    const liveText = live?.body ?? '';
    if (draft.busy_until && Date.parse(draft.busy_until) > deps.now().getTime()) return BUSY;

    // Every write below changes the row only if its revision is still the one this request holds, then moves it on.
    let rev = revOf(draft);
    const write = async (patch: Record<string, unknown>): Promise<boolean> => {
        const { data, error } = await admin.from(TABLE).update({ ...patch, rev: rev + 1, updated_at: new Date().toISOString() })
            .eq('id', draft.id).eq('organization_id', orgId).eq('status', 'draft').eq('rev', rev).select('id');
        if (error) throw new Error(error.message);
        if (!(data || []).length) return false;
        rev++;
        return true;
    };
    // The claim: nothing is spent before this succeeds, and only one request can hold it.
    if (!(await write({ busy_until: new Date(deps.now().getTime() + LEASE_MS).toISOString() }))) return BUSY;

    let lost = false;
    try {
        let g: GateState | null = parseGate(draft.test);
        if (!g || !isCurrent(g, { model, text: draft.body, baselineText: liveText })) {
            if (await startedToday(admin, orgId, deps.now()) >= TESTS_PER_DAY) return { ok: false, status: 429, error: `${TESTS_PER_DAY} tests have been started today, which is the limit. Try again tomorrow.` };
            // Counted BEFORE any model call, in a log that an edit or a discard cannot touch.
            const logged = await admin.from('ai_brain_guidance_runs').insert({ organization_id: orgId, version_id: draft.id, version: draft.version, model, started_by: userId, started_at: deps.now().toISOString() });
            if (logged.error) throw new Error(logged.error.message);
            g = newGate({ model, text: draft.body, baselineText: liveText, now: deps.now(), baseline: reusableBaseline(live, model) });
            if (!(await write({ test: g }))) { lost = true; return CHANGED; }
        }

        const began = Date.now();
        while (gateView(g, CASE_IDS).state === 'running' && Date.now() - began < CALL_BUDGET_MS) {
            const steps = pendingSteps(g, CASE_IDS, PARALLEL);
            if (!steps.length) break;
            const state = g;
            await Promise.all(steps.map(async step => {
                const c = GOLDEN_CASES.find(x => x.id === step.id)!;
                const meter = metered(deps.model);
                const run = await runCase(meter.model, model, c, { guidance: step.variant === 'candidate' ? draft.body : (liveText || null) });
                const grade = gradeCase(c, run);
                record(state, step.variant, step.id, { pass: grade.pass, safe: grade.safe, why: grade.why.filter(w => !w.startsWith('used ')).join('; '), costUsd: meter.spent() });
            }));
            if (g.spentUsd > MAX_TEST_USD) g.stopped = `The test was stopped after spending $${g.spentUsd.toFixed(2)}; one test may cost at most $${MAX_TEST_USD}. This note cannot go live.`;
            if (gateView(g, CASE_IDS).state !== 'running' && !g.finishedAt) g.finishedAt = deps.now().toISOString();
            // Saved after EVERY batch: a request that dies loses one batch at most, and what was spent stays counted.
            if (!(await write({ test: g }))) { lost = true; return CHANGED; }
        }
        return { ok: true };
    } finally {
        // Give the claim back (unless the row moved on under us, in which case it is no longer ours to touch).
        if (!lost) await write({ busy_until: null }).catch(() => false);
    }
}

/** Makes a tested draft the live note. Everything is checked again here, against what is true now. */
export async function activate(admin: SupabaseClient, orgId: string, userId: string, versionId: unknown, deps: GuidanceDeps): Promise<GuidanceResult> {
    const found = await draftOf(admin, orgId, versionId);
    if ('ok' in found) return found;
    const { draft, live } = found;
    if (draft.busy_until && Date.parse(draft.busy_until) > deps.now().getTime()) return BUSY;
    const model = await firstModel(deps);
    const g = parseGate(draft.test);
    if (!g) return { ok: false, status: 400, error: 'This note has not been tested yet. Test it first.' };
    if (!model || !isCurrent(g, { model, text: draft.body, baselineText: live?.body ?? '' })) return { ok: false, status: 400, error: 'The words, the model order or the test set changed since this note was tested. Test it again.' };
    const view = gateView(g, CASE_IDS);
    if (view.state === 'running') return { ok: false, status: 400, error: 'The test has not finished yet.' };
    if (view.state !== 'passed') return { ok: false, status: 400, error: view.verdict ?? 'This note did not pass its test, so it cannot go live.' };

    const now = new Date().toISOString();
    // The database allows one live note, so the old one is retired first.
    if (live) {
        const retired = await admin.from(TABLE).update({ status: 'retired', updated_at: now }).eq('id', live.id).eq('organization_id', orgId).eq('status', 'live');
        if (retired.error) throw new Error(retired.error.message);
    }
    // Promoted only if the row is still the one that was just checked: an edit in between changes the revision, and
    // untested words can never go live through this door.
    const promoted = await admin.from(TABLE).update({ status: 'live', activated_by: userId, activated_at: now, updated_at: now, rev: revOf(draft) + 1 })
        .eq('id', draft.id).eq('organization_id', orgId).eq('status', 'draft').eq('rev', revOf(draft)).select('id');
    forgetLearning(orgId);
    if (!promoted.error && (promoted.data || []).length) return { ok: true };

    // It did not go through. Put the earlier note back, and say truthfully what is in force now.
    let restored = !live;
    if (live) {
        const back = await admin.from(TABLE).update({ status: 'live', updated_at: new Date().toISOString() }).eq('id', live.id).eq('organization_id', orgId).eq('status', 'retired').select('id');
        restored = !back.error && (back.data || []).length > 0;
    }
    if (promoted.error) console.error('[BrainConsole] guidance could not be made live:', promoted.error.message);
    return {
        ok: false, status: 409,
        error: `The draft changed while it was being made live, so it did not go live. ${!live ? 'No guidance is in force.' : restored ? 'The earlier note is still in force.' : 'The earlier note could not be put back, so no guidance is in force now.'} Reload to see where things stand.`,
    };
}

export async function turnOff(admin: SupabaseClient, orgId: string): Promise<GuidanceResult> {
    const { error } = await admin.from(TABLE).update({ status: 'retired', updated_at: new Date().toISOString() }).eq('organization_id', orgId).eq('status', 'live');
    forgetLearning(orgId);
    if (error) { if (isMissing(error)) return NOT_APPLIED; throw new Error(error.message); }
    return { ok: true };
}

export async function discardDraft(admin: SupabaseClient, orgId: string, versionId: unknown): Promise<GuidanceResult> {
    const found = await draftOf(admin, orgId, versionId);
    if ('ok' in found) return found;
    const { error } = await admin.from(TABLE).delete().eq('id', found.draft.id).eq('organization_id', orgId).eq('status', 'draft');
    if (error) throw new Error(error.message);
    return { ok: true };
}
