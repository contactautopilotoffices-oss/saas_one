/**
 * Who is talking, and what they may see. Built from the database, never from the AI.
 *
 * Owner decisions (2026-11-03/04, docs/AI_ACTION_LAYER_PLAN.md section 6.1):
 * - An org-level role answers about every property of its own organization.
 * - A property-level role answers only about the properties it holds an active, approved membership for.
 * - A super tenant sees only the properties assigned to it in super_tenant_properties.
 * - Tenant and vendor roles only ever see their own records inside those properties.
 *
 * Deliberately NOT isOrganizationWideUserRole() (backend/lib/users/managementRoles.ts): that list was written for user
 * management and includes super_tenant, tech, it, design and hr, which must not get org-wide reads here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorContext } from './types';

/** Org-wide for every module this layer offers. Explicit on purpose (plan decision D9). */
export const AI_ORG_WIDE_ROLES = ['org_super_admin', 'ops_super_admin', 'org_admin', 'owner'] as const;
export const AI_TENANT_ROLES = ['tenant', 'super_tenant'] as const;
export const AI_VENDOR_ROLES = ['vendor', 'maintenance_vendor'] as const;

const has = (list: readonly string[], role: string) => list.includes(role);

export interface ScopeRows {
    userApproved: boolean;
    orgMemberships: Array<{ organization_id: string | null; role: string | null; is_active: boolean | null; approval_status?: string | null }>;
    propertyMemberships: Array<{ property_id: string | null; role: string | null; is_active: boolean | null; approval_status?: string | null }>;
    /** Every active, not deleted property of the org: id → name. */
    orgProperties: Record<string, string>;
    /** Properties assigned to this user in super_tenant_properties for this org. */
    superTenantPropertyIds: string[];
}

/** A membership counts only when active and approved (null = rows from before approvals existed). */
function live(m: { is_active: boolean | null; approval_status?: string | null }): boolean {
    return m.is_active !== false && (m.approval_status == null || m.approval_status === 'approved');
}

/**
 * Pure: turn membership rows into the actor context. Returns null when the person has no usable access in this org.
 * Mixed roles: if a person holds a staff role at any property, only those properties are used (and tenant-only
 * properties are dropped), so the narrower reading always wins.
 */
export function computeActor(userId: string, orgId: string, rows: ScopeRows): ActorContext | null {
    if (!rows.userApproved) return null;
    const orgRoles = rows.orgMemberships
        .filter(m => m.organization_id === orgId && live(m) && m.role)
        .map(m => String(m.role).toLowerCase().trim());
    // Only properties that belong to this org and are active.
    const propMems = rows.propertyMemberships
        .filter(m => live(m) && m.property_id && rows.orgProperties[m.property_id] !== undefined && m.role)
        .map(m => ({ propertyId: m.property_id as string, role: String(m.role).toLowerCase().trim() }));

    const roles = [...new Set([...orgRoles, ...propMems.map(m => m.role)])];
    if (!roles.length) return null;

    const names = (ids: string[]) => Object.fromEntries(ids.map(id => [id, rows.orgProperties[id]]));
    const base = { userId, orgId, roles };

    if (orgRoles.some(r => has(AI_ORG_WIDE_ROLES, r))) {
        const ids = Object.keys(rows.orgProperties);
        return { ...base, orgWide: true, propertyIds: ids, propertyNames: names(ids), ownRecordsOnly: false, recordRule: 'all_in_scope' };
    }

    const staffProps = propMems.filter(m => !has(AI_TENANT_ROLES, m.role) && !has(AI_VENDOR_ROLES, m.role)).map(m => m.propertyId);
    if (staffProps.length) {
        const ids = [...new Set(staffProps)];
        return { ...base, orgWide: false, propertyIds: ids, propertyNames: names(ids), ownRecordsOnly: false, recordRule: 'all_in_scope' };
    }

    const isSuperTenant = roles.includes('super_tenant');
    const isTenant = isSuperTenant || roles.includes('tenant');
    let ids: string[];
    if (isSuperTenant) {
        // Owner 2026-11-04: a super tenant sees only the properties we have given it.
        ids = rows.superTenantPropertyIds.filter(id => rows.orgProperties[id] !== undefined);
    } else {
        ids = propMems.map(m => m.propertyId);
    }
    ids = [...new Set(ids)];
    if (!ids.length) return null;
    return {
        ...base, orgWide: false, propertyIds: ids, propertyNames: names(ids), ownRecordsOnly: true,
        recordRule: isTenant ? 'raised_by_me' : 'assigned_to_me',
    };
}

/** Load the rows for computeActor with the service-role client (reads only). */
export async function loadActor(admin: SupabaseClient, userId: string, orgId: string): Promise<ActorContext | null> {
    const [profile, orgMems, propMems, props, st] = await Promise.all([
        admin.from('users').select('is_approved, approval_status').eq('id', userId).maybeSingle(),
        admin.from('organization_memberships').select('organization_id, role, is_active, approval_status').eq('user_id', userId),
        admin.from('property_memberships').select('property_id, role, is_active, approval_status').eq('user_id', userId),
        admin.from('properties').select('id, name, is_active, deleted_at').eq('organization_id', orgId),
        admin.from('super_tenant_properties').select('property_id').eq('user_id', userId).eq('organization_id', orgId),
    ]);
    for (const r of [profile, orgMems, propMems, props]) if (r.error) throw new Error(r.error.message);
    const orgProperties: Record<string, string> = {};
    for (const p of (props.data || []) as Array<{ id: string; name: string | null; is_active: boolean | null; deleted_at: string | null }>) {
        if (p.is_active !== false && !p.deleted_at) orgProperties[p.id] = p.name || 'Property';
    }
    const u = profile.data as { is_approved?: boolean | null; approval_status?: string | null } | null;
    return computeActor(userId, orgId, {
        userApproved: !!u && (u.is_approved === true || u.approval_status === 'approved'),
        orgMemberships: (orgMems.data || []) as ScopeRows['orgMemberships'],
        propertyMemberships: (propMems.data || []) as ScopeRows['propertyMemberships'],
        orgProperties,
        // A missing super_tenant_properties table only narrows (no properties), never widens.
        superTenantPropertyIds: st.error ? [] : ((st.data || []) as Array<{ property_id: string }>).map(r => r.property_id),
    });
}
