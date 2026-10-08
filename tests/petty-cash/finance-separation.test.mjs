import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const org = 'org-a';
const { pettyCashCaps } = loadTs('frontend/lib/pettyCash/roles.ts');
const { accountsCaps } = loadTs('frontend/lib/accounts/roles.ts');

test('petty cash eligibility never grants Payment Tracker capabilities', async () => {
    for (const role of ['staff', 'mst', 'property_admin', 'manager', 'security', 'hr']) {
        const membership = { org_id: org, org_role: role };
        assert.equal(pettyCashCaps(membership, org).canSee, true, role);
        assert.equal(accountsCaps(membership, org).canSee, false, role);
        const from = table => {
            const q = { select: () => q, eq: () => q,
                maybeSingle: async () => ({ data: { is_master_admin: false } }),
                then: resolve => Promise.resolve({ data: table === 'organization_memberships' ? [{ organization_id: org, role }] : [] }).then(resolve) };
            return q;
        };
        const { resolveAccountsAccessForUser } = loadTs('backend/lib/accounts/access.ts', {
            '@/backend/lib/supabase/admin': { supabaseAdmin: { from } },
            '@/frontend/utils/supabase/server': {},
        });
        assert.equal((await resolveAccountsAccessForUser({ id: 'fixture' }, org)).status, 403, role);
    }
    for (const role of ['accounts', 'procurement', 'org_admin', 'org_super_admin', 'ops_super_admin']) {
        assert.equal(accountsCaps({ org_id: org, org_role: role }, org).canSee, true, role);
    }
});

test('Payment Tracker UI capabilities come only from memberships in the selected organization', () => {
    const membership = { org_id: org, org_role: 'staff', all_org_memberships: [{ org_id: 'org-b', role: 'accounts' }],
        properties: [{ organization_id: 'org-b', role: 'accounts' }] };
    assert.equal(accountsCaps(membership, org).canSee, false);
    assert.equal(accountsCaps(membership, 'org-b').canSee, true);
    assert.equal(accountsCaps({ ...membership, is_master_admin: true }, org).canSee, true);
});
