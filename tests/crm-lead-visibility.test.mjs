import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// access.ts pulls in next/server and the Supabase clients at import time, so
// transpile it and run it with those stubbed out (same approach as
// tests/whatsapp-assistant-access.test.mjs).
const source = await readFile(new URL('../backend/lib/crm/access.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const stubs = {
    'next/server': { NextResponse: { json: () => ({}) } },
    '@/frontend/utils/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
    '@/backend/lib/supabase/admin': { supabaseAdmin: {} },
};
const moduleScope = { exports: {} };
vm.runInNewContext(compiled, {
    exports: moduleScope.exports,
    module: moduleScope,
    require: (id) => {
        if (!(id in stubs)) throw new Error(`unexpected require: ${id}`);
        return stubs[id];
    },
});
const { scopeLeadsQuery } = moduleScope.exports;

/** Minimal stand-in for a PostgREST query builder that records what was applied. */
function fakeQuery() {
    const calls = [];
    const q = {
        calls,
        eq(col, val) { calls.push(['eq', col, val]); return q; },
        or(filter) { calls.push(['or', filter]); return q; },
    };
    return q;
}

const rep = {
    user: { id: 'rep-1' },
    isMasterAdmin: false,
    organizationId: 'org-1',
    isAdmin: false,
    roles: ['bd_rep'],
    territoryCities: ['Mumbai'],
    territoryCampaigns: ['Diwali'],
};

test('a bd_rep sees every lead in the org, not just their own', () => {
    const q = scopeLeadsQuery(fakeQuery(), rep);
    assert.deepEqual(q.calls, [['eq', 'organization_id', 'org-1']]);
    // No created_by / assigned_to / territory narrowing — that narrowing is what
    // hid teammates' leads from the "All Leads" view.
    assert.equal(q.calls.some(([op]) => op === 'or'), false);
});

test('an admin is scoped the same way — to the organization', () => {
    const q = scopeLeadsQuery(fakeQuery(), { ...rep, isAdmin: true, roles: ['bd_admin'] });
    assert.deepEqual(q.calls, [['eq', 'organization_id', 'org-1']]);
});

test('leads from another organization are still out of reach', () => {
    const q = scopeLeadsQuery(fakeQuery(), { ...rep, organizationId: 'org-2' });
    assert.deepEqual(q.calls, [['eq', 'organization_id', 'org-2']]);
});
