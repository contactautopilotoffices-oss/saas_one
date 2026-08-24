/**
 * Agent data-bundle containment.
 *
 * Every agent gets ONE versioned bundle: the exact tables it may touch.
 * All agent-side reads go through readBundleTable(), which refuses any
 * table not in the active bundle. This is what stops an agent from
 * fragmenting into data it was never scoped to.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { OemBundle, OemBundleTable } from './types';

export async function getActiveBundle(
    organizationId: string,
    agentKey: string
): Promise<{ bundle: OemBundle; version: number } | null> {
    const { data, error } = await supabaseAdmin
        .from('oem_agent_bundles')
        .select('bundle, version')
        .eq('organization_id', organizationId)
        .eq('agent_key', agentKey)
        .eq('is_active', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !data) return null;
    return { bundle: data.bundle as OemBundle, version: data.version };
}

export function isTableAllowed(
    bundle: OemBundle,
    table: string,
    access: 'read' | 'write' = 'read'
): boolean {
    const entry = bundle.tables.find((t) => t.name === table);
    if (!entry) return false;
    if (access === 'write') return entry.access === 'write';
    return true; // read is allowed for both read and write entries
}

/**
 * The single gate for agent reads.
 *
 * Containment is enforced on three axes, because the table name alone is not
 * enough: PostgREST embedded-resource syntax (`select=id,ticket:tickets(*)`)
 * would let a caller traverse foreign keys out of the bundle while the table
 * name still looked allowed.
 *   1. the table must be in the active bundle
 *   2. the select string may not embed related resources
 *   3. the query is org-scoped inside the guard, not by the caller
 */
export async function readBundleTable<T = Record<string, unknown>>(
    organizationId: string,
    agentKey: string,
    table: string,
    select: string,
    refine?: (q: BundleQuery) => BundleQuery
): Promise<T[]> {
    const active = await getActiveBundle(organizationId, agentKey);
    if (!active) {
        throw new Error(`Agent '${agentKey}' has no active data bundle — refusing all reads.`);
    }
    if (!isTableAllowed(active.bundle, table, 'read')) {
        throw new Error(
            `Bundle violation: agent '${agentKey}' (bundle v${active.version}) attempted to read '${table}', which is not in its bundle.`
        );
    }
    assertNoEmbeddedResources(agentKey, table, select);
    assertColumnsAllowed(active.bundle, agentKey, table, select);

    const base = supabaseAdmin
        .from(table)
        .select(select)
        .eq('organization_id', organizationId) as unknown as BundleQuery;

    const { data, error } = await (refine ? refine(base) : base);
    if (error) throw new Error(`Bundle read failed on '${table}': ${error.message}`);
    return (data ?? []) as T[];
}

/**
 * Minimal query surface handed to a bundle caller. Deliberately narrow: only
 * row-level filters, ordering and limits. No select(), so the column set
 * validated above cannot be widened after the check.
 */
export interface BundleQuery extends PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> {
    eq(column: string, value: unknown): BundleQuery;
    neq(column: string, value: unknown): BundleQuery;
    in(column: string, values: readonly unknown[]): BundleQuery;
    gte(column: string, value: unknown): BundleQuery;
    lte(column: string, value: unknown): BundleQuery;
    is(column: string, value: unknown): BundleQuery;
    not(column: string, operator: string, value: unknown): BundleQuery;
    order(column: string, opts?: { ascending?: boolean }): BundleQuery;
    limit(count: number): BundleQuery;
}

/**
 * PostgREST treats `alias:related(...)` in a select as a join. Any parenthesis
 * in a select string is therefore a potential escape from the bundle.
 */
export function assertNoEmbeddedResources(agentKey: string, table: string, select: string): void {
    if (select.includes('(') || select.includes(')')) {
        throw new Error(
            `Bundle violation: agent '${agentKey}' used embedded-resource syntax in its select on '${table}'. ` +
            `Joins traverse out of the bundle and are not permitted. Select plain columns only.`
        );
    }
    if (select.trim() === '*') {
        throw new Error(
            `Bundle violation: agent '${agentKey}' used 'select *' on '${table}'. List columns explicitly.`
        );
    }
}

/** If the bundle entry pins columns, the select may not exceed them. */
export function assertColumnsAllowed(
    bundle: OemBundle,
    agentKey: string,
    table: string,
    select: string
): void {
    const entry = bundle.tables.find((t) => t.name === table);
    if (!entry?.columns?.length) return;
    const allowed = new Set(entry.columns);
    const requested = select.split(',').map((c) => c.trim()).filter(Boolean);
    const outside = requested.filter((c) => !allowed.has(c));
    if (outside.length) {
        throw new Error(
            `Bundle violation: agent '${agentKey}' requested column(s) [${outside.join(', ')}] on '${table}', ` +
            `outside its bundled columns [${entry.columns.join(', ')}].`
        );
    }
}

/** Human/agent-readable description of a bundle, embedded in generated prompts. */
export function describeBundle(bundle: OemBundle): string {
    if (!bundle.tables.length) return 'No tables. This agent may not read any data yet.';
    return bundle.tables
        .map((t: OemBundleTable) => {
            const cols = t.columns?.length ? ` (columns: ${t.columns.join(', ')})` : '';
            const why = t.purpose ? ` — ${t.purpose}` : '';
            return `- ${t.name} [${t.access}]${cols}${why}`;
        })
        .join('\n');
}
