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
