import test from 'node:test';
import assert from 'node:assert/strict';

import { fixture } from './fixtures.mjs';

test('organization summaries retain pending approvals when another membership is already active', async () => {
    for (const existingScope of ['organization', 'property']) {
        const f = fixture();
        f.db.users.find(u => u.id === 'pending').is_approved = true;
        f.db.users.find(u => u.id === 'pending').approval_status = 'approved';
        if (existingScope === 'organization') f.db.organization_memberships.push({ user_id: 'pending', organization_id: 'o1', role: 'staff', is_active: true, approval_status: 'approved' });
        else f.db.property_memberships.unshift({ user_id: 'pending', property_id: 'p2', organization_id: 'o1', role: 'staff', is_active: true, approval_status: 'approved' });
        const response = await f.route('list').GET({ url: 'http://fixture/api/users/list?orgId=o1' });
        const user = (await response.json()).users.find(u => u.id === 'pending');
        assert.equal(user.approval_status, 'pending', existingScope);
        assert.equal(user.is_approved, false, existingScope);
    }
});
const list = (f, params) => f.route('list').GET({ url: `http://fixture/api/users/list?${params}` });

test('active ops can list pending property members through the property alias, without unassigned profiles', async () => {
    const f = fixture(); const response = await list(f, 'orgId=o1');
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).users.map(u => u.id), ['caller', 'pending']);
    assert.ok(!f.reads.some(r => r.table === 'users' && r.filters.some(([k]) => k === 'organization_id')));
});
test('inactive ops cannot list organization users', async () => { assert.equal((await list(fixture({ active: false }), 'orgId=o1')).status, 403); });
test('property-only lists require authentication', async () => { assert.equal((await list(fixture({ authenticated: false }), 'propertyId=p1')).status, 401); });
test('property admin lists only its own property', async () => {
    const f = fixture({ callerRole: 'staff' }); f.db.property_memberships.push({ user_id: 'caller', property_id: 'p1', role: 'property_admin', is_active: true });
    assert.equal((await list(f, 'propertyId=p1')).status, 200);
    assert.equal((await list(f, 'orgId=o1')).status, 403); assert.equal((await list(f, 'propertyId=p2')).status, 403);
});
test('organization/property mismatch is rejected even for a master admin', async () => { assert.equal((await list(fixture({ master: true }), 'orgId=o2&propertyId=p1')).status, 400); });
test('property list attaches only organization roles and employee profiles from the property organization', async () => {
    const f = fixture(); f.db.organization_memberships.push({ user_id: 'pending', organization_id: 'o2', role: 'org_super_admin', is_active: true });
    f.db.employee_profiles.push({ user_id: 'pending', email: 'pending@test', organization_id: 'o2', designation: 'Other organization' });
    const response = await list(f, 'propertyId=p1'); assert.equal(response.status, 200);
    const user = (await response.json()).users[0]; assert.equal(user.orgRole, undefined); assert.equal(user.designation, null);
});

test('master directory lists pending organization rows and omits rejected or deleted inactive profiles', async () => {
    const f = fixture({ master: true });
    f.db.users.push({ id: 'org-pending', full_name: 'Organization pending', approval_status: 'pending_approval', is_approved: true }, { id: 'rejected', full_name: 'Rejected', is_approved: false, approval_status: 'rejected' }, { id: 'deleted', full_name: 'Deleted', is_approved: false, deleted_at: '2026-10-01' });
    for (const user_id of ['org-pending', 'rejected', 'deleted']) f.db.organization_memberships.push({ user_id, organization_id: 'o1', role: 'staff', is_active: false, approval_status: user_id === 'org-pending' ? 'pending' : null });
    const response = await list(f, 'orgId=o1'); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).users.map(u => u.id), ['caller', 'org-pending', 'pending']);
});
test('ops cannot list another organization or its property and inactive property admin is denied', async () => {
    for (const params of ['orgId=o2', 'propertyId=p3']) assert.equal((await list(fixture(), params)).status, 403);
    const f = fixture({ callerRole: 'staff' }); f.db.property_memberships.push({ user_id: 'caller', property_id: 'p1', role: 'property_admin', is_active: false });
    assert.equal((await list(f, 'propertyId=p1')).status, 403);
});
