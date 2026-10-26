import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const rendererPath = process.env.REACT_TEST_RENDERER_PATH || 'react-test-renderer';
const rendererRequire = createRequire(require.resolve(rendererPath));
const React = rendererRequire('react');
const { create, act } = require(rendererPath);

const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
function route({ caller = 'buyer', role = 'procurement', active = true, membershipOrg = org, master = false, broken = false, extra = [], propertyRole = null, enumProbe } = {}) {
    const path = new URL('../app/api/procurement/requisitions/approvers/route.ts', import.meta.url);
    if (!existsSync(path)) return async () => Response.json({ error: 'Not found' }, { status: 404 });
    const records = {
        users: [{ id: 'buyer', is_master_admin: master, deleted_at: null }],
        organization_memberships: [
            { user_id: 'buyer', organization_id: membershipOrg, role, is_active: active },
            ...Array.from({ length: 6 }, (_, i) => ({ user_id: `admin${i}`, organization_id: org, role: i % 2 ? 'ops_super_admin' : 'org_super_admin', is_active: true, user: { id: `admin${i}`, full_name: `Admin ${i}`, email: `admin${i}@test.com`, deleted_at: null } })),
            { user_id: 'foreign', organization_id: otherOrg, role: 'org_super_admin', is_active: true, user: { id: 'foreign' } },
            { user_id: 'inactive', organization_id: org, role: 'ops_super_admin', is_active: false, user: { id: 'inactive' } },
            { user_id: 'deleted', organization_id: org, role: 'org_super_admin', is_active: true, user: { id: 'deleted', deleted_at: '2026-10-01' } },
            { user_id: 'property-admin', organization_id: org, role: 'property_admin', is_active: true, user: { id: 'property-admin' } },
            ...extra,
        ], property_memberships: propertyRole ? [{ user_id: 'buyer', role: propertyRole, organization_id: org, is_active: true }] : [],
    };
    const db = { from(table) {
        let rows = records[table] || [];
        let validation = Promise.resolve(null);
        const query = {
            select() { return this; }, eq(key, value) { rows = rows.filter(r => r[key] === value); return this; },
            in(key, values) {
                rows = rows.filter(r => values.includes(r[key]));
                if (enumProbe && key === 'role') validation = enumProbe(values).then(() => null, error => error);
                return this;
            },
            order() { return this; }, range(start, end) { rows = rows.slice(start, end + 1); return this; },
            maybeSingle: async () => ({ data: rows[0] || null, error: broken ? new Error('DB unavailable') : null }),
            async then(resolve) { resolve({ data: rows, error: broken ? new Error('DB unavailable') : await validation }); },
        };
        return query;
    } };
    const exports = {};
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, { exports, console, require: name => {
        if (name === 'next/server') return { NextResponse: { json: Response.json } };
        if (name.endsWith('/server')) return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: caller ? { id: caller } : null }, error: null }) } }) };
        if (name.endsWith('/admin')) return { createAdminClient: () => db };
        if (name === 'zod') return { z: { string: () => ({ uuid: () => ({ safeParse: value => ({ success: /^[\da-f-]{36}$/i.test(value) }) }) }) } };
        throw new Error(`Unexpected import ${name}`);
    } });
    return exports.GET;
}
const request = (organizationId = org) => ({ url: `https://app.test/api/procurement/requisitions/approvers?organization_id=${organizationId}`, nextUrl: new URL(`https://app.test/?organization_id=${organizationId}`) });

test('approver directory returns all six organization and ops super admins, excluding other roles, inactive and deleted users', async () => {
    const response = await route()(request());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.approvers.map(u => u.id).sort(), Array.from({ length: 6 }, (_, i) => `admin${i}`));
    assert.ok(body.approvers.some(u => u.role === 'ops_super_admin'));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('directory requires authenticated active procurement or admin access in the requested organization', async () => {
    for (const config of [{ caller: null }, { role: 'tenant' }, { active: false }, { membershipOrg: otherOrg }]) {
        const response = await route(config)(request());
        assert.equal(response.status, config.caller === null ? 401 : 403);
        assert.equal((await response.json()).approvers, undefined);
    }
    assert.equal((await route({ master: true, membershipOrg: otherOrg })(request())).status, 200);
    assert.equal((await route({ broken: true })(request())).status, 503);
    assert.equal((await route()(request('invalid'))).status, 400);
    assert.equal((await route({ role: 'tenant', propertyRole: 'property_admin' })(request())).status, 200);
});

test('directory pages past database row limits and deduplicates eligible memberships', async () => {
    const extra = Array.from({ length: 1100 }, (_, i) => ({ user_id: `extra${i}`, organization_id: org,
        role: 'ops_super_admin', is_active: true, user: { id: `extra${i}`, full_name: `Ops ${i}`, email: `ops${i}@test.com` } }));
    extra.push(extra[0]);
    const response = await route({ extra })(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).approvers.length, 1106);
});

test('membership access works with the real PostgreSQL app_role enum, without requiring legacy aliases', async () => {
    const database = new PGlite();
    try {
        await database.exec("CREATE TYPE app_role AS ENUM ('master_admin','org_super_admin','ops_super_admin','procurement','property_admin','tenant');");
        const enumProbe = values => database.query('SELECT role::app_role FROM unnest($1::text[]) AS role', [values]);
        const response = await route({ enumProbe })(request());
        assert.equal(response.status, 200);
        assert.equal((await response.json()).approvers.length, 6);
    } finally { await database.close(); }
});

test('approver picker searches name and email and selects a matched ops admin', async () => {
    const path = new URL('../frontend/components/procurement/RequisitionApproverSelect.tsx', import.meta.url);
    assert.ok(existsSync(path), 'The approval dialogs need a searchable picker');
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: name => {
        if (name === 'react') return React;
        if (name === 'react/jsx-runtime') return rendererRequire('react/jsx-runtime');
        throw new Error(`Unexpected import ${name}`);
    } });
    const old = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let tree, selected;
    try {
        await act(async () => { tree = create(React.createElement(exports.default, { approvers: [
            { id: 'a', full_name: 'Asha Shah', email: 'asha@test.com', role: 'org_super_admin' },
            { id: 'b', full_name: 'Rahul Patil', email: 'operations@test.com', role: 'ops_super_admin' },
        ], value: '', onChange: id => { selected = id; } })); });
        for (const search of [' rahUL ', 'OPERATIONS@']) {
            await act(async () => tree.root.findByType('input').props.onChange({ target: { value: search } }));
            assert.deepEqual(tree.root.findAllByType('option').filter(o => o.props.value).map(o => o.props.value), ['b']);
        }
        await act(async () => tree.root.findByType('select').props.onChange({ target: { value: 'b' } }));
        assert.equal(selected, 'b');
        await act(async () => tree.root.findByType('input').props.onChange({ target: { value: 'Nobody' } }));
        assert.match(JSON.stringify(tree.toJSON()), /No matching/);
    } finally {
        if (tree) await act(async () => tree.unmount());
        globalThis.IS_REACT_ACT_ENVIRONMENT = old;
    }
});
