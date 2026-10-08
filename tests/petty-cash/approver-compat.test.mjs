import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { loadTs } from './load-ts.mjs';
const property = '00000000-0000-0000-0000-000000000003';
const org = '00000000-0000-0000-0000-000000000001';
const input = () => new NextRequest(`http://fixture/api/properties/${property}/approvers?organization_id=${org}&q=Fixture`);
const params = { params: Promise.resolve({ propertyId: property }) };
const accessMock = access => ({ '@/backend/lib/pettyCash/access': {
    resolvePettyCashAccess: async () => access, isPettyCashAccessError: () => false, readOrgId: () => org,
    isInternalPettyCashRole: role => !!role && !/tenant|vendor/i.test(role),
} });

test('legacy approver lookup rejects ordinary internal users before reading candidates', async () => {
    let reads = 0;
    const { GET } = loadTs('app/api/properties/[propertyId]/approvers/route.ts', {
        ...accessMock({ organizationId: org, canManageRouting: false }),
        '@/backend/lib/supabase/admin': { supabaseAdmin: { from: () => { reads++; throw Error('No candidate access'); } } },
    });
    assert.equal((await GET(input(), params)).status, 403);
    assert.equal(reads, 0);
});

test('legacy approver lookup rejects a property outside the selected organization', async () => {
    let memberships = 0;
    const from = table => {
        if (table !== 'properties') memberships++;
        const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: null }),
            limit: () => q, not: () => q, or: () => q, in: () => q, then: resolve => Promise.resolve({ data: [] }).then(resolve) };
        return q;
    };
    const { GET } = loadTs('app/api/properties/[propertyId]/approvers/route.ts', {
        ...accessMock({ organizationId: org, canManageRouting: true }),
        '@/backend/lib/supabase/admin': { supabaseAdmin: { from } },
    });
    assert.equal((await GET(input(), params)).status, 403);
    assert.equal(memberships, 0);
});
