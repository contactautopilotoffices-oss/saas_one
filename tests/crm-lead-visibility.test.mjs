import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { cityFilterOr, cityAliases } from '../backend/lib/crm/cityGroups.ts';

// access.ts pulls in next/server and the Supabase clients at import time, so
// transpile it and run it with those stubbed out (same approach as
// tests/whatsapp-assistant-access.test.mjs). cityGroups is the real module.
const source = await readFile(new URL('../backend/lib/crm/access.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const stubs = {
    'next/server': { NextResponse: { json: () => ({}) } },
    '@/frontend/utils/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
    '@/backend/lib/supabase/admin': { supabaseAdmin: {} },
    '@/backend/lib/crm/cityGroups': { cityFilterOr, cityAliases },
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
const { scopeLeadsQuery, territoryGrants } = moduleScope.exports;

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

function orFilter(q) {
    const row = q.calls.find(([op]) => op === 'or');
    return row ? row[1] : '';
}

const mumbaiRep = {
    user: { id: 'rep-mumbai' },
    isMasterAdmin: false,
    organizationId: 'org-1',
    isAdmin: false,
    roles: ['bd_rep'],
    territoryCities: ['Mumbai'],
    territoryCampaigns: ['Andheri'],
};

// --- the bug: a row carrying BOTH a city and a campaign ------------------------

test('a territory row with a city AND a campaign grants both, not just the campaign', () => {
    const grants = territoryGrants([{ city: 'Mumbai', campaign: 'Andheri' }]);
    assert.deepEqual(Array.from(grants.cities), ['Mumbai']);
    assert.deepEqual(Array.from(grants.campaigns), ['Andheri']);
});

test('territoryGrants keeps city-only and campaign-only rows, and dedupes', () => {
    const grants = territoryGrants([
        { city: 'Mumbai', campaign: 'Lower Parel' },
        { city: 'Mumbai', campaign: 'Andheri' },
        { city: '  ', campaign: 'F1 Skymark' },
        { city: 'Bangalore', campaign: null },
    ]);
    assert.deepEqual(Array.from(grants.cities), ['Mumbai', 'Bangalore']);
    assert.deepEqual(Array.from(grants.campaigns), ['Lower Parel', 'Andheri', 'F1 Skymark']);
});

// --- what "All Leads" shows a rep ---------------------------------------------

test('a rep is scoped to their org and their own market', () => {
    const q = scopeLeadsQuery(fakeQuery(), mumbaiRep);
    assert.deepEqual(q.calls[0], ['eq', 'organization_id', 'org-1']);
    const f = orFilter(q);
    // Own leads stay visible wherever they are.
    assert.ok(f.includes('created_by.eq.rep-mumbai'));
    assert.ok(f.includes('assigned_to.eq.rep-mumbai'));
    // Plus the whole granted market, whoever holds those leads.
    assert.ok(f.includes('city.ilike.%mumbai%'));
    assert.ok(f.includes('location.ilike.%andheri%'));
    assert.ok(f.includes('campaign.in.("Andheri")'));
});

test("a Mumbai rep's market filter does not reach Bangalore", () => {
    const f = orFilter(scopeLeadsQuery(fakeQuery(), mumbaiRep));
    for (const area of ['bangalore', 'bengaluru', 'whitefield', 'koramangala', 'indiranagar']) {
        assert.ok(!f.includes(area), `Mumbai rep should not match ${area}`);
    }
});

test("a Bangalore rep's market filter does not reach Mumbai", () => {
    const blrRep = { ...mumbaiRep, user: { id: 'rep-blr' }, territoryCities: ['Bangalore'], territoryCampaigns: ['Bangalore'] };
    const f = orFilter(scopeLeadsQuery(fakeQuery(), blrRep));
    assert.ok(f.includes('city.ilike.%bengaluru%'));
    for (const area of ['mumbai', 'andheri', 'lower parel', 'bandra']) {
        assert.ok(!f.includes(area), `Bangalore rep should not match ${area}`);
    }
});

test('ad leads with no city are still matched through the campaign name', () => {
    // ~a third of the ad leads carry no city and no location at all —
    // "Managed Office - Lower Parel (New)" is the only geography they have.
    const f = orFilter(scopeLeadsQuery(fakeQuery(), mumbaiRep));
    assert.ok(f.includes('campaign.ilike.%lower parel%'));
    assert.ok(f.includes('campaign.ilike.%andheri%'));
});

test('a rep with no territory still sees the leads that are theirs', () => {
    const q = scopeLeadsQuery(fakeQuery(), { ...mumbaiRep, territoryCities: [], territoryCampaigns: [] });
    assert.equal(orFilter(q), 'created_by.eq.rep-mumbai,assigned_to.eq.rep-mumbai');
});

// --- admins and tenancy --------------------------------------------------------

test('an admin sees the whole org with no extra narrowing', () => {
    const q = scopeLeadsQuery(fakeQuery(), { ...mumbaiRep, isAdmin: true, roles: ['bd_admin'] });
    assert.deepEqual(q.calls, [['eq', 'organization_id', 'org-1']]);
});

test('leads from another organization are still out of reach', () => {
    const q = scopeLeadsQuery(fakeQuery(), { ...mumbaiRep, organizationId: 'org-2' });
    assert.deepEqual(q.calls[0], ['eq', 'organization_id', 'org-2']);
});

// --- multi-metro grants --------------------------------------------------------

test('a grant naming two metros resolves both', () => {
    const aliases = cityAliases('Delhi & Noida');
    assert.ok(aliases.includes('delhi'));
    assert.ok(aliases.includes('noida'));
    assert.ok(aliases.includes('greater noida'), 'Noida should expand to its areas');
});

test('cityFilterOr only matches the campaign when asked to', () => {
    assert.ok(!cityFilterOr(['Mumbai']).includes('campaign.'));
    assert.ok(cityFilterOr(['Mumbai'], { includeCampaign: true }).includes('campaign.ilike.%mumbai%'));
});
