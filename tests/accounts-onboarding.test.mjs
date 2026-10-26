import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import {loadTs} from './petty-cash/load-ts.mjs';
const managementRoles = loadTs('backend/lib/users/managementRoles.ts');

const require = createRequire(import.meta.url);
const next = require('next/server');
const sources = {};
for (const name of ['users/create', 'users/approve', 'onboarding/complete']) {
    const source = await readFile(new URL(`../app/api/${name}/route.ts`, import.meta.url), 'utf8');
    sources[name] = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
const siloSource = await readFile(new URL('../frontend/lib/auth/silos.ts', import.meta.url), 'utf8');
const siloExports = {};
vm.runInNewContext(ts.transpileModule(siloSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: siloExports });

function fixture({ actor = 'admin', adminRole = 'org_super_admin', orgRole, propRole, orgError = null, properties = [{ id: 'p1', organization_id: 'o1' }] } = {}) {
    const tables = {
        users: [{ id: 'admin', is_master_admin: false, full_name: 'Admin' }, { id: 'member', email: 'member@example.com', is_approved: false, approval_status: 'pending' }],
        organizations: [{ id: 'o1', name: 'Autopilot', code: 'autopilot' }],
        organization_memberships: adminRole === 'property_admin' ? [] : [{ user_id: 'admin', organization_id: 'o1', role: adminRole, is_active: true }],
        property_memberships: adminRole === 'property_admin' ? [{ user_id: 'admin', organization_id: 'o1', property_id: 'p1', role: adminRole, is_active: true }] : [],
        properties,
    };
    if (orgRole) tables.organization_memberships.push({ user_id: 'member', organization_id: 'o1', role: orgRole, is_active: false });
    if (propRole) tables.property_memberships.push({ user_id: 'member', organization_id: 'o1', property_id: 'p1', role: propRole, is_active: false });
    const created = [], deletedUsers = [], metadata = [];
    const db = {
        auth: {
            getUser: async () => ({ data: { user: { id: actor, user_metadata: { full_name: 'Member' } } }, error: null }),
            updateUser: async () => ({ error: null }),
            admin: {
                createUser: async body => { created.push(body); return { data: { user: { id: 'member', email: body.email } }, error: null }; },
                deleteUser: async id => { deletedUsers.push(id); return { error: null }; },
                updateUserById: async (id, body) => { metadata.push(body.user_metadata); return { error: null }; },
            },
        },
        from(table) {
            tables[table] ||= [];
            let filters = [], operation = 'select', payload;
            const matches = row => filters.every(([key, value]) => value?.values ? value.values.includes(row[key]) : row[key] === value);
            const execute = single => {
                if (table === 'organization_memberships' && ['insert', 'upsert'].includes(operation) && orgError) return { data: null, error: { message: orgError } };
                const rows = tables[table].filter(matches);
                if (operation === 'update') rows.forEach(row => Object.assign(row, payload));
                if (operation === 'delete') tables[table] = tables[table].filter(row => !matches(row));
                if (['insert', 'upsert'].includes(operation)) {
                    for (const value of Array.isArray(payload) ? payload : [payload]) {
                        const existing = operation === 'upsert' && tables[table].find(row => row.user_id === value.user_id && row.organization_id === value.organization_id && row.property_id === value.property_id);
                        if (existing) Object.assign(existing, value);
                        else tables[table].push({ is_active: true, ...value });
                    }
                }
                return { data: single ? rows[0] || null : rows, error: null };
            };
            return {
                in(key, values) { filters.push([key, { values }]); return this; },
                select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
                order() { return this; }, limit() { return this; }, or() { return this; },
                insert(value) { operation = 'insert'; payload = value; return this; },
                upsert(value) { operation = 'upsert'; payload = value; return this; },
                update(value) { operation = 'update'; payload = value; return this; },
                delete() { operation = 'delete'; return this; },
                maybeSingle: async () => execute(true), single: async () => execute(true),
                then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
            };
        },
    };
    return {
        tables, created, deletedUsers, metadata,
        route(name, env = { NEXT_PUBLIC_AUTOPILOT_ORG_ID: 'o1' }) {
            const exports = {};
            const imports = {
                'next/server': next,
                '@/backend/lib/users/managementRoles': managementRoles,
                '@/frontend/utils/supabase/server': { createClient: async () => db },
                '@/frontend/utils/supabase/admin': { createAdminClient: () => db },
                '@/backend/services/NotificationService': {},
                '@/backend/services/WhatsAppService': { WhatsAppService: { send() {} } },
                '@/backend/lib/whatsapp/welcomeMessage': { buildWelcomeMessage: () => '' },
            };
            vm.runInNewContext(sources[name], { exports, require: name => {
                if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
                return imports[name];
            }, process: { env }, console: { error() {}, warn() {} } });
            return exports;
        },
    };
}

const request = body => new next.NextRequest('https://app.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const createBody = { email: 'member@example.com', full_name: 'Member', password: 'Test-password-123', organization_id: 'o1', role: 'accounts' };
const memberOrg = f => f.tables.organization_memberships.find(row => row.user_id === 'member');
const memberProps = f => f.tables.property_memberships.filter(row => row.user_id === 'member');

test('admin creates an approved org Accounts member without a property, even if one is supplied', async () => {
    const f = fixture();
    const response = await f.route('users/create').POST(request({ ...createBody, property_id: 'p1' }));
    assert.equal(response.status, 200);
    assert.equal(memberOrg(f)?.role, 'accounts');
    assert.equal(memberOrg(f)?.is_active, true);
    assert.equal(memberProps(f).length, 0);
    assert.equal(f.tables.users.find(row => row.id === 'member').is_approved, true);
});

test('property admins cannot create org Accounts members', async () => {
    const f = fixture({ adminRole: 'property_admin' });
    assert.equal((await f.route('users/create').POST(request({ ...createBody, property_id: 'p1' }))).status, 403);
    assert.equal(f.created.length, 0);
});

test('an unavailable Accounts enum rolls creation back instead of silently granting Staff', async () => {
    const f = fixture({ orgError: 'invalid input value for enum app_role: accounts' });
    assert.equal((await f.route('users/create').POST(request(createBody))).status, 500);
    assert.deepEqual(f.deletedUsers, ['member']);
    assert.equal(memberOrg(f), undefined);
});

test('Accounts self-onboarding needs no property and creates a pending org membership', async () => {
    const f = fixture({ actor: 'member' });
    assert.equal((await f.route('onboarding/complete').POST(request({ selectedRole: 'accounts' }))).status, 200);
    assert.equal(memberOrg(f)?.role, 'accounts');
    assert.equal(memberOrg(f)?.organization_id, 'o1');
    assert.equal(memberOrg(f)?.is_active, false);
    assert.equal(memberProps(f).length, 0);
});

test('Accounts signup ignores property scope and fails when org membership cannot be saved', async () => {
    const f = fixture({ actor: 'member', orgError: 'membership write failed', properties: [{ id: 'p1', organization_id: 'another-org' }] });
    assert.equal((await f.route('onboarding/complete').POST(request({ selectedRole: 'accounts', selectedPropertyId: 'p1' }))).status, 500);
    assert.equal(memberProps(f).length, 0);
});

test('approving a pending org Accounts member preserves their role and Accounts login destination', async () => {
    const f = fixture({ orgRole: 'accounts' });
    assert.equal((await f.route('users/approve').POST(request({ userId: 'member' }))).status, 200);
    assert.equal(memberOrg(f)?.role, 'accounts');
    assert.equal(memberOrg(f)?.is_active, true);
    assert.equal(memberProps(f).length, 0);
    assert.equal(siloExports.resolveSilo([{ role: memberOrg(f).role, orgId: 'o1' }]).path, '/o1/accounts');
});

test('approval moves legacy property Accounts applicants to the org and replaces the accidental Staff role', async () => {
    const f = fixture({ orgRole: 'staff', propRole: 'accounts' });
    assert.equal((await f.route('users/approve').POST(request({ userId: 'member' }))).status, 200);
    assert.equal(memberOrg(f)?.role, 'accounts');
    assert.equal(memberProps(f).length, 0);
    assert.equal(f.metadata.at(-1).role, 'accounts');
    assert.equal(f.metadata.at(-1).property_id, null);
});

test('a failed Accounts approval membership write leaves the applicant pending', async () => {
    const f = fixture({ propRole: 'accounts', orgError: 'membership write failed' });
    assert.equal((await f.route('users/approve').POST(request({ userId: 'member' }))).status, 500);
    assert.equal(f.tables.users.find(row => row.id === 'member').is_approved, false);
    assert.equal(memberProps(f)[0].is_active, false);
});

test('property admins cannot approve organization-level Accounts applications', async () => {
    const f = fixture({ adminRole: 'property_admin', propRole: 'accounts' });
    assert.equal((await f.route('users/approve').POST(request({ userId: 'member' }))).status, 403);
    assert.equal(f.tables.users.find(row => row.id === 'member').is_approved, false);
});

test('a property admin cannot bypass Accounts approval permissions by overriding the role', async () => {
    const f = fixture({ adminRole: 'property_admin', orgRole: 'accounts', propRole: 'accounts' });
    assert.equal((await f.route('users/approve').POST(request({ userId: 'member', role: 'staff' }))).status, 403);
    assert.equal(memberOrg(f).role, 'accounts');
    assert.equal(memberOrg(f).is_active, false);
});

test('org Accounts rejection keeps the applicant and their membership inactive', async () => {
    const f = fixture({ orgRole: 'accounts' });
    assert.equal((await f.route('users/approve').POST(request({ userId: 'member', action: 'reject' }))).status, 200);
    assert.equal(memberOrg(f)?.is_active, false);
    assert.equal(f.tables.users.find(row => row.id === 'member').approval_status, 'rejected');
});

test('an unrelated property membership does not change the Accounts organization on approval', async () => {
    const f = fixture({ orgRole: 'accounts' });
    f.tables.property_memberships.push({ user_id: 'member', organization_id: 'o2', property_id: 'other', role: 'tenant', is_active: false });
    assert.equal((await f.route('users/approve').POST(request({ userId: 'member' }))).status, 200);
    assert.equal(memberOrg(f).organization_id, 'o1');
    assert.equal(memberOrg(f).role, 'accounts');
    assert.equal(memberProps(f)[0].is_active, false);
});

test('existing property-admin creation of a property staff member still works', async () => {
    const f = fixture({ adminRole: 'property_admin' });
    assert.equal((await f.route('users/create').POST(request({ ...createBody, role: 'staff', property_id: 'p1' }))).status, 200);
    assert.equal(memberProps(f)[0].role, 'staff');
    assert.equal(memberProps(f)[0].property_id, 'p1');
});
