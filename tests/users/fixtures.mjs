import { loadTs } from '../petty-cash/load-ts.mjs';

// In-memory PostgREST boundary. Profiles deliberately have no organization_id.
export function fixture({ callerRole = 'ops_super_admin', active = true, authenticated = true, master = false } = {}) {
    const db = {
        users: [{ id: 'caller', full_name: 'Caller', is_master_admin: master }, { id: 'pending', full_name: 'Pending', email: 'pending@test', is_approved: false, approval_status: 'pending' }, { id: 'unassigned', full_name: 'Unassigned', is_approved: false }],
        properties: [{ id: 'p1', organization_id: 'o1', name: 'One' }, { id: 'p2', organization_id: 'o1', name: 'Two' }, { id: 'p3', organization_id: 'o2', name: 'Other' }],
        organization_memberships: [{ user_id: 'caller', organization_id: 'o1', role: callerRole, is_active: active }],
        property_memberships: [{ user_id: 'pending', property_id: 'p1', organization_id: 'o1', role: 'staff', is_active: false, approval_status: 'pending' }], employee_profiles: [], user_management_audit_logs: []
    };
    const writes = [], authCalls = [], reads = [];
    const client = {
        auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'caller' } : null }, error: null }), admin: {
            createUser: async payload => { authCalls.push(['create', payload]); db.users.push({ id: 'created', email: payload.email }); return { data: { user: { id: 'created', email: payload.email } }, error: null }; },
            inviteUserByEmail: async (...args) => { authCalls.push(['invite', ...args]); return { data: { user: { id: 'created' } }, error: null }; },
            updateUserById: async (...args) => { authCalls.push(['update', ...args]); return { data: {}, error: null }; }, deleteUser: async () => ({ error: null })
        } },
        from(table) {
            let operation = 'select', values, columns = '*'; const filters = [];
            const embed = row => ({ ...row, user: db.users.find(u => u.id === row.user_id), property: db.properties.find(p => p.id === row.property_id) });
            const match = row => filters.every(([key, value, kind]) => {
                const actual = key.startsWith('property.') ? db.properties.find(p => p.id === row.property_id)?.[key.slice(9)] : row[key];
                return kind === 'in' ? value.includes(actual) : actual === value;
            });
            const execute = single => {
                if (table === 'users' && filters.some(([key]) => key === 'organization_id')) return { data: null, error: { message: 'column users.organization_id does not exist' } };
                if (filters.some(([key]) => key.startsWith('properties.'))) return { data: null, error: { message: 'wrong embed alias' } };
                if (operation !== 'select') {
                    writes.push({ table, operation, values, filters: [...filters] });
                    if (operation === 'update') db[table].filter(match).forEach(row => Object.assign(row, values));
                    else (Array.isArray(values) ? values : [values]).forEach(row => db[table].push({ ...row }));
                    return { data: null, error: null };
                }
                reads.push({ table, filters: [...filters], columns });
                const rows = db[table].filter(match).map(embed);
                if (single && rows.length > 1) return { data: null, error: { message: 'multiple rows' } };
                return { data: single ? rows[0] || null : rows, error: null };
            };
            const q = { select(v) { columns = v; return q; }, eq(k, v) { filters.push([k, v]); return q; }, in(k, v) { filters.push([k, v, 'in']); return q; }, is(k, v) { filters.push([k, v]); return q; }, or() { return q; }, update(v) { operation = 'update'; values = v; return q; }, insert(v) { operation = 'insert'; values = v; return q; }, upsert(v) { operation = 'upsert'; values = v; return q; }, single: async () => execute(true), maybeSingle: async () => execute(true), then: (resolve, reject) => Promise.resolve(execute(false)).then(resolve, reject) };
            return q;
        }
    };
    const mocks = {
        'next/server': { NextResponse: { json: (body, options = {}) => ({ status: options.status || 200, json: async () => JSON.parse(JSON.stringify(body)) }) } },
        '@/frontend/utils/supabase/server': { createClient: async () => client }, '@/frontend/utils/supabase/admin': { createAdminClient: () => client },
        '@/backend/services/WhatsAppService': { WhatsAppService: { send: () => { throw Error('No notifications in fixtures'); } } }, '@/backend/lib/whatsapp/welcomeMessage': { buildWelcomeMessage: () => '' }, '@/backend/services/NotificationService': {}
    };
    return { db, writes, authCalls, reads, route: name => loadTs(`app/api/users/${name}/route.ts`, mocks) };
}
export const request = body => ({ json: async () => JSON.parse(JSON.stringify(body)) });
