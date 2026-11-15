/**
 * Brain Console: the one place the screens talk to the server. The demo adapter (demoData.ts, development only)
 * implements the same interface, so no screen knows which one it has.
 */
import type { BrainSettings } from '@/backend/lib/aiLayer/brain/config';
import type {
    ConsoleReply, ConsoleStatus, ConversationSummary, CostView, GuidanceView, MemoryView, Overview, ReviewView, ScorecardView, SettingsView,
    ShadowView, SkillView, TurnView,
} from '@/backend/lib/aiLayer/brain/console/types';
import type { Outcome } from '@/backend/lib/aiLayer/brain/types';
// Types only: nothing from these server files reaches the browser bundle.
import type { Capability, ModelInfo, ModelStatus } from '@/task-manager/ai/aiCatalog';
import type { InventoryRow } from '@/task-manager/ai/aiInventory';

export type Days = 1 | 7 | 30;
export type Track = 'live' | 'shadow';

/** missing = the part's database table is not applied yet (HTTP 503). */
export type Failure = { ok: false; kind: 'forbidden' | 'conflict' | 'invalid' | 'missing' | 'error'; message: string };
export type Result<T> = { ok: true; status: ConsoleStatus; data: T } | Failure;

export type LabelBody = { action: 'label'; turnId: string; verdict: 'right' | 'wrong'; expectedOutcome: Outcome; expectedSkill: string | null; note: string | null };
/** ai_judge: a flagged message of the older AI assistant. teach needs the right answer (entryId + fields); ignore does not. */
export type AiJudgeBody = { action: 'ai_judge'; id: string; verdict: 'teach' | 'ignore'; entryId: string; fields: Record<string, unknown> };
export type ReviewBody = LabelBody | { action: 'set_active'; caseId: string; active: boolean } | AiJudgeBody;

// ── AI models (app/api/task-manager/ai-models): its own reply shape, not ConsoleReply ─────────────────────────────

/** Jobs and groups come from the server and grow over time: never a fixed list on this side. */
/** single = the job runs on ONE model: a main model only, no backups (the server refuses more than one). */
export interface AiJobRow { key: string; label: string; hint: string; group: string; needs: Capability; defaults: string[]; saved: string[] | null; effective: string[]; single?: boolean }
export type AiModelRow = ModelInfo & { status: Record<string, { status: ModelStatus; reason: string }> };
export interface AiKeyRow { provider: string; label: string; ready: boolean; note?: string; keys: Array<{ name: string; set: boolean }> }
/** why = in plain words, why this one cannot be changed from the screen. */
export type AiInventoryItem = InventoryRow & { keyStatus: Array<{ name: string; set: boolean }>; modelEnvSet?: boolean; why?: string };
export interface AiModelsData { tableMissing: boolean; keys: AiKeyRow[]; jobs: AiJobRow[]; models: AiModelRow[]; maxChain: number; inventory: AiInventoryItem[] }
/** ok null = not test-called (speech models need a voice note), only the key was checked. */
export interface AiTestResult { ok: boolean | null; message: string; ms?: number }
export interface AiSaveReply { message?: string; warnings?: string[] }
export type Plain<T> = { ok: true; data: T } | Failure;

/** Guidance actions. test_step runs the next few steps and returns: call it again, one call at a time, while running. */
export type GuidanceBody =
    | { action: 'save_draft'; text: string }
    | { action: 'test_step'; versionId: string }
    | { action: 'activate'; versionId: string }
    | { action: 'turn_off' }
    | { action: 'discard_draft'; versionId: string }
    /** One model call: proposes the words of a note from the answers judged wrong. Nothing is saved. */
    | { action: 'suggest' };

/** The guidance reply may also carry a suggestion (after { action: 'suggest' } only). */
export interface Suggestion { text: string; basedOn: number }
export type GuidanceResult = Result<GuidanceView> & { suggestion?: Suggestion };

export interface BrainApi {
    overview(days: Days): Promise<Result<Overview>>;
    conversations(q: { days: Days; track: Track; only: 'all' | 'flagged' }): Promise<Result<ConversationSummary[]>>;
    conversation(q: { person: string; day: string; track: Track }): Promise<Result<TurnView[]>>;
    shadow(days: Days): Promise<Result<ShadowView>>;
    skills(): Promise<Result<SkillView[]>>;
    memory(): Promise<Result<MemoryView>>;
    cost(): Promise<Result<CostView>>;
    scorecard(): Promise<Result<ScorecardView>>;
    settings(): Promise<Result<SettingsView>>;
    saveSettings(body: { settings: BrainSettings; updatedAt: string | null }): Promise<Result<SettingsView>>;
    review(): Promise<Result<ReviewView>>;
    postReview(body: ReviewBody): Promise<Result<ReviewView>>;
    guidance(): Promise<Result<GuidanceView>>;
    postGuidance(body: GuidanceBody): Promise<GuidanceResult>;
    aiModels(): Promise<Plain<AiModelsData>>;
    saveAiModels(job: string, models: string[] | null): Promise<Plain<AiSaveReply>>;
    testAiModel(job: string, model: string): Promise<Plain<{ result: AiTestResult }>>;
}

export const FORBIDDEN = 'This console is for the Tech team only.';
export const CONFLICT = 'Someone else saved the switches while you were editing. Reload and try again.';
export const LEARNING_MISSING = 'Guidance needs migration 20261114000004 to be applied.';

async function call<T>(url: string, init?: RequestInit): Promise<Result<T>> {
    let res: Response;
    try {
        res = await fetch(url, { cache: 'no-store', ...init });
    } catch {
        return { ok: false, kind: 'error', message: 'Could not reach the server. Check the connection and try again.' };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, kind: 'forbidden', message: FORBIDDEN };
    if (res.status === 409) return { ok: false, kind: 'conflict', message: CONFLICT };
    let body: ConsoleReply<T> | null = null;
    try { body = (await res.json()) as ConsoleReply<T>; } catch { /* not JSON: handled below */ }
    if (!body || !body.success || !res.ok) {
        const said = body && !body.success && typeof body.error === 'string' && body.error.trim() ? body.error : null;
        // A 400 or 429 carries a plain-language reason written for this screen: show it exactly as sent.
        if (res.status === 400 || res.status === 429) return { ok: false, kind: 'invalid', message: said ?? 'The server did not accept this change.' };
        if (res.status === 503) return { ok: false, kind: 'missing', message: said ?? LEARNING_MISSING };
        return { ok: false, kind: 'error', message: said ?? `The server answered with an error (HTTP ${res.status}).` };
    }
    const { success: _s, status, data, ...extra } = body as { success: true; status: ConsoleStatus; data: T } & Record<string, unknown>;
    void _s;
    return { ok: true, status, data, ...extra };
}

/** For the AI models route, whose replies are { success, ... } rather than ConsoleReply. Same 401 / 403 guard. */
async function plainCall<T>(url: string, init?: RequestInit): Promise<Plain<T>> {
    let res: Response;
    try {
        res = await fetch(url, { cache: 'no-store', ...init });
    } catch {
        return { ok: false, kind: 'error', message: 'Could not reach the server. Check the connection and try again.' };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, kind: 'forbidden', message: FORBIDDEN };
    let body: { success?: unknown; error?: unknown } | null = null;
    try { body = (await res.json()) as { success?: unknown; error?: unknown }; } catch { /* not JSON: handled below */ }
    if (!body || body.success !== true || !res.ok) {
        const said = body && typeof body.error === 'string' && body.error.trim() ? body.error : null;
        if (res.status === 400) return { ok: false, kind: 'invalid', message: said ?? 'The server did not accept this.' };
        return { ok: false, kind: 'error', message: said ?? `The server answered with an error (HTTP ${res.status}).` };
    }
    return { ok: true, data: body as unknown as T };
}

export function createHttpApi(orgId: string): BrainApi {
    const base = '/api/brain/console';
    const q = (params: Record<string, string | number>) =>
        new URLSearchParams({ orgId, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) }).toString();
    const view = <T,>(params: Record<string, string | number>) => call<T>(`${base}?${q(params)}`);
    const json = (method: 'PUT' | 'POST', body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    return {
        overview: days => view({ view: 'overview', days }),
        conversations: ({ days, track, only }) => view({ view: 'conversations', days, track, only }),
        conversation: ({ person, day, track }) => view({ view: 'conversation', person, day, track }),
        shadow: days => view({ view: 'shadow', days }),
        skills: () => view({ view: 'skills' }),
        memory: () => view({ view: 'memory' }),
        cost: () => view({ view: 'cost' }),
        scorecard: () => view({ view: 'scorecard' }),
        settings: () => call(`${base}/settings?${q({})}`),
        saveSettings: body => call(`${base}/settings?${q({})}`, json('PUT', body)),
        review: () => call(`${base}/review?${q({})}`),
        postReview: body => call(`${base}/review?${q({})}`, json('POST', body)),
        guidance: () => call(`${base}/guidance?${q({})}`),
        postGuidance: body => call<GuidanceView>(`${base}/guidance?${q({})}`, json('POST', body)) as Promise<GuidanceResult>,
        aiModels: () => plainCall(`/api/task-manager/ai-models?${q({})}`),
        saveAiModels: (job, models) => plainCall(`/api/task-manager/ai-models?${q({})}`, json('POST', { action: 'save', job, models })),
        testAiModel: (job, model) => plainCall(`/api/task-manager/ai-models?${q({})}`, json('POST', { action: 'test', job, model })),
    };
}
