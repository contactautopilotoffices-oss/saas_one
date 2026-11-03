/**
 * What we have actually paid — the rate benchmark built from Zoho PO lines by
 * supabase/migrations/20261006000001_satej_rate_benchmark.sql.
 *
 * Three uses:
 *   · before calls: a target and a walk-away rate for Meera to negotiate with
 *     (benchmarkFor → Requirement.benchmark → the call CSV);
 *   · after calls: where each quoted rate sits against history (priceCheck →
 *     CallRecord.priceCheck → the "Price" part of the score);
 *   · the rate checker in the Meera console (lookupRates).
 *
 * The numbers never leave FMS except as Meera's two negotiating figures, and she
 * is told never to say where they come from.
 *
 * Every call fails soft: no migration, no benchmark → the pipeline carries on
 * exactly as before and says so in the requirement's events.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingSchemaError } from '@/backend/lib/procurement/catalogAccess';
import type { BenchmarkSnapshot, PriceCheck, RatePool, Requirement } from './types';
import { formatRate } from './rates';

export { formatRate, spokenUnit, VERDICT_LABEL } from './rates';

export const BENCHMARK_MIGRATION = 'supabase/migrations/20261006000001_satej_rate_benchmark.sql';

/** A pool is trusted for negotiating only when it is clearly the same product, in the same unit, bought often enough. */
const MIN_SIMILARITY = 0.5;
const MIN_LINES = 3;
/** Re-read the benchmark for a requirement after this long (it is rebuilt every ~10 days). */
const STALE_MS = 3 * 86400_000;

export class BenchmarkMissingError extends Error {
    constructor() {
        super(`The rate benchmark is not set up yet: apply ${BENCHMARK_MIGRATION}.`);
    }
}

/** PGRST202: PostgREST has no such function — the migration is not applied. */
const isMissing = (error: { message?: string; code?: string }) => error.code === 'PGRST202' || isMissingSchemaError(error);

function rpcError(error: { message: string; code?: string }): never {
    if (isMissing(error)) {
        throw new BenchmarkMissingError();
    }
    throw new Error(`Rate benchmark: ${error.message}`);
}

const num = (x: unknown): number | null => (x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);

function toPool(j: Record<string, unknown> | null): RatePool | null {
    if (!j) return null;
    return {
        label: String(j.label ?? ''),
        unit: String(j.unit ?? '-'),
        similarity: num(j.similarity) ?? 0,
        unitMatch: j.unit_match === true,
        matched: Array.isArray(j.matched) ? (j.matched as { label: string; n: number; median: number }[]).map((m) => ({ label: String(m.label), n: Number(m.n), median: Number(m.median) })) : [],
        nLines: num(j.n_lines) ?? 0,
        nVendors: num(j.n_vendors) ?? 0,
        min: num(j.rate_min) ?? 0,
        p25: num(j.rate_p25) ?? 0,
        median: num(j.rate_median) ?? 0,
        p75: num(j.rate_p75) ?? 0,
        max: num(j.rate_max) ?? 0,
        median12m: num(j.median_12m),
        lastRate: num(j.last_rate),
        lastDate: j.last_date ? String(j.last_date) : null,
        lastVendor: j.last_vendor ? String(j.last_vendor) : null,
        taxPercentage: num(j.tax_percentage),
        vendors: Array.isArray(j.vendors)
            ? (j.vendors as Record<string, unknown>[]).map((v) => ({ vendor: String(v.vendor), median: Number(v.median), n: Number(v.n), lastDate: v.last_date ? String(v.last_date) : null }))
            : [],
        refreshedAt: j.refreshed_at ? String(j.refreshed_at) : null,
    };
}

export async function ratePool(organizationId: string, query: string, unit?: string | null): Promise<RatePool | null> {
    if (!query.trim()) return null;
    const { data, error } = await supabaseAdmin.rpc('satej_rate_pool', { p_org: organizationId, p_query: query, p_unit: unit || null });
    if (error) rpcError(error);
    return toPool(data as Record<string, unknown> | null);
}

export interface RateRow {
    productKey: string;
    unit: string;
    label: string;
    itemBucket: string | null;
    category: string | null;
    nLines: number;
    nVendors: number;
    min: number; p25: number; median: number; p75: number; max: number;
    median12m: number | null;
    lastRate: number;
    lastDate: string;
    lastVendor: string | null;
    taxPercentage: number | null;
    vendors: { vendor: string; median: number; n: number; last_date: string | null }[];
    sites: string[];
    similarity: number;
    unitMatch: boolean;
    refreshedAt: string;
}

/** The individual benchmark rows that look like `query`, best first — the rate checker's table. */
export async function lookupRates(organizationId: string, query: string, unit?: string | null, limit = 15): Promise<RateRow[]> {
    if (!query.trim()) return [];
    const { data, error } = await supabaseAdmin.rpc('satej_rate_lookup', { p_org: organizationId, p_query: query, p_unit: unit || null, p_limit: limit });
    if (error) rpcError(error);
    return ((data ?? []) as Record<string, unknown>[]).map((x) => ({
        productKey: String(x.product_key), unit: String(x.unit), label: String(x.label),
        itemBucket: (x.item_bucket as string) ?? null, category: (x.category as string) ?? null,
        nLines: Number(x.n_lines), nVendors: Number(x.n_vendors),
        min: Number(x.rate_min), p25: Number(x.rate_p25), median: Number(x.rate_median), p75: Number(x.rate_p75), max: Number(x.rate_max),
        median12m: num(x.median_12m), lastRate: Number(x.last_rate), lastDate: String(x.last_date), lastVendor: (x.last_vendor as string) ?? null,
        taxPercentage: num(x.tax_percentage),
        vendors: (x.vendors as RateRow['vendors']) ?? [], sites: (x.sites as string[]) ?? [],
        similarity: Number(x.similarity), unitMatch: x.unit_match === true, refreshedAt: String(x.refreshed_at),
    }));
}

export async function benchmarkStatus(organizationId: string): Promise<{ products: number; refreshedAt: string | null }> {
    const { count, error } = await supabaseAdmin.from('satej_rate_benchmark').select('product_key', { count: 'exact', head: true }).eq('organization_id', organizationId);
    if (error) rpcError(error);
    const { data } = await supabaseAdmin.from('satej_rate_benchmark').select('refreshed_at').eq('organization_id', organizationId).limit(1).maybeSingle();
    return { products: count ?? 0, refreshedAt: (data?.refreshed_at as string) ?? null };
}

/** Rebuild from the Zoho lines. All organisations when none is given (the cron). */
export async function refreshBenchmark(organizationId?: string): Promise<number> {
    const { data, error } = await supabaseAdmin.rpc('satej_refresh_rate_benchmark', { p_org: organizationId ?? null });
    if (error) rpcError(error);
    return Number(data ?? 0);
}

/**
 * The benchmark for one requirement, or null when there is nothing trustworthy.
 * Tries the team's own description first (it carries the product words), then
 * Meera's spoken summary and category.
 */
export async function benchmarkFor(r: Requirement): Promise<BenchmarkSnapshot | null> {
    const unit = r.input.unit || r.brief?.unit || null;
    const queries = [r.input.itemDescription, r.brief?.itemSummary, r.input.title, r.brief?.itemCategory]
        .map((q) => (q ?? '').trim())
        .filter((q, i, all) => q && all.indexOf(q) === i);
    for (const query of queries) {
        const pool = await ratePool(r.organizationId, query, unit);
        if (!pool || pool.similarity < MIN_SIMILARITY || pool.nLines < MIN_LINES) continue;
        if (unit && !pool.unitMatch && pool.unit !== '-') continue; // a rate per can says nothing about a rate per piece
        // Aim for what we have achieved (the cheaper quarter); never go above the usual price, recent or not.
        const recent = pool.median12m ?? pool.median;
        const target = Math.min(pool.p25, recent);
        const walkAway = Math.min(pool.p75, Math.max(pool.median, recent) * 1.05);
        return {
            query,
            unit: pool.unit,
            pool,
            targetRate: target > 0 ? Number(formatRate(target).replace(/,/g, '')) : null,
            walkAwayRate: walkAway > 0 ? Number(formatRate(walkAway).replace(/,/g, '')) : null,
            confidence: pool.similarity >= 0.6 && pool.nLines >= 5 ? 'high' : 'medium',
            checkedAt: new Date().toISOString(),
        };
    }
    return null;
}

/**
 * Attach (or refresh) the requirement's benchmark. Never throws: the calls go
 * ahead without a target if the benchmark is missing or broken.
 * Returns a line for the requirement's event log, or null when nothing changed.
 */
export async function ensureBenchmark(r: Requirement, force = false): Promise<string | null> {
    const fresh = r.benchmarkCheckedAt && Date.now() - Date.parse(r.benchmarkCheckedAt) < STALE_MS;
    if (fresh && !force) return null;
    try {
        const b = await benchmarkFor(r);
        r.benchmark = b;
        r.benchmarkCheckedAt = new Date().toISOString();
        if (!b) return 'No price history close enough to this item, so Meera will ask for a rate without a target';
        const per = b.unit !== '-' ? ` per ${b.unit}` : '';
        return `Price history: ₹${formatRate(b.pool.median)}${per} usual (${b.pool.nLines} past orders). Meera will aim for ₹${formatRate(b.targetRate ?? 0)}, ceiling ₹${formatRate(b.walkAwayRate ?? 0)}`;
    } catch (e) {
        r.benchmarkCheckedAt = new Date().toISOString();
        return e instanceof BenchmarkMissingError ? e.message : `Could not read the rate benchmark: ${e instanceof Error ? e.message : String(e)}`;
    }
}

/** Where one quoted rate sits against what we have paid. Null when no rate, no benchmark, or the lookup failed. */
export async function priceCheck(r: Requirement, rate: number | null, unit: string | null): Promise<PriceCheck | null> {
    if (rate === null || !(rate > 0)) return null;
    const query = r.benchmark?.query || r.input.itemDescription || r.brief?.itemSummary || '';
    if (!query) return null;
    const { data, error } = await supabaseAdmin.rpc('satej_quote_verdict', {
        p_org: r.organizationId, p_query: query, p_unit: unit || r.benchmark?.unit || r.input.unit || null, p_rate: rate,
    });
    if (error) {
        if (isMissing(error)) return null;
        throw new Error(`Rate benchmark: ${error.message}`);
    }
    const j = (data ?? {}) as Record<string, unknown>;
    const pool = toPool((j.benchmark as Record<string, unknown>) ?? null);
    return {
        rate,
        unit: pool?.unit ?? unit ?? '',
        verdict: (j.verdict as PriceCheck['verdict']) ?? 'no_benchmark',
        confidence: (j.confidence as PriceCheck['confidence']) ?? 'low',
        deltaPct: num(j.delta_pct),
        median: pool?.median ?? null,
        p25: pool?.p25 ?? null,
        p75: pool?.p75 ?? null,
        nLines: pool?.nLines ?? 0,
        label: pool?.label ?? '',
    };
}
