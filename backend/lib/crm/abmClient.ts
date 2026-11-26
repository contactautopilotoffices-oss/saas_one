import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * ABM outbound system client.
 *
 * The ABM system lives in a SEPARATE Supabase project (`ABM_Project`), not in
 * this app's database. See docs/abm/CRM_ALIGNMENT.md for why it is federated
 * rather than ported: its tables are `abm_*`, have no organization_id, and its
 * RLS is on with zero policies so only service_role can read them.
 *
 * That last point is why this needs the ABM project's service-role key and not
 * its anon key: with no policies, anon reads nothing. The key is server-side
 * only and must never be exposed as NEXT_PUBLIC_*.
 *
 * Both variables are optional. When either is missing this returns null and
 * the caller reports "not configured" rather than throwing, so the CRM page
 * degrades to an explanatory empty state instead of a 500.
 */

let cached: SupabaseClient | null | undefined;

export function getAbmClient(): SupabaseClient | null {
    if (cached !== undefined) return cached;

    const url = process.env.ABM_SUPABASE_URL;
    const key = process.env.ABM_SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        cached = null;
        return cached;
    }

    cached = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    return cached;
}

/** True when both ABM env vars are present. */
export function isAbmConfigured(): boolean {
    return Boolean(process.env.ABM_SUPABASE_URL && process.env.ABM_SUPABASE_SERVICE_ROLE_KEY);
}
