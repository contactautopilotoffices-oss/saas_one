import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { createRequire } from 'node:module';

const profile = (id, name) => ({ id, full_name: name, email: `${id}@test.com`, is_approved: true, approval_status: 'approved' });
const users = [profile('admin', 'Admin'), profile('tenant', 'Tenant'), profile('pending', 'Pending'),
    profile('updater', 'Audit Editor'), profile('foreign', 'Foreign')];
const orgMembers = [
    { user_id: 'admin', updated_by: 'updater', organization_id: 'org-a', role: 'org_super_admin', is_active: true },
    { user_id: 'foreign', updated_by: 'updater', organization_id: 'org-b', role: 'org_super_admin', is_active: true },
];
const properties = [{ id: 'property-a', name: 'Site A', organization_id: 'org-a' }, { id: 'property-b', name: 'Site B', organization_id: 'org-b' }];
const propMembers = [
    { user_id: 'tenant', updated_by: 'updater', property_id: 'property-a', role: 'tenant', is_active: true },
    { user_id: 'pending', updated_by: 'updater', property_id: 'property-a', role: 'staff', is_active: false, approval_status: 'pending' },
    { user_id: 'foreign', updated_by: 'updater', property_id: 'property-b', role: 'property_admin', is_active: true },
];

function directory(caller = 'admin', legacyComponent = false) {
    const rows = { users: [...users, profile('property-admin', 'Property Admin')], organization_memberships: orgMembers,
        property_memberships: [...propMembers, ...(caller === 'property-admin' ? [{ user_id: 'property-admin',
            updated_by: 'updater', property_id: 'property-a', role: 'property_admin', is_active: true }] : [])], properties, employee_profiles: [] };
    const admin = { from(table) {
        let selection = '', filters = [];
        const query = {
            select(value) { selection = value; return this; },
            eq(key, value) { filters.push(row => key === 'property.organization_id'
                ? properties.find(property => property.id === row.property_id)?.organization_id === value : row[key] === value); return this; },
            in(key, values) { filters.push(row => values.includes(row[key])); return this; },
            result(single = false) {
                const userJoin = selection.match(/\b(user:)?users(?:!([\w]+))?\s*\(/);
                // PostgREST cannot infer whether users means the member or their audit editor.
                if (userJoin && !userJoin[2]) return { data: null, error: {
                    code: 'PGRST201', message: `Could not embed because more than one relationship was found for '${table}' and 'users'`,
                } };
                const data = (rows[table] || []).filter(row => filters.every(filter => filter(row))).map(row => ({
                    ...row,
                    ...(userJoin ? { [userJoin[1] ? 'user' : 'users']: rows.users.find(user => user.id === row[userJoin[2]]) } : {}),
                    ...(selection.includes('property:properties') ? { property: properties.find(property => property.id === row.property_id) } : {}),
                }));
                return { data: single ? data[0] || null : data, error: null };
            },
            single() { return Promise.resolve(this.result(true)); },
            maybeSingle() { return Promise.resolve(this.result(true)); },
            then(resolve) { return Promise.resolve(this.result()).then(resolve); },
        };
        return query;
    } };
    const exports = {};
    const code = ts.transpileModule(readFileSync(new URL(legacyComponent
        ? '../frontend/components/dashboard/UserManagement.tsx' : '../app/api/users/list/route.ts', import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, { exports, URL, console: { error() {} }, require: name => {
        if (name === 'next/server') return { NextResponse: { json: Response.json } };
        if (name.endsWith('/server')) return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: caller ? { id: caller } : null }, error: null }) } }) };
        if (name.endsWith('/admin')) return { createAdminClient: () => admin };
        if (name.endsWith('/client')) return { createClient: () => admin };
        if (name === 'react') return React;
        if (name === 'react/jsx-runtime') return createRequire(import.meta.url)(name);
        if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
        if (name === 'framer-motion') return { AnimatePresence: props => props.children,
            motion: new Proxy({}, { get: (_, tag) => props => React.createElement(tag, null, props.children) }) };
        if (name.endsWith('/managementRoles')) return { isOrganizationUserManager: role => ['org_super_admin', 'ops_super_admin', 'admin', 'owner'].includes(role) };
        throw new Error(`Unexpected import ${name}`);
    } });
    if (legacyComponent) return exports.default;
    const get = async params => exports.GET({ url: `https://app.test/api/users/list?${params}` });
    get.admin = admin;
    return get;
}

test('property User Management loads member profiles when both member and audit-editor user relationships exist', async () => {
    const response = await directory()('propertyId=property-a');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.users.map(user => user.id).sort(), ['pending', 'tenant']);
    assert.equal(body.organizationId, 'org-a');
    assert.equal(body.users.find(user => user.id === 'pending').approval_status, 'pending');
    assert.equal(body.users.find(user => user.id === 'tenant').is_approved, true);
});

test('organization User Management combines organization and property members, never their audit editors or other organizations', async () => {
    const response = await directory()('orgId=org-a');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.users.map(user => user.id).sort(), ['admin', 'pending', 'tenant']);
    assert.equal(body.users.find(user => user.id === 'admin').orgRole, 'org_super_admin');
    assert.equal(body.users.find(user => user.id === 'tenant').propertyId, 'property-a');
});

test('directory still rejects unauthenticated, unrelated and mismatched property/organization requests', async () => {
    assert.equal((await directory(null)('orgId=org-a')).status, 401);
    assert.equal((await directory('foreign')('orgId=org-a')).status, 403);
    assert.equal((await directory()('orgId=org-a&propertyId=property-b')).status, 400);
});

test('a property admin can load their assigned property without organization-wide directory access', async () => {
    const response = await directory('property-admin')('propertyId=property-a');
    assert.equal(response.status, 200);
    assert.ok((await response.json()).users.some(user => user.id === 'property-admin'));
    assert.equal((await directory('property-admin')('orgId=org-a')).status, 403);
    assert.equal((await directory('property-admin')('propertyId=property-b')).status, 403);
});

test('older organization User Management view renders the member rather than their audit editor', async () => {
    const require = createRequire(import.meta.url);
    const { create, act } = require(process.env.REACT_TEST_RENDERER_PATH || 'react-test-renderer');
    const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let tree;
    try {
        await act(async () => { tree = create(React.createElement(directory('admin', true), { orgId: 'org-a' })); });
        const content = JSON.stringify(tree.toJSON());
        assert.match(content, /admin@test.com/);
        assert.doesNotMatch(content, /updater@test.com|foreign@test.com/);
    } finally {
        if (tree) await act(async () => tree.unmount());
        globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
    }
});

test('organization dashboard refresh after member edits loads both membership sources without relationship errors', async () => {
    const source = ts.createSourceFile('OrgAdminDashboard.tsx', readFileSync(new URL('../frontend/components/dashboard/OrgAdminDashboard.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    let initializer;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'fetchOrgUsers') initializer = node.initializer;
        ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(initializer);
    const exports = {}, errors = [];
    let result;
    vm.runInNewContext(ts.transpileModule(`export const refresh = ${initializer.getText(source)}`, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, supabase: directory().admin, org: { id: 'org-a' },
        setOrgUsers: users => { result = users; }, console: { error: (...args) => errors.push(args) } });
    await exports.refresh();
    assert.deepEqual(errors, []);
    assert.deepEqual(Array.from(result, user => user.user_id).sort(), ['admin', 'tenant']);
});
