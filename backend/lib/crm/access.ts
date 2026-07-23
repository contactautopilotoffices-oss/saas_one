import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { cityFilterOr, parentCity } from '@/backend/lib/crm/cityGroups';

/**
 * CRM access resolution.
 *
 * Tenancy & visibility rules (enforced in the API layer with the service-role
 * client — we deliberately do not rely on RLS for CRM, per product decision):
 *
 *   - A user must be an ACTIVE member of the organization (org- or property-level)
 *     with a CRM-capable role, OR a master admin.
 *   - bd_admin / org_admin / org_super_admin / master_admin  -> see the whole org.
 *   - bd_rep -> sees leads they created or are assigned to (assignment = ownership,
 *     always visible), PLUS leads in the markets (cities) assigned to them in
 *     BD-admin settings (crm_territories). Cross-territory leakage is prevented at
 *     the distribution layer (don't mis-assign), not by hiding owned leads.
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
 * Apply org + rep-market visibility to a crm_leads PostgREST query builder.
 * Admins get the whole org; reps see (mine OR market-matched): leads they created
 * or are ASSIGNED to (assignment = ownership, always visible), PLUS leads in the
 * cities/campaigns granted to them as territory.
 *
 * NOTE: We deliberately do NOT hide assigned-but-out-of-territory leads — a rep
 * must always see/work a lead that's theirs. Stopping cross-territory leakage
 * belongs in lead DISTRIBUTION (don't mis-assign), not here.
 */
export function scopeLeadsQuery(query: any, access: CrmAccess) {
    query = query.eq('organization_id', access.organizationId);
    if (access.isAdmin) return query;

    const ors: string[] = [`created_by.eq.${access.user.id}`, `assigned_to.eq.${access.user.id}`];
    if (access.territoryCities.length > 0) {
        // Metro-aware: a "Mumbai" grant must cover its neighbourhoods (Lower Parel,
        // Andheri, …), matched against city AND location — so reps in the same city
        // see each other's whole-market leads. cityFilterOr expands the aliases.
        const cityOr = cityFilterOr(access.territoryCities);
        if (cityOr) ors.push(cityOr);
    }
    if (access.territoryCampaigns.length > 0) {
        const list = access.territoryCampaigns.map((c) => `"${c.replace(/"/g, '')}"`).join(',');
        ors.push(`campaign.in.(${list})`);
    }
    return query.or(ors.join(','));
}

/** True when this rep may act on a specific already-fetched lead row. */
export function canAccessLead(
    lead: { created_by?: string; assigned_to?: string | null; city?: string | null; campaign?: string | null; organization_id?: string | null },
    access: CrmAccess
): boolean {
    if (lead.organization_id && lead.organization_id !== access.organizationId) return false;
    if (access.isAdmin) return true;
    // Ownership always grants access — a rep can open any lead they created or are
    // assigned to, regardless of territory (territory only widens DISCOVERY).
    if (lead.created_by === access.user.id) return true;
    if (lead.assigned_to === access.user.id) return true;
    // Metro-aware territory match: a "Mumbai" grant covers "Lower Parel"/"Andheri"
    // (and the lead's location field too), so it agrees with scopeLeadsQuery.
    if (lead.city || lead.campaign) {
        const leadMetro = lead.city ? parentCity(lead.city).toLowerCase() : '';
        if (leadMetro && access.territoryCities.some((c) => parentCity(c).toLowerCase() === leadMetro)) return true;
        const leadCampaign = (lead.campaign || '').toLowerCase();
        if (leadCampaign && access.territoryCampaigns.some((c) => c.toLowerCase() === leadCampaign)) return true;
    }
    return false;
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
