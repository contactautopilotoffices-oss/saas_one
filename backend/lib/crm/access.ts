import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * CRM access resolution.
 *
 * Tenancy & visibility rules (enforced in the API layer with the service-role
 * client — we deliberately do not rely on RLS for CRM, per product decision):
 *
 *   - A user must be an ACTIVE member of the organization (org- or property-level)
 *     with a CRM-capable role, OR a master admin.
 *   - Every CRM member sees the whole org's leads, including leads assigned to
 *     teammates — the "All Leads" view is org-wide. This matches canAccessLead(),
 *     which already lets any active CRM member open any lead in their org.
 *   - Territory grants (crm_territories) remain on CrmAccess for lead DISTRIBUTION
 *     and reporting; they no longer hide leads from the list.
 *   - Admin-only powers (deal_value, archival) are still gated by isAdmin.
 */

export const CRM_ADMIN_ROLES = ['bd_admin', 'bd_super_admin', 'org_admin', 'org_super_admin'] as const;
export const CRM_ROLES = ['bd_rep', ...CRM_ADMIN_ROLES] as const;

export interface CrmAccess {
    user: { id: string; email?: string };
    isMasterAdmin: boolean;
    organizationId: string;
    /** true => full-org visibility (admin / super admin / master) */
    isAdmin: boolean;
    /** roles the user holds in this org (deduped) */
    roles: string[];
    /** cities this rep may see — whole-city territory grants (empty for admins) */
    territoryCities: string[];
    /** campaigns this rep may see — campaign-scoped territory grants (empty for admins) */
    territoryCampaigns: string[];
}

type Membership = { organization_id: string | null; role: string | null; is_active: boolean | null };

/** Authenticate via cookie session, falling back to a Bearer token (mobile). */
async function authenticate(request: NextRequest): Promise<{ id: string; email?: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { id: user.id, email: user.email ?? undefined };

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (token) {
        const { data: { user: tokenUser } } = await supabaseAdmin.auth.getUser(token);
        if (tokenUser) return { id: tokenUser.id, email: tokenUser.email ?? undefined };
    }
    return null;
}

/** Read the desired org id from query (?org_id= / ?organization_id=) or JSON body. */
export function readOrgId(request: NextRequest, body?: any): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('org_id') ||
        sp.get('organization_id') ||
        sp.get('orgId') ||
        body?.organization_id ||
        body?.org_id ||
        null
    );
}

/**
 * Resolve the caller's CRM access for a given org. Returns a CrmAccess on
 * success, or a NextResponse (401/403) to return directly.
 */
export async function resolveCrmAccess(
    request: NextRequest,
    requestedOrgId?: string | null
): Promise<CrmAccess | NextResponse> {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabaseAdmin
        .from('users')
        .select('is_master_admin')
        .eq('id', user.id)
        .maybeSingle();
    const isMasterAdmin = !!profile?.is_master_admin;

    // All active memberships (both tables) that carry a CRM-relevant role.
    const [propRes, orgRes] = await Promise.all([
        supabaseAdmin
            .from('property_memberships')
            .select('organization_id, role, is_active')
            .eq('user_id', user.id)
            .eq('is_active', true),
        supabaseAdmin
            .from('organization_memberships')
            .select('organization_id, role, is_active')
            .eq('user_id', user.id)
            .eq('is_active', true),
    ]);

    const memberships: Membership[] = [...(propRes.data || []), ...(orgRes.data || [])];
    const crmMemberships = memberships.filter(
        (m) => m.role && (CRM_ROLES as readonly string[]).includes(m.role)
    );

    // Determine which org we're operating in.
    const crmOrgIds = [...new Set(crmMemberships.map((m) => m.organization_id).filter(Boolean))] as string[];
    let organizationId: string | null = requestedOrgId || null;

    if (organizationId) {
        const allowed = isMasterAdmin || crmOrgIds.includes(organizationId);
        if (!allowed) return NextResponse.json({ error: 'Forbidden: no CRM access to this organization' }, { status: 403 });
    } else if (crmOrgIds.length === 1) {
        organizationId = crmOrgIds[0];
    } else if (crmOrgIds.length > 1) {
        return NextResponse.json(
            { error: 'organization_id is required (user belongs to multiple organizations)' },
            { status: 400 }
        );
    } else if (isMasterAdmin) {
        return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    } else {
        return NextResponse.json({ error: 'Forbidden: no CRM access' }, { status: 403 });
    }

    const roles = [
        ...new Set(
            crmMemberships
                .filter((m) => m.organization_id === organizationId)
                .map((m) => m.role as string)
        ),
    ];
    const isAdmin =
        isMasterAdmin || roles.some((r) => (CRM_ADMIN_ROLES as readonly string[]).includes(r));

    let territoryCities: string[] = [];
    let territoryCampaigns: string[] = [];
    if (!isAdmin) {
        const { data: terr } = await supabaseAdmin
            .from('crm_territories')
            .select('city, campaign')
            .eq('user_id', user.id)
            .eq('is_active', true);
        // A row with a campaign grants that campaign; otherwise it grants the whole city.
        for (const t of terr || []) {
            const campaign = (t.campaign || '').trim();
            const city = (t.city || '').trim();
            if (campaign) territoryCampaigns.push(campaign);
            else if (city) territoryCities.push(city);
        }
    }

    return { user, isMasterAdmin, organizationId, isAdmin, roles, territoryCities, territoryCampaigns };
}

export function isCrmAccessError(x: CrmAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}

/**
 * Apply tenancy to a crm_leads PostgREST query builder.
 *
 * Every active CRM member of the org sees every lead in that org, so the
 * "All Leads" view really does list all leads — including the ones assigned to
 * other reps. This mirrors canAccessLead(), which already grants any CRM member
 * read access to any lead in their organization; before this, the list query was
 * stricter than the detail route, so teammates' leads were silently missing.
 *
 * Territory grants are NOT applied here: stopping cross-territory work belongs in
 * lead DISTRIBUTION (don't mis-assign), not in hiding rows from the table.
 */
export function scopeLeadsQuery(query: any, access: CrmAccess) {
    return query.eq('organization_id', access.organizationId);
}

/** True when this rep may act on a specific already-fetched lead row. */
export function canAccessLead(
    lead: { created_by?: string; assigned_to?: string | null; city?: string | null; location?: string | null; campaign?: string | null; organization_id?: string | null },
    access: CrmAccess
): boolean {
    if (lead.organization_id && lead.organization_id !== access.organizationId) return false;
    // Any active CRM member in the organization can view and access leads in their organization
    return true;
}

/** Escape a user-supplied term so it can't break PostgREST .or() filter grammar. */
export function sanitizeSearchTerm(term: string): string {
    // Strip the characters that have meaning in PostgREST filter strings.
    return term.replace(/[(),*"\\]/g, ' ').trim();
}

/**
 * True when this rep may read/update a crm_calls row.
 * A call is visible if:
 *   - The rep is the bd_rep on the row, OR
 *   - The rep is an admin of the row's organization.
 */
export function canAccessCall(
    call: { bd_rep_id?: string; organization_id?: string | null },
    access: CrmAccess
): boolean {
    if (call.organization_id && call.organization_id !== access.organizationId) return false;
    if (access.isAdmin) return true;
    if (call.bd_rep_id === access.user.id) return true;
    return false;
}

/**
 * Scope a crm_calls query to what the caller may see.
 * Admins see all org calls; reps see their own.
 */
export function scopeCallsQuery(query: any, access: CrmAccess) {
    query = query.eq('organization_id', access.organizationId);
    if (access.isAdmin) return query;
    return query.eq('bd_rep_id', access.user.id);
}
