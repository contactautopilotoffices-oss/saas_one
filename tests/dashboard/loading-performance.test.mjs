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
const member = role => ({ org_id: 'org', org_role: role, org_name: 'Fixture', is_master_admin: false,
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
