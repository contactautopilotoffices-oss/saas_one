const org = '00000000-0000-0000-0000-000000000001';
export function useAuth() {
    const actor = Number(new URLSearchParams(location.search).get('actor') || 11);
    const role = ({ 10: 'org_super_admin', 11: 'mst', 12: 'staff', 13: 'property_admin', 14: 'accounts', 15: 'food_vendor', 16: 'staff', 17: 'tenant', 18: 'hr', 19: 'ops_super_admin' } as Record<number, string>)[actor];
    return { membership: { org_id: org, org_role: role, is_master_admin: false, all_org_memberships: [{ org_id: org, role }], properties: [{ id: '00000000-0000-0000-0000-000000000003', organization_id: org, role, name: 'Property A' }] } };
}
