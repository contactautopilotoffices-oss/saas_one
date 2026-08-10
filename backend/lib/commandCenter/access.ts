import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Shared access guard for every /api/command-center/* route.
 *
 * The Command Center is a cross-domain rollup: workforce attendance, utility spend,
 * PPM compliance, budget exposure and an AI narrative over all of it. Because it fuses
 * signals that are individually gated (AOP spend is super-admin + accounts; the purchase
 * mailbox is procurement-only), the composite is gated at the ADMIN tier and nothing
 * narrower is ever folded in here. In particular these routes never read mailbox_threads
 * or vendor identities — that data stays behind backend/lib/mailbox/access.ts.
 *
 * Structurally identical to backend/lib/mailbox/access.ts and backend/lib/aop/access.ts:
 * cookie session first, bearer token second, then org membership resolved with the SERVICE
 * ROLE. Every route below reads through supabaseAdmin, so this file — not RLS — is what
 * actually holds the tenancy line. Do not add a route under app/api/command-center that
 * skips it.
 *
 * PROPERTY SCOPE. An org-level admin sees the whole portfolio. A property_admin holds
 * membership rows for specific buildings only, so `propertyIds` narrows every query to
 * those buildings rather than showing them the org's full estate.
 */

const SUPER_ADMIN_ROLES = ['org_super_admin', 'master_admin'];
/** Roles that see the ENTIRE org portfolio. */
const ORG_WIDE_ROLES = [...SUPER_ADMIN_ROLES, 'org_admin', 'accounts'];
/** Roles that see the Command Center, but only for the properties they are attached to. */
const PROPERTY_SCOPED_ROLES = ['property_admin'];
const COMMAND_CENTER_ROLES = [...ORG_WIDE_ROLES, ...PROPERTY_SCOPED_ROLES];

export interface CommandCenterAccess {
    user: { id: string; email?: string };
    organizationId: string;
    isSuperAdmin: boolean;
    roles: string[];
    /**
     * Property ids this caller may see, already filtered to `organizationId` and to
     * active properties. NEVER empty on success — an admin with no readable property
     * gets a 403 rather than a silently empty dashboard.
     */
    propertyIds: string[];
    /** name/city per readable property, so routes need not re-query `properties`. */
    properties: { id: string; name: string; city: string | null }[];
    /** True when the caller sees every property in the org (not a property-scoped admin). */
    orgWide: boolean;
}

type Membership = { organization_id: string | null; property_id?: string | null; role: string | null };

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

export function readOrgId(request: NextRequest, body?: any): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('org_id') || sp.get('organization_id') || sp.get('orgId') ||
        body?.organization_id || body?.org_id || null
    );
}

export async function resolveCommandCenterAccess(
    request: NextRequest,
    requestedOrgId?: string | null,
): Promise<CommandCenterAccess | NextResponse> {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabaseAdmin
        .from('users').select('is_master_admin').eq('id', user.id).maybeSingle();
    const isMasterAdmin = !!profile?.is_master_admin;

    const [propRes, orgRes] = await Promise.all([
        supabaseAdmin.from('property_memberships')
            .select('organization_id, property_id, role').eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('organization_memberships')
            .select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
    ]);

    const propMemberships: Membership[] = propRes.data || [];
    const memberships: Membership[] = [...propMemberships, ...(orgRes.data || [])];
    const permitted = memberships.filter(m => m.role && COMMAND_CENTER_ROLES.includes(m.role));
    const orgIds = [...new Set(permitted.map(m => m.organization_id).filter(Boolean))] as string[];

    let organizationId = requestedOrgId || null;
    if (organizationId) {
        if (!(isMasterAdmin || orgIds.includes(organizationId))) {
            return NextResponse.json(
                { error: 'Forbidden: no Command Center access to this organization' }, { status: 403 });
        }
    } else if (orgIds.length === 1) {
        organizationId = orgIds[0];
    } else if (orgIds.length > 1) {
        return NextResponse.json(
            { error: 'organization_id is required (multiple organizations)' }, { status: 400 });
    } else {
        return NextResponse.json(
            { error: 'Forbidden: the Command Center is restricted to org and property admins' },
            { status: 403 });
    }

    const roles = [...new Set(
        memberships.filter(m => m.organization_id === organizationId && m.role).map(m => m.role as string),
    )];
    const isSuperAdmin = isMasterAdmin || roles.some(r => SUPER_ADMIN_ROLES.includes(r));
    const orgWide = isMasterAdmin || roles.some(r => ORG_WIDE_ROLES.includes(r));

    // `properties` is the tenancy anchor: staff_rosters, water_sources, generators,
    // diesel_readings and shift_logs carry no organization_id of their own, so every
    // downstream query filters on this id list and nothing else.
    const { data: props, error: propErr } = await supabaseAdmin
        .from('properties')
        .select('id, name, city, is_active')
        .eq('organization_id', organizationId)
        .range(0, 999);

    if (propErr) {
        console.error('[command-center access] properties', propErr.message);
        return NextResponse.json({ error: 'Could not resolve properties' }, { status: 500 });
    }

    const active = (props || []).filter(p => p.is_active !== false);
    const scoped = orgWide
        ? active
        : active.filter(p => propMemberships.some(
            m => m.organization_id === organizationId
                && m.property_id === p.id
                && m.role && PROPERTY_SCOPED_ROLES.includes(m.role)));

    if (!scoped.length) {
        return NextResponse.json(
            { error: 'Forbidden: no properties are readable for this account' }, { status: 403 });
    }

    return {
        user,
        organizationId,
        isSuperAdmin,
        roles,
        orgWide,
        propertyIds: scoped.map(p => p.id),
        properties: scoped.map(p => ({ id: p.id, name: p.name, city: p.city ?? null })),
    };
}

export function isCommandCenterAccessError(
    x: CommandCenterAccess | NextResponse,
): x is NextResponse {
    return x instanceof NextResponse;
}

/**
 * Table/view missing = migration not applied on this deployment. Every Command Center
 * route reports that as `{ provisioned: false }` with a 200 so the card renders its setup
 * state, rather than a 500 that would blank the whole dashboard.
 */
export function isMissingRelation(error: { code?: string } | null | undefined): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205';
}

/** Standard unprovisioned envelope. */
export function unprovisioned(reason: string): NextResponse {
    return NextResponse.json({ provisioned: false, reason }, { status: 200 });
}

/**
 * PostgREST caps an unbounded select at 1000 rows and gives no hint that it truncated.
 * staff_rosters (1372), ppm_schedules (749) and electricity_readings (2219) all exceed or
 * approach that, so every select in these routes passes an explicit range. Use this
 * constant so the ceiling is visible and greppable.
 */
export const ROW_CEILING = 20000;
