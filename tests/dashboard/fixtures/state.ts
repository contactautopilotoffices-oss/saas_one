const orgId = '00000000-0000-0000-0000-000000000001';
const property = { id: '00000000-0000-0000-0000-000000000003', organization_id: orgId, name: 'Fixture Property', code: 'FIX', address: 'Fixture Address' };
function makeAuth(role: string) {
    const membership = { org_id: orgId, org_role: role, is_master_admin: role === 'master_admin', all_org_memberships: [{ org_id: orgId, role }], properties: [{ ...property, role }] };
    const auth = { user: { id: 'fixture-user', email: 'fixture@example.test', user_metadata: { full_name: 'Fixture User', role } }, membership, signOut: () => {}, isLoading: false, isMembershipLoading: false };
    return auth;
}
const authCache = new Map<string, ReturnType<typeof makeAuth>>();
function fixtureAuth() {
    const role = new URLSearchParams(location.search).get('role') || 'org_super_admin';
    let auth = authCache.get(role);
    if (!auth) { auth = makeAuth(role); authCache.set(role, auth); }
    return auth;
}
export function useAuth() { return fixtureAuth(); }
export function useAppSession() { const { membership } = useAuth(); return { isLoading: false, session: { role: membership.org_role, org_id: orgId, property_ids: [property.id] } }; }
export function useTheme() { return { theme: 'light', toggleTheme: () => {} }; }
const cache = { getCachedData: (key: string) => key.startsWith('property-') ? property : null, setCachedData: () => {}, invalidateCache: () => {} };
export function useDataCache() { return cache; }
const client = {
    from(table: string) {
        let single = false;
        const query: object = new Proxy({}, { get(_target, method) {
            const data = () => table === 'organizations' ? { id: orgId, name: 'Fixture Organization', code: 'FIX' }
                : table === 'properties' ? single ? property : [property]
                : table === 'organization_memberships' || table === 'property_memberships' ? single ? { role: fixtureAuth().membership.org_role, organization_id: orgId } : []
                : table === 'users' ? { full_name: 'Fixture User', email: 'fixture@example.test' } : [];
            if (method === 'then') return (resolve: (result: { data: unknown; error: null; count: number }) => unknown) => Promise.resolve({ data: data(), error: null, count: 0 }).then(resolve);
            if (method === 'single' || method === 'maybeSingle') return () => { single = true; return query; };
            if (['insert', 'update', 'delete', 'upsert'].includes(String(method))) return () => { throw new Error('Fixture rejects writes'); };
            return () => query;
        } }); return query;
    },
    auth: { getSession: async () => ({ data: { session: { user: fixtureAuth().user } } }), getUser: async () => ({ data: { user: fixtureAuth().user } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {},
};
export function createClient() { return client; }
