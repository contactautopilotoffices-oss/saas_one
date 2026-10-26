import { canonicalPhone } from '../assistant/protocol.mjs';

// Caller must authorize the organization Super Admin before using this admin query.
export async function getOrganizationUsers(admin, organizationId) {
    const pageSize = 500;
    const profile = 'user:users!user_id(id,full_name,email,phone,is_approved,approval_status,is_master_admin,deleted_at)';
    async function memberships(table) {
        const rows = [];
        for (let offset = 0; ; offset += pageSize) {
            const query = admin.from(table).select(table === 'property_memberships'
                ? `properties!inner(organization_id),${profile}` : profile)
                .eq(table === 'property_memberships' ? 'properties.organization_id' : 'organization_id', organizationId)
                .eq('is_active', true).order('user_id');
            if (table === 'property_memberships') query.order('property_id');
            const { data, error } = await query.range(offset, offset + pageSize - 1);
            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < pageSize) return rows;
        }
    }
    const groups = await Promise.all([memberships('organization_memberships'), memberships('property_memberships')]);
    const users = new Map();
    for (const row of groups.flat()) {
        const user = row.user;
        if (!user?.id || user.deleted_at) continue;
        const approved = user.is_master_admin || user.is_approved || user.approval_status === 'approved';
        users.set(user.id, { id: user.id, name: user.full_name || '', email: user.email || '', phone: user.phone || '',
            selectable: !!approved && /^\d{10,15}$/.test(canonicalPhone(user.phone)) });
    }
    return [...users.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
