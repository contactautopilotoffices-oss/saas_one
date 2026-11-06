import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/** Everything the Master Admin OCR Monitor shows, in one read. */

export interface OcrRow {
    id: string; created_at: string; organization_id: string | null; source: string; reference_id: string | null; filename: string | null;
    path: string | null; ok: boolean; error: string | null; duration_ms: number | null; pages: number | null;
    steps: { step: string; ms: number; ok: boolean; model?: string; provider?: string; tokens_in?: number; tokens_out?: number; cost_usd?: number; note?: string }[];
    tokens_in: number; tokens_out: number; cost_usd: number; fields: Record<string, unknown> | null;
}
export interface Window { total: number; ok: number; failed: number; success_pct: number | null; avg_ms: number | null; p95_ms: number | null; cost_usd: number }
export interface Snapshot {
    provisioned: boolean;
    heartbeat: { status: 'healthy' | 'stale' | 'failing' | 'unknown'; last: OcrRow | null; last_ok_at: string | null; age_minutes: number | null; history: { created_at: string; ok: boolean; duration_ms: number | null }[] };
    last_hour: Window; last_24h: Window; by_source: Record<string, { total: number; failed: number }>;
    rows: OcrRow[]; generated_at: string; note?: string;
}

const STALE_AFTER_MIN = 35;   // the cron runs every 15 minutes; two missed runs is stale
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const pick = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);

function windowOf(rows: Pick<OcrRow, 'ok' | 'duration_ms' | 'cost_usd'>[]): Window {
    const ok = rows.filter((r) => r.ok).length;
    const ms = rows.map((r) => r.duration_ms).filter((v): v is number => v != null).sort((a, b) => a - b);
    return {
        total: rows.length, ok, failed: rows.length - ok, success_pct: pct(ok, rows.length),
        avg_ms: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null, p95_ms: pick(ms, 0.95),
        cost_usd: Math.round(rows.reduce((a, r) => a + Number(r.cost_usd || 0), 0) * 1e6) / 1e6,
    };
}

export async function ocrSnapshot(opts: { limit?: number; source?: string | null; failedOnly?: boolean } = {}): Promise<Snapshot> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
    const now = Date.now();
    const since24 = new Date(now - 24 * 3_600_000).toISOString();
    const since1 = now - 3_600_000;

    const probe = await supabaseAdmin.from('ocr_activity_log').select('id', { head: true, count: 'exact' }).limit(1);
    if (probe.error) return fallback(limit, opts, now);

    let feed = supabaseAdmin.from('ocr_activity_log').select('*').order('created_at', { ascending: false }).limit(limit);
    if (opts.source) feed = feed.eq('source', opts.source);
    if (opts.failedOnly) feed = feed.eq('ok', false);
    const [{ data: rows }, { data: win }, { data: beat }, { data: lastOk }, { data: hist }] = await Promise.all([
        feed,
        supabaseAdmin.from('ocr_activity_log').select('created_at, source, ok, duration_ms, cost_usd').gte('created_at', since24).order('created_at', { ascending: false }).limit(5000),
        supabaseAdmin.from('ocr_activity_log').select('*').eq('source', 'heartbeat').order('created_at', { ascending: false }).limit(1),
        supabaseAdmin.from('ocr_activity_log').select('created_at').eq('source', 'heartbeat').eq('ok', true).order('created_at', { ascending: false }).limit(1),
        supabaseAdmin.from('ocr_activity_log').select('created_at, ok, duration_ms').eq('source', 'heartbeat').order('created_at', { ascending: false }).limit(48),
    ]);

    const w = (win ?? []) as { created_at: string; source: string; ok: boolean; duration_ms: number | null; cost_usd: number }[];
    const real = w.filter((r) => r.source !== 'heartbeat');
    const by_source: Snapshot['by_source'] = {};
    for (const r of w) { const s = (by_source[r.source] ??= { total: 0, failed: 0 }); s.total++; if (!r.ok) s.failed++; }

    const last = ((beat ?? [])[0] as OcrRow | undefined) ?? null;
    const lastOkAt = ((lastOk ?? [])[0] as { created_at: string } | undefined)?.created_at ?? null;
    const ageMin = last ? Math.round((now - new Date(last.created_at).getTime()) / 60_000) : null;
    const status: Snapshot['heartbeat']['status'] = !last ? 'unknown' : !last.ok ? 'failing' : (ageMin ?? 0) > STALE_AFTER_MIN ? 'stale' : 'healthy';

    return {
        provisioned: true,
        heartbeat: { status, last, last_ok_at: lastOkAt, age_minutes: ageMin, history: ((hist ?? []) as { created_at: string; ok: boolean; duration_ms: number | null }[]).reverse() },
        last_hour: windowOf(real.filter((r) => new Date(r.created_at).getTime() >= since1)),
        last_24h: windowOf(real), by_source,
        rows: (rows ?? []) as OcrRow[], generated_at: new Date(now).toISOString(),
    };
}

/**
 * Before the migration is applied there is no log table. The invoice audit log already records each
 * invoice read (and each failure), so show those: no timings or costs, but the monitor is useful today.
 */
async function fallback(limit: number, opts: { source?: string | null; failedOnly?: boolean }, now: number): Promise<Snapshot> {
    const empty: Window = { total: 0, ok: 0, failed: 0, success_pct: null, avg_ms: null, p95_ms: null, cost_usd: 0 };
    let q = supabaseAdmin.from('invoice_audit_events').select('id, created_at, organization_id, invoice_id, event_type, details')
        .in('event_type', opts.failedOnly ? ['invoice_extraction_failed'] : ['invoice_extracted', 'invoice_extraction_failed']).order('created_at', { ascending: false }).limit(limit);
    if (opts.source && opts.source !== 'invoice') q = q.eq('event_type', '__none__');
    const { data } = await q;
    const rows: OcrRow[] = (data ?? []).map((e) => {
        const d = (e.details ?? {}) as { error?: string; path?: string; model?: string; provider?: string; lines?: number };
        const ok = e.event_type === 'invoice_extracted';
        return { id: String(e.id), created_at: e.created_at, organization_id: e.organization_id, source: 'invoice', reference_id: e.invoice_id, filename: null, path: d.path ?? null, ok, error: ok ? null : (d.error ?? 'failed'),
            duration_ms: null, pages: null, steps: d.model ? [{ step: 'model', ms: 0, ok, model: d.model, provider: d.provider }] : [], tokens_in: 0, tokens_out: 0, cost_usd: 0, fields: d.lines != null ? { lines: d.lines } : null };
    });
    const day = rows.filter((r) => now - new Date(r.created_at).getTime() < 24 * 3_600_000);
    const w = (rs: OcrRow[]): Window => ({ ...empty, total: rs.length, ok: rs.filter((r) => r.ok).length, failed: rs.filter((r) => !r.ok).length, success_pct: pct(rs.filter((r) => r.ok).length, rs.length) });
    return {
        provisioned: false, heartbeat: { status: 'unknown', last: null, last_ok_at: null, age_minutes: null, history: [] },
        last_hour: w(day.filter((r) => now - new Date(r.created_at).getTime() < 3_600_000)), last_24h: w(day), by_source: { invoice: { total: day.length, failed: day.filter((r) => !r.ok).length } },
        rows, generated_at: new Date(now).toISOString(),
        note: 'Showing invoice reads from the invoice audit log. Apply supabase/migrations/20261103000001_ocr_activity_log.sql for the live heartbeat, timings, costs and every other reader.',
    };
}
