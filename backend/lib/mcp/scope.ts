import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * What one user belongs to: the organisations and properties they hold an ACTIVE membership in.
 *
 * Used as a second fence in front of the FMS routes. The routes keep making their own role
 * decisions; this fence only guarantees the assistant can never name an organisation or a
 * property the user is not part of, even on a route whose own check is weak.
 */
export type UserScope = {
    orgs: { id: string; name: string | null; roles: string[] }[];
    properties: { id: string; name: string | null; organization_id: string | null; roles: string[]; via: 'property' | 'organisation' }[];
    orgIds: Set<string>;
    propertyIds: Set<string>;
};

export async function loadUserScope(userId: string): Promise<UserScope> {
    const [orgMems, propMems] = await Promise.all([
        supabaseAdmin
            .from('organization_memberships')
            .select('organization_id, role, is_active')
            .eq('user_id', userId),
        supabaseAdmin
            .from('property_memberships')
            .select('property_id, role, is_active')
            .eq('user_id', userId),
    ]);
    if (orgMems.error) throw new Error(`could not read organisation memberships: ${orgMems.error.message}`);
    if (propMems.error) throw new Error(`could not read property memberships: ${propMems.error.message}`);

    const orgRoles = new Map<string, string[]>();
    for (const m of orgMems.data || []) {
        if (m.is_active === false || !m.organization_id) continue;
        const list = orgRoles.get(m.organization_id) || [];
        if (m.role) list.push(String(m.role));
        orgRoles.set(m.organization_id, list);
    }
    const propRoles = new Map<string, string[]>();
    for (const m of propMems.data || []) {
        if (m.is_active === false || !m.property_id) continue;
        const list = propRoles.get(m.property_id) || [];
        if (m.role) list.push(String(m.role));
        propRoles.set(m.property_id, list);
    }

    const orgIdList = [...orgRoles.keys()];
    const directPropIds = [...propRoles.keys()];

    // Properties: the ones held directly, plus every property of an organisation the user is a member of.
    const [orgRows, orgProps, directProps] = await Promise.all([
        orgIdList.length
            ? supabaseAdmin.from('organizations').select('id, name').in('id', orgIdList)
            : Promise.resolve({ data: [] as { id: string; name: string | null }[], error: null }),
        orgIdList.length
            ? supabaseAdmin.from('properties').select('id, name, organization_id').in('organization_id', orgIdList)
            : Promise.resolve({ data: [] as { id: string; name: string | null; organization_id: string | null }[], error: null }),
        directPropIds.length
            ? supabaseAdmin.from('properties').select('id, name, organization_id').in('id', directPropIds)
            : Promise.resolve({ data: [] as { id: string; name: string | null; organization_id: string | null }[], error: null }),
    ]);
    if (orgRows.error) throw new Error(`could not read organisations: ${orgRows.error.message}`);
    if (orgProps.error) throw new Error(`could not read properties: ${orgProps.error.message}`);
    if (directProps.error) throw new Error(`could not read properties: ${directProps.error.message}`);

    const orgName = new Map((orgRows.data || []).map(o => [o.id, o.name ?? null]));
    const properties = new Map<string, UserScope['properties'][number]>();
    for (const p of directProps.data || []) {
        properties.set(p.id, { id: p.id, name: p.name ?? null, organization_id: p.organization_id ?? null, roles: propRoles.get(p.id) || [], via: 'property' });
    }
    for (const p of orgProps.data || []) {
        if (!properties.has(p.id)) {
            properties.set(p.id, { id: p.id, name: p.name ?? null, organization_id: p.organization_id ?? null, roles: [], via: 'organisation' });
        }
    }
    // A property membership also places the user in that property's organisation, for routes that ask for an org id.
    const orgIds = new Set(orgIdList);
    for (const p of properties.values()) if (p.organization_id) orgIds.add(p.organization_id);

    return {
        orgs: [...orgIds].map(id => ({ id, name: orgName.get(id) ?? null, roles: orgRoles.get(id) || [] })),
        properties: [...properties.values()],
        orgIds,
        propertyIds: new Set(properties.keys()),
    };
}

export function hasAnyMembership(scope: UserScope): boolean {
    return scope.orgIds.size > 0 || scope.propertyIds.size > 0;
}

const ORG_KEY = /^(org|orgid|org_id|organization|organizationid|organization_id|organisation|organisationid|organisation_id)$/i;
const PROPERTY_KEY = /^(property|propertyid|property_id|propertyids|property_ids)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refuse a request that names an organisation or property outside the user's scope.
 * `params` holds both the path parameters ({orgId}, {propertyId}) and the query parameters.
 * Values may be a single id, a comma list, or "all" (the route then applies its own scope).
 */
export function checkScope(scope: UserScope, params: Record<string, string>): { ok: true } | { ok: false; reason: string } {
    for (const [key, raw] of Object.entries(params)) {
        const isOrg = ORG_KEY.test(key);
        const isProp = PROPERTY_KEY.test(key);
        if (!isOrg && !isProp) continue;
        const values = String(raw).split(',').map(v => v.trim()).filter(Boolean);
        for (const v of values) {
            if (v.toLowerCase() === 'all') continue;
            if (!UUID.test(v)) return { ok: false, reason: `${key} must be an id from whoami (got "${v.slice(0, 40)}")` };
            if (isOrg && !scope.orgIds.has(v)) return { ok: false, reason: `you are not a member of organisation ${v}` };
            if (isProp && !scope.propertyIds.has(v)) return { ok: false, reason: `you do not have access to property ${v}` };
        }
    }
    return { ok: true };
}
