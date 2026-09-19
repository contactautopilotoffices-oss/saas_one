import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { isValidUuid } from '@/backend/lib/utils';

/**
 * Shared role gate and org resolution for the procurement catalog routes.
 * Mirrors the checks already inlined in catalog/route.ts so the template
 * import endpoints cannot drift from them.
 */

const CATALOG_MANAGER_ROLES = ['procurement', 'org_super_admin', 'master_admin'];

export async function isProcurementUser(userId: string, organizationId: string): Promise<boolean> {
    if (!isValidUuid(organizationId)) return false;

    const adminSupabase = createAdminClient();
    const { data } = await adminSupabase
        .from('organization_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .maybeSingle();

    return CATALOG_MANAGER_ROLES.includes(data?.role || '');
}

export async function resolveOrganizationId(userId: string, providedId: string | null): Promise<string | null> {
    if (providedId && isValidUuid(providedId)) return providedId;

    const adminSupabase = createAdminClient();
    const { data } = await adminSupabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

    return data?.organization_id || null;
}

/**
 * Message shown when the standard-items schema is missing.
 *
 * The template import needs columns and tables that only exist after the
 * 2026-09-19 migrations. Deploying the code before running them is an easy
 * mistake, and "Database error" gives nobody a way to fix it.
 */
export const MISSING_SCHEMA_MESSAGE =
    'The standard items upgrade has not been applied to this database yet. '
    + 'Run the pending migrations (20260919000001_procurement_catalog_standard_template, '
    + '20260919000002_procurement_catalog_lifecycle) and try again.';

/** Does this Postgres/PostgREST error mean the new schema is not there yet? */
export function isMissingSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
    if (!error) return false;

    // 42703 undefined_column · 42P01 undefined_table · PGRST20x schema-cache misses
    if (['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error.code || '')) return true;

    return /column .* does not exist|relation .* does not exist|could not find the .* column/i
        .test(error.message || '');
}

/** Bucket holding catalog item photos. Public, already used by catalog/route.ts. */
export const CATALOG_PHOTO_BUCKET = 'procurement-items';

export async function ensureCatalogPhotoBucket(): Promise<void> {
    const adminSupabase = createAdminClient();
    const { error } = await adminSupabase.storage.getBucket(CATALOG_PHOTO_BUCKET);
    if (!error) return;

    await adminSupabase.storage.createBucket(CATALOG_PHOTO_BUCKET, {
        public: true,
        allowedMimeTypes: ['image/webp', 'image/png', 'image/jpeg', 'image/gif'],
    });
}
