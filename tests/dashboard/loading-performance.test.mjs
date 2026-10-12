import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function storage() {
    const value = {};
    Object.defineProperties(value, {
        getItem: { value: key => value[key] ?? null },
        setItem: { value: (key, entry) => { value[key] = String(entry); } },
        removeItem: { value: key => { delete value[key]; } }
    });
    return value;
}
function load(file, mocks = {}, globals = {}) {
    const module = { exports: {} };
    const output = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
        module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022
    } }).outputText;
    vm.runInNewContext('(function(require,module,exports){' + output + '})', {
        console, process, setTimeout, clearTimeout, URL, ...globals
    })(name => name in mocks ? mocks[name] : require(name), module, module.exports);
    return module.exports;
}
const account = { id: 'user-a', email: 'a@fixture.invalid', user_metadata: { role: 'tenant', org_id: 'org' } };
const member = role => ({ user_id: account.id, org_id: 'org', org_role: role, org_name: 'Fixture', is_master_admin: false,
    is_approved: true, approval_status: 'approved', all_org_memberships: [{ org_id: 'org', role }],
    properties: [{ id: 'property', name: 'Property', code: 'P', role: 'tenant', organization_id: 'org' }] });
function client(calls, role = 'org_super_admin') {
    return { auth: { getSession: async () => ({ data: { session: { user: account } } }) },
        from(table) {
            calls.push(table);
            const data = table === 'users' ? { is_approved: true, approval_status: 'approved' } :
                table === 'organization_memberships' ? [{ role, organization_id: 'org' }] :
                [{ property_id: 'property', role: 'tenant' }];
            return { select() { return this; }, eq() { return this; }, neq() { return this; }, limit() { return this; },
                maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] : data, error: null }),
                single: async () => ({ data: Array.isArray(data) ? data[0] : data, error: null }),
                then(resolve) { return Promise.resolve({ data, error: null }).then(resolve); } };
        } };
}
for (const role of ['org_super_admin', 'ops_super_admin', 'tenant']) {
    test(role + ' dashboard session reuses verified membership without more database requests', async () => {
        const calls = [], values = [], membership = member(role);
        if (role === 'tenant') { membership.all_org_memberships = []; membership.org_role = null; }
        const { useAppSession } = load('frontend/hooks/useAppSession.ts', {
            '@/frontend/context/AuthContext': { useAuth: () => ({ user: account, membership, isLoading: false, isMembershipLoading: false }) },
            '@/frontend/utils/supabase/client': { createClient: () => client(calls, role) }
        });
        function Probe() { values.push(useAppSession()); return null; }
        let root;
        await act(async () => { root = TestRenderer.create(React.createElement(React.Fragment, null,
            React.createElement(Probe), React.createElement(Probe))); });
        assert.equal(values.at(-1).session.role, role);
        assert.deepEqual(Array.from(values.at(-1).session.property_ids), ['property']);
        assert.equal(calls.length, 0, 'membership was already loaded by AuthProvider');
        await act(async () => root.unmount());
    });
}
test('dashboard waits for verified membership instead of falling back to user metadata', async () => {
    const calls = [], values = [];
    const { useAppSession } = load('frontend/hooks/useAppSession.ts', {
        '@/frontend/context/AuthContext': { useAuth: () => ({ user: account, membership: null, isLoading: false, isMembershipLoading: true }) },
        '@/frontend/utils/supabase/client': { createClient: () => client(calls) }
    });
    function Probe() { values.push(useAppSession()); return null; }
    let root;
    await act(async () => { root = TestRenderer.create(React.createElement(Probe)); });
    assert.equal(values.at(-1).isLoading, true);
    assert.equal(values.at(-1).session, null);
    await act(async () => root.unmount());
});
test('organization layout uses shared membership with no additional approval or access queries', async () => {
    const calls = [], redirects = [];
    const { default: Layout } = load('app/org/[orgId]/layout.tsx', {
        '@/frontend/context/AuthContext': { useAuth: () => ({ user: account, membership: member('org_super_admin'), isLoading: false, isMembershipLoading: false, signOut: async () => {} }) },
        'next/navigation': { useRouter: () => ({ replace: path => redirects.push(path) }), useParams: () => ({ orgId: 'org' }) },
        '@/frontend/utils/supabase/client': { createClient: () => client(calls) },
        '@/frontend/components/ui/Loader': { default: () => null, __esModule: true }
    });
    let root;
    await act(async () => { root = TestRenderer.create(React.createElement(Layout, null, React.createElement('p', null, 'protected-content'))); });
    assert.ok(JSON.stringify(root.toJSON()).includes('protected-content'));
    assert.equal(calls.length, 0);
    assert.equal(redirects.length, 0);
    await act(async () => root.unmount());
});
test('initial authentication loading preserves persisted user data until logout is known', async () => {
    const local = storage();
    local.setItem('cache:user-a:tickets-property', JSON.stringify({ data: ['saved-ticket'], timestamp: Date.now() }));
    const { DataCacheProvider } = load('frontend/context/DataCacheContext.tsx', {
        './AuthContext': { useAuth: () => ({ user: null, isLoading: true }) }
    }, { localStorage: local });
    let root;
    await act(async () => { root = TestRenderer.create(React.createElement(DataCacheProvider, null)); });
    assert.ok(local.getItem('cache:user-a:tickets-property'), 'refresh must not be treated as sign-out');
    await act(async () => root.unmount());
});
test('cache writes keep callback identities stable while subsequent reads see the latest data', async () => {
    const local = storage(), reads = [];
    const { DataCacheProvider, useDataCache } = load('frontend/context/DataCacheContext.tsx', {
        './AuthContext': { useAuth: () => ({ user: account, isLoading: false }) }
    }, { localStorage: local });
    function Probe() { reads.push(useDataCache()); return null; }
    let root;
    await act(async () => { root = TestRenderer.create(React.createElement(DataCacheProvider, null, React.createElement(Probe))); });
    const initial = reads.at(-1);
    await act(async () => initial.setCachedData('tickets-property', ['latest']));
    assert.equal(reads.at(-1).getCachedData, initial.getCachedData);
    assert.deepEqual(initial.getCachedData('tickets-property'), ['latest']);
    await act(async () => initial.invalidateCache('tickets-property'));
    assert.equal(initial.getCachedData('tickets-property'), null);
    await act(async () => root.unmount());
});
test('cached data stays isolated by account and clears after actual logout', async () => {
    const local = storage();
    let auth = { user: account, isLoading: false }, cache;
    const { DataCacheProvider, useDataCache } = load('frontend/context/DataCacheContext.tsx', {
        './AuthContext': { useAuth: () => auth }
    }, { localStorage: local });
    function Probe() { cache = useDataCache(); return null; }
    let root;
    const render = () => React.createElement(DataCacheProvider, null, React.createElement(Probe));
    await act(async () => { root = TestRenderer.create(render()); });
    await act(async () => cache.setCachedData('tickets-property', ['private-a']));
    auth = { user: { ...account, id: 'user-b' }, isLoading: false };
    await act(async () => root.update(render()));
    assert.equal(cache.getCachedData('tickets-property'), null);
    auth = { user: null, isLoading: false };
    await act(async () => root.update(render()));
    assert.equal(Object.keys(local).length, 0);
    await act(async () => root.unmount());
});
test('the shared dashboard module has no eager dependency on any other role dashboard', () => {
    const source = ts.createSourceFile('UnifiedDashboard.tsx', readFileSync('frontend/components/dashboard/UnifiedDashboard.tsx', 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const eager = source.statements.filter(ts.isImportDeclaration)
        .map(node => node.moduleSpecifier.text).filter(path => /\/(OrgAdmin|PropertyAdmin|Tenant|MasterAdmin|Procurement|Staff|Mst|Security|SuperTenant|SoftServiceManager)Dashboard$/.test(path));
    assert.deepEqual(eager, [], 'a role should not download other roles before its own screen loads');
});

test('a previous account membership cannot initialize the next account dashboard', async () => {
    const values = [];
    const { useAppSession } = load('frontend/hooks/useAppSession.ts', {
        '@/frontend/context/AuthContext': { useAuth: () => ({ user: { ...account, id: 'user-b' },
            membership: member('org_super_admin'), isLoading: false, isMembershipLoading: false }) },
        '@/frontend/utils/supabase/client': { createClient: () => { throw new Error('Unexpected duplicate query'); } }
    });
    function Probe() { values.push(useAppSession()); return null; }
    let root;
    await act(async () => { root = TestRenderer.create(React.createElement(Probe)); });
    assert.equal(values.at(-1).isLoading, true);
    assert.equal(values.at(-1).session, null);
    await act(async () => root.unmount());
});

test('organization children remain blocked on access failure, wrong organization and pending approval', async () => {
    for (const overrides of [
        { error: true },
        { all_org_memberships: [], properties: [] },
        { all_org_memberships: [{ org_id: 'other', role: 'org_super_admin' }], properties: [] },
        { is_approved: false, approval_status: 'pending' },
        { user_id: 'previous-account' }
    ]) {
        const membership = { ...member('org_super_admin'), ...overrides };
        const { default: Layout } = load('app/org/[orgId]/layout.tsx', {
            '@/frontend/context/AuthContext': { useAuth: () => ({ user: account, membership,
                isLoading: false, isMembershipLoading: false, refreshMembership: async () => {}, signOut: async () => {} }) },
            'next/navigation': { useRouter: () => ({ replace: () => {} }), useParams: () => ({ orgId: 'org' }) },
            '@/frontend/components/ui/Loader': { default: () => null, __esModule: true }
        });
        let root;
        await act(async () => { root = TestRenderer.create(React.createElement(Layout, null, React.createElement('p', null, 'protected-content'))); });
        assert.equal(JSON.stringify(root.toJSON()).includes('protected-content'), false);
        await act(async () => root.unmount());
    }
});

test('a delayed membership response cannot overwrite the account currently logged in', async () => {
    const waits = [], seen = [];
    let emit;
    const sessionFor = id => ({ user: { ...account, id } });
    const initial = sessionFor('user-a');
    const supabase = {
        auth: {
            getSession: async () => ({ data: { session: initial } }),
            onAuthStateChange: callback => { emit = callback; return { data: { subscription: { unsubscribe() {} } } }; },
            updateUser: async () => ({ error: null })
        },
        from(table) {
            let id;
            return {
                select() { return this; }, eq(key, value) { if (key === 'user_id' || key === 'id') id = value; return this; },
                maybeSingle() { return this; },
                then(resolve) {
                    return new Promise(done => {
                        waits.push({ id, table, done: () => {
                            const data = table === 'users' ? { is_approved: true, approval_status: 'approved', onboarding_completed: true } :
                                table === 'organization_memberships' ? [{ role: 'org_super_admin', organization: { id: 'org-' + id, name: id } }] :
                                [{ role: 'tenant', property: { id: 'property-' + id, name: id, code: id, organization_id: 'org-' + id } }];
                            done({ data, error: null });
                        } });
                    }).then(resolve);
                }
            };
        }
    };
    const { AuthProvider, useAuth } = load('frontend/context/AuthContext.tsx', {
        '@/frontend/utils/supabase/client': { createClient: () => supabase }
    });
    function Probe() { seen.push(useAuth()); return null; }
    let root;
    await act(async () => { root = TestRenderer.create(React.createElement(AuthProvider, null, React.createElement(Probe))); });
    assert.equal(waits.filter(request => request.id === 'user-a').length, 3);
    await act(async () => { emit('SIGNED_IN', sessionFor('user-b')); });
    assert.equal(waits.filter(request => request.id === 'user-b').length, 3, 'the next account must not wait on a different account request');
    await act(async () => { waits.filter(request => request.id === 'user-b').forEach(request => request.done()); });
    assert.equal(seen.at(-1).membership.user_id, 'user-b');
    await act(async () => { waits.filter(request => request.id === 'user-a').forEach(request => request.done()); });
    assert.equal(seen.at(-1).membership.user_id, 'user-b');
    assert.equal(seen.at(-1).membership.org_id, 'org-user-b');
    await act(async () => { emit('SIGNED_IN', sessionFor('user-c')); });
    assert.equal(seen.at(-1).isMembershipLoading, true);
    await act(async () => { emit('SIGNED_IN', sessionFor('user-b')); });
    assert.equal(seen.at(-1).membership.user_id, 'user-b');
    assert.equal(seen.at(-1).isMembershipLoading, false, 'cached account must clear loading from previous in-flight account');
    await act(async () => { waits.filter(request => request.id === 'user-c').forEach(request => request.done()); });
    assert.equal(seen.at(-1).membership.user_id, 'user-b');
    await act(async () => root.unmount());
});

test('target role bundles load feature panels on demand', () => {
    const heavy = new Set(['ProcurementModule', 'PPMModule', 'AssetsModule', 'SOPDashboard',
        'TaskManagerSuperuserDashboard', 'TenantRoomBooking', 'PPMCalendar', 'OrgProgressTracker', 'AgentConsole']);
    for (const name of ['OrgAdminDashboard', 'PropertyAdminDashboard', 'TenantDashboard']) {
        const path = 'frontend/components/dashboard/' + name + '.tsx';
        const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const eager = source.statements.filter(ts.isImportDeclaration).filter(node =>
            heavy.has(node.importClause?.name?.text)).map(node => node.moduleSpecifier.text);
        assert.deepEqual(eager, [], name + ' should defer inactive feature panels');
    }
});

test('shared approval keeps conflicting profile flags denied with the master-admin exception', async () => {
    for (const profile of [
        { is_master_admin: false, is_approved: false, approval_status: 'approved' },
        { is_master_admin: false, is_approved: true, approval_status: 'pending' },
        { is_master_admin: true, is_approved: false, approval_status: 'pending' }
    ]) {
        const seen = [];
        const supabase = {
            auth: { getSession: async () => ({ data: { session: { user: account } } }),
                onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
                updateUser: async () => ({ error: null }) },
            from(table) { return {
                select() { return this; }, eq() { return this; }, maybeSingle() { return this; },
                then(resolve) {
                    const data = table === 'users' ? { ...profile, onboarding_completed: true } :
                        table === 'organization_memberships' ? [{ role: 'org_super_admin', organization: { id: 'org', name: 'Fixture' } }] : [];
                    return Promise.resolve({ data, error: null }).then(resolve);
                }
            }; }
        };
        const { AuthProvider, useAuth } = load('frontend/context/AuthContext.tsx', {
            '@/frontend/utils/supabase/client': { createClient: () => supabase }
        });
        function Probe() { seen.push(useAuth()); return null; }
        let root;
        await act(async () => { root = TestRenderer.create(React.createElement(AuthProvider, null, React.createElement(Probe))); });
        assert.equal(seen.at(-1).membership.is_approved, profile.is_master_admin,
            'pending or explicit revocation must not be overridden by a conflicting positive flag');
        await act(async () => root.unmount());
    }
});
