import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { getZohoFreshness } from '@/backend/services/zohoVendorSync';
import type { VendorProfile, VendorProfileListResponse, ComplianceStatus } from '@/backend/lib/accounts/trackerTypes';

/**
 * GET /api/accounts/vendor-profiles — the compliance list.
 *
 * Exists so PATCH /api/accounts/vendor-profiles/[id] is reachable: without a list there is
 * no way for the UI to learn an id. Paged explicitly — an org with hundreds of suppliers
 * would otherwise hit PostgREST's 1000-row cap and silently show a partial roster.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const UNDEFINED_TABLE = '42P01';

const COMPLIANCE_STATUSES: ComplianceStatus[] = ['unverified', 'in_review', 'verified', 'rejected', 'expired'];

export async function GET(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(sp.get('page_size') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
    const search = (sp.get('search') || '').trim();
    const status = sp.get('compliance_status');
    const includeInactive = sp.get('include_inactive') === 'true';

    if (status && !COMPLIANCE_STATUSES.includes(status as ComplianceStatus)) {
        return NextResponse.json(
            { error: `Unknown compliance_status "${status}". Expected one of: ${COMPLIANCE_STATUSES.join(', ')}` },
            { status: 400 },
        );
    }

    let q = supabaseAdmin
        .from('vendor_profiles')
        .select('*', { count: 'exact' })
        .eq('organization_id', access.organizationId);

    if (!includeInactive) q = q.eq('is_active', true);
    if (status) q = q.eq('compliance_status', status);
    if (search) {
        const s = search.replace(/[,()]/g, ' ');
        q = q.or(`vendor_name.ilike.%${s}%,gstin.ilike.%${s}%,pan.ilike.%${s}%`);
    }

    const from = (page - 1) * pageSize;
    const { data, error, count } = await q.order('vendor_name', { ascending: true }).range(from, from + pageSize - 1);

    if (error) {
        if (error.code === UNDEFINED_TABLE) {
            return NextResponse.json(
                { error: 'Vendor compliance requires a pending database migration (20260805000001). Apply migrations and retry.' },
                { status: 503 },
            );
        }
        console.error('Vendor profile list error:', error);
        return NextResponse.json({ error: 'Failed to read vendor profiles' }, { status: 500 });
    }

    // How current the Zoho mirror is, ORG-WIDE — not for the 50 rows on screen. Someone
    // about to trust a GSTIN needs to know whether three quarters of the roster has never
    // been fetched, and a page-scoped figure would hide exactly that. Never fatal: a
    // freshness read that fails must not take the roster down with it.
    const fresh = await getZohoFreshness(access.organizationId).catch(() => null);

    const total = count || 0;
    const body: VendorProfileListResponse = {
        organization_id: access.organizationId,
        vendor_profiles: (data || []) as VendorProfile[],
        pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
        can: { align: access.canAlign, complete: access.canComplete, admin: access.isAdmin },
        zoho_sync: {
            // false also covers "20260806000001 not applied yet" — a setup state the UI
            // should describe, not an error and not a claim that nothing has synced.
            available: !!fresh?.available,
            linked: fresh?.linked ?? 0,
            never_enriched: fresh?.neverEnriched ?? 0,
            oldest_synced_at: fresh?.oldest ?? null,
            newest_synced_at: fresh?.newest ?? null,
        },
    };
    return NextResponse.json(body);
}
