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
 * The single gate for agent reads. Throws on any table outside the bundle —
 * the caller should surface that as an agent error, not silently widen scope.
 */
export async function readBundleTable<T = Record<string, unknown>>(
    organizationId: string,
    agentKey: string,
    table: string,
    build: (q: ReturnType<typeof supabaseAdmin.from>) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
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
    const { data, error } = await build(supabaseAdmin.from(table));
    if (error) throw new Error(`Bundle read failed on '${table}': ${error.message}`);
    return data ?? [];
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
