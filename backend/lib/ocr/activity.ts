import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What every OCR operation did, written to ocr_activity_log for the Master Admin OCR Monitor.
 *
 * An entry point (an invoice read, a document-bank read, a bill read, a heartbeat probe) opens a
 * context with withOcrActivity(). Anything that runs inside it, however deep (the PDF text read,
 * rasterising, each model call), adds a step with ocrStep() and finds the context by itself, so the
 * low-level readers need no extra arguments. When the operation ends, ONE row is written.
 *
 * Logging must never break a read: every database or logging failure is swallowed.
 * Never put document text, file contents, keys or personal data in a step note.
 */

export type OcrSource = 'invoice' | 'document_bank' | 'electricity' | 'petty_cash' | 'meter' | 'heartbeat' | 'other';

export interface OcrStep {
    step: string;            // pdf_text_layer | rasterize | text_model | vision_model | ...
    ms: number;
    ok: boolean;
    model?: string;
    provider?: string;
    tokens_in?: number;
    tokens_out?: number;
    cost_usd?: number;
    note?: string;
}

export interface OcrMeta {
    source: OcrSource;
    orgId?: string | null;
    referenceId?: string | null;
    filename?: string | null;
    contentType?: string | null;
    bytes?: number | null;
    userId?: string | null;
}

export interface OcrOutcome {
    ok: boolean;
    path?: string | null;
    error?: string | null;
    pages?: number | null;
    fields?: Record<string, unknown> | null;
}

interface Ctx extends OcrMeta { steps: OcrStep[]; startedAt: number }

const store = new AsyncLocalStorage<Ctx>();

/** Add a step to the operation in progress. A no-op when nothing is being logged. */
export function ocrStep(s: OcrStep): void {
    store.getStore()?.steps.push({ ...s, note: s.note?.slice(0, 200) });
}

/** Fill in what the entry point learns later (the organisation, the invoice id, the file name). */
export function ocrContext(patch: Partial<OcrMeta>): void {
    const c = store.getStore();
    if (!c) return;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (c as unknown as Record<string, unknown>)[k] = v;
}

/** Time one step. Records it as ok or failed, then returns or rethrows. */
export async function ocrTimed<T>(step: string, run: () => Promise<T>, note?: (r: T) => string | undefined): Promise<T> {
    const t0 = Date.now();
    try {
        const r = await run();
        ocrStep({ step, ms: Date.now() - t0, ok: true, note: note?.(r) });
        return r;
    } catch (e) {
        ocrStep({ step, ms: Date.now() - t0, ok: false, note: e instanceof Error ? e.message : String(e) });
        throw e;
    }
}

/**
 * Run one OCR operation and write its row when it ends. If an outer entry point already opened a
 * context, this simply runs inside it: one operation is one row, however many layers it passes through.
 */
export async function withOcrActivity<T>(meta: OcrMeta, run: () => Promise<T>, summarise: (r: T) => OcrOutcome): Promise<T> {
    if (store.getStore()) return run();
    const ctx: Ctx = { ...meta, steps: [], startedAt: Date.now() };
    let result: T;
    try {
        result = await store.run(ctx, run);
    } catch (e) {
        await record(ctx, { ok: false, error: e instanceof Error ? e.message : String(e) });
        throw e;
    }
    let outcome: OcrOutcome;
    try { outcome = summarise(result); } catch { outcome = { ok: true }; }
    await record(ctx, outcome);
    return result;
}

/** Write a row for an operation that failed before it could open a context (a file that could not be fetched). */
export async function logOcr(meta: OcrMeta, outcome: OcrOutcome, steps: OcrStep[] = []): Promise<void> {
    await record({ ...meta, steps, startedAt: Date.now() }, outcome);
}

async function record(ctx: Ctx, o: OcrOutcome): Promise<void> {
    const ms = Math.max(0, Date.now() - ctx.startedAt);
    const sum = (k: 'tokens_in' | 'tokens_out' | 'cost_usd') => ctx.steps.reduce((a, s) => a + (s[k] ?? 0), 0);
    const cost = Math.round(sum('cost_usd') * 1e6) / 1e6;
    console.log(`[ocr] ${ctx.source} ${o.ok ? 'ok' : 'FAILED'} ${o.path ?? '-'} ${(ms / 1000).toFixed(1)}s $${cost.toFixed(5)}${o.error ? ` · ${o.error.slice(0, 140)}` : ''}`);
    try {
        const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
        const { error } = await supabaseAdmin.from('ocr_activity_log').insert({
            organization_id: ctx.orgId ?? null, source: ctx.source, reference_id: ctx.referenceId ?? null,
            filename: ctx.filename?.slice(0, 200) ?? null, content_type: ctx.contentType ?? null, file_bytes: ctx.bytes ?? null,
            path: o.path ?? null, ok: o.ok, error: o.error?.slice(0, 500) ?? null, duration_ms: ms, pages: o.pages ?? null,
            steps: ctx.steps, tokens_in: Math.round(sum('tokens_in')), tokens_out: Math.round(sum('tokens_out')), cost_usd: cost,
            fields: o.fields ?? null, triggered_by: ctx.userId ?? null,
        });
        if (error && !/does not exist|schema cache/i.test(error.message)) console.warn('[ocr] could not write the activity row:', error.message);
    } catch { /* logging never breaks a read */ }
}
