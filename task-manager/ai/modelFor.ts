/**
 * Owner 2026-11-15 — "every AI model configurable" (Tech console: Brain → AI models).
 *
 * How a part of the application outside the Task Manager reads its model choice. The rule that keeps this safe is the
 * same at every call site: the site keeps computing TODAY'S model exactly as it always did and passes it in here; this
 * file only ever replaces it with a saved choice that is known, can do the job, belongs to a provider that job's code
 * can call, and has its key set. Nothing saved, the settings table missing, a database error or a slow database, an
 * unusable choice: the site gets today's model back, unchanged. Nothing here throws.
 *
 * A chosen model that FAILS is rested for a few minutes (review 2026-11-15): the job runs on today's model meanwhile,
 * so one bad choice costs one slow request, not every request, and a choice that hangs cannot eat a whole request
 * again and again. It is then tried once more, and rested again if it still fails.
 *
 * This file imports only the pure catalog. The settings module (which reads the database) is loaded on first use, so a
 * call site does not pull it in at import time and backend/lib/council/llm.ts can use this without an import cycle.
 */
import { modelStatus, rawModelId, type AiJob, type Provider } from './aiCatalog';

/** How long a job stays on today's model after its chosen model failed. */
export const REST_MS = 5 * 60_000;
/** The settings read may not hold a request up for longer than this; past it, today's model is used. */
const READ_LIMIT_MS = 2_000;
/** A chosen-model call that has not come back after this long is counted as failed (the request was probably cut off). */
const STUCK_MS = 90_000;

const restingSince = new Map<AiJob, number>();
const startedAt = new Map<AiJob, number>();

/** The chosen model of this job just failed: use today's model for the next few minutes. */
export function markFailed(job: AiJob): void { restingSince.set(job, Date.now()); startedAt.delete(job); }

function resting(job: AiJob): boolean {
    // A call with the chosen model that never came back (the request ran out of time) counts as a failure too.
    const started = startedAt.get(job);
    if (started !== undefined && Date.now() - started > STUCK_MS) markFailed(job);
    const since = restingSince.get(job);
    if (since === undefined) return false;
    if (Date.now() - since < REST_MS) return true;
    restingSince.delete(job);
    return false;
}

/** For tests. */
export function _resetModelRests(): void { restingSince.clear(); startedAt.clear(); pending = null; }

type Saved = Map<AiJob, string[]>;
let pending: Promise<Saved | null> | null = null;

/** The saved choices, read once at a time and never for longer than READ_LIMIT_MS. null = could not be read in time. */
async function savedNow(): Promise<{ saved: Saved; keyReady: (p: Provider, j: AiJob) => boolean } | null> {
    const settings = await import('./AiModelSettings');
    if (!pending) {
        pending = settings.savedChains().then(r => r.byJob, () => null).finally(() => { pending = null; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), READ_LIMIT_MS); });
    const saved = await Promise.race([pending, late]);
    if (timer) clearTimeout(timer);
    return saved ? { saved, keyReady: (p, j) => settings.keyReady(p, j) } : null;
}

/**
 * The saved choices for a job that are usable right now, as catalog ids, in the saved order. Empty = keep today's
 * (nothing saved, nothing usable, the settings could not be read, or the chosen model is being rested after a failure).
 */
export async function chosenModels(job: AiJob): Promise<string[]> {
    try {
        if (resting(job)) return [];
        const got = await savedNow();
        if (!got) return [];
        return (got.saved.get(job) ?? []).filter(id => modelStatus(job, id, got.keyReady).status === 'ready');
    } catch {
        return [];
    }
}

/**
 * The model a one-model job should call: the saved choice (as the provider's own id, without the 'groq:' / 'openai:'
 * prefix), or `today` when nothing usable is saved.
 */
export async function modelFor(job: AiJob, today: string): Promise<string> {
    const [first] = await chosenModels(job);
    return first ? rawModelId(first) : today;
}

/**
 * Runs `call` with the chosen model; if that fails and the chosen model is not today's, rests the choice and runs it
 * ONCE more with today's. So a saved choice that stops working costs one failed attempt, never the job. With nothing
 * saved this is exactly `call(today)`: one call, the same error if it throws.
 */
export async function runWithModel<T>(job: AiJob, today: string, call: (model: string) => Promise<T>): Promise<T> {
    const chosen = await modelFor(job, today);
    if (chosen === today) return call(today);
    startedAt.set(job, Date.now());
    try {
        const out = await call(chosen);
        startedAt.delete(job);
        return out;
    } catch (err) {
        markFailed(job);
        console.warn(`[AiModels] ${job}: the chosen model failed; using today's model for the next ${REST_MS / 60_000} minutes:`, err instanceof Error ? err.message.slice(0, 200) : 'error');
        return call(today);
    }
}
