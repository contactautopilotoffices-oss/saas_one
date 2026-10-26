import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request } from './fixtures.mjs';
const post = (f, route, body) => f.route(route).POST(request(body));
const createBody = { email: 'created@test', full_name: 'Created', password: 'fixture-password', organization_id: 'o1', property_id: 'p1', role: 'staff' };
const addOtherMemberships = f => {
    f.db.property_memberships.push({ user_id: 'pending', property_id: 'p2', organization_id: 'o1', role: 'mst', is_active: false, approval_status: 'pending' }, { user_id: 'pending', property_id: 'p3', organization_id: 'o2', role: 'staff', is_active: false, approval_status: 'pending' });
    f.db.organization_memberships.push({ user_id: 'pending', organization_id: 'o1', role: 'staff', is_active: false, approval_status: 'pending' }, { user_id: 'pending', organization_id: 'o2', role: 'staff', is_active: false, approval_status: 'pending' });
};

test('active ops may invite and create within its organization', async () => {
    for (const name of ['invite', 'create']) { const f = fixture(); assert.equal((await post(f, name, name === 'create' ? createBody : { email: 'created@test', organization_id: 'o1' })).status, 200); assert.equal(f.authCalls.length, 1); }
});
test('inactive ops and other-organization ops cannot invite or create', async () => {
    for (const name of ['invite', 'create']) for (const inactive of [true, false]) {
        const f = fixture({ active: !inactive }); const body = name === 'create' ? { ...createBody } : { email: 'created@test', organization_id: 'o1' };
        if (!inactive) { body.organization_id = 'o2'; if (name === 'create') body.property_id = 'p3'; }
        assert.equal((await post(f, name, body)).status, 403); assert.equal(f.authCalls.length, 0);
    }
});
test('ops cannot create master admins through either role or flag', async () => {
    for (const flags of [{ role: 'master_admin' }, { create_master_admin: true }]) { const f = fixture(); assert.equal((await post(f, 'create', { ...createBody, ...flags })).status, 403); assert.equal(f.authCalls.length, 0); }
});
test('create rejects mismatched property/organization before creating auth user', async () => {
    const f = fixture(); assert.equal((await post(f, 'create', { ...createBody, property_id: 'p3' })).status, 400); assert.equal(f.authCalls.length, 0);
});
test('property creation requires active own-property admin and does not grant organization-wide roles', async () => {
    for (const active of [true, false]) { const f = fixture({ callerRole: 'staff' }); f.db.property_memberships.push({ user_id: 'caller', property_id: 'p1', role: 'property_admin', is_active: active });
        assert.equal((await post(f, 'create', createBody)).status, active ? 200 : 403);
    }
    const f = fixture({ callerRole: 'staff' }); f.db.property_memberships.push({ user_id: 'caller', property_id: 'p1', role: 'property_admin', is_active: true });
    assert.equal((await post(f, 'create', { ...createBody, role: 'ops_super_admin' })).status, 403);
});
test('property assignment preserves org-super-admin-only authority and denies ops, admin and property admins', async () => {
    for (const role of ['ops_super_admin', 'org_super_admin', 'admin', 'property_admin']) { const f = fixture({ callerRole: role });
        assert.equal((await post(f, 'assign-property', { userId: 'pending', propertyId: 'p2', organizationId: 'o1', role: 'staff' })).status, role === 'org_super_admin' ? 200 : 403);
    }
});
test('property assignment rejects mismatched organization on add and remove', async () => {
    for (const action of ['add', 'remove']) { const f = fixture(); assert.equal((await post(f, 'assign-property', { userId: 'pending', propertyId: 'p3', organizationId: 'o1', action })).status, 400); assert.equal(f.writes.length, 0); }
});
test('approval of a multi-membership user requires explicit organization when ambiguous', async () => {
    const f = fixture(); addOtherMemberships(f); assert.equal((await post(f, 'approve', { userId: 'pending' })).status, 400); assert.equal(f.writes.length, 0);
});
test('organization approval activates all and only existing memberships in that organization', async () => {
    const f = fixture(); addOtherMemberships(f); const response = await post(f, 'approve', { userId: 'pending', organizationId: 'o1' }); assert.equal(response.status, 200);
    assert.deepEqual(f.db.property_memberships.filter(m => m.user_id === 'pending').map(m => m.is_active), [true, true, false]);
    assert.deepEqual(f.db.organization_memberships.filter(m => m.user_id === 'pending').map(m => m.is_active), [true, false]);
    assert.equal(f.db.employee_profiles[0].organization_id, 'o1');
});
test('property approval does not activate other properties or fabricate organization membership', async () => {
    const f = fixture(); f.db.property_memberships.push({ user_id: 'pending', property_id: 'p2', organization_id: 'o1', role: 'staff', is_active: false, approval_status: 'pending' });
    assert.equal((await post(f, 'approve', { userId: 'pending', propertyId: 'p1', organizationId: 'o1' })).status, 200);
    assert.deepEqual(f.db.property_memberships.map(m => m.is_active), [true, false]);
    assert.equal(f.db.organization_memberships.filter(m => m.user_id === 'pending').length, 0);
});
test('approval rejects a property not held by target or a mismatched organization without writes', async () => {
    for (const body of [{ propertyId: 'p2', organizationId: 'o1' }, { propertyId: 'p1', organizationId: 'o2' }]) { const f = fixture(); assert.equal((await post(f, 'approve', { userId: 'pending', ...body })).status, 400); assert.equal(f.writes.length, 0); }
});
test('property admin may approve own-property membership but not whole organization', async () => {
    const f = fixture({ callerRole: 'staff' }); f.db.property_memberships.push({ user_id: 'caller', property_id: 'p1', role: 'property_admin', is_active: true });
    assert.equal((await post(f, 'approve', { userId: 'pending', organizationId: 'o1' })).status, 403);
    assert.equal((await post(f, 'approve', { userId: 'pending', organizationId: 'o1', propertyId: 'p1' })).status, 200);
});
test('property rejection deactivates only the requested property', async () => {
    const f = fixture(); addOtherMemberships(f); f.db.property_memberships.forEach(m => { m.is_active = true; }); f.db.organization_memberships.forEach(m => { m.is_active = true; });
    assert.equal((await post(f, 'approve', { userId: 'pending', organizationId: 'o1', propertyId: 'p1', action: 'reject' })).status, 200);
    assert.deepEqual(f.db.property_memberships.map(m => m.is_active), [false, true, true]); assert.ok(f.db.organization_memberships.every(m => m.is_active));
});
test('inactive ops and unassigned targets cannot be approved', async () => {
    for (const [f, userId] of [[fixture({ active: false }), 'pending'], [fixture(), 'unassigned']]) { const response = await post(f, 'approve', { userId, organizationId: 'o1' }); assert.ok([400, 403].includes(response.status)); assert.equal(f.writes.length, 0); }
});

test('organization-only approval of property-only user activates its scoped properties without organization upsert', async () => {
    const f = fixture(); f.db.property_memberships.push({ user_id: 'pending', property_id: 'p2', organization_id: 'o1', role: 'staff', is_active: false, approval_status: 'pending' });
    assert.equal((await post(f, 'approve', { userId: 'pending', organizationId: 'o1' })).status, 200);
    assert.ok(f.db.property_memberships.every(m => m.is_active)); assert.equal(f.db.organization_memberships.filter(m => m.user_id === 'pending').length, 0);
});
test('inactive assignment and cross-organization approval are denied', async () => {
    const f = fixture({ active: false }); assert.equal((await post(f, 'assign-property', { userId: 'pending', propertyId: 'p2', organizationId: 'o1' })).status, 403); assert.equal(f.writes.length, 0);
    const other = fixture(); addOtherMemberships(other); assert.equal((await post(other, 'approve', { userId: 'pending', organizationId: 'o2' })).status, 403); assert.equal(other.writes.length, 0);
});
test('runtime invite roles cannot bypass the documented organization role set', async () => {
    const f = fixture(); assert.equal((await post(f, 'invite', { email: 'created@test', organization_id: 'o1', role: 'master_admin' })).status, 400); assert.equal(f.authCalls.length, 0);
});
test('organization-only approval preserves supported explicit role changes on the scoped organization row', async () => {
    const f = fixture(); addOtherMemberships(f); assert.equal((await post(f, 'approve', { userId: 'pending', organizationId: 'o1', role: 'hr' })).status, 200);
    assert.equal(f.db.organization_memberships.find(m => m.user_id === 'pending' && m.organization_id === 'o1').role, 'hr');
    assert.equal(f.db.organization_memberships.find(m => m.user_id === 'pending' && m.organization_id === 'o2').role, 'staff');
});
test('property approval cannot promote or activate organization authority through any admin role label', async () => {
    for (const role of ['org_super_admin', 'ops_super_admin', 'org_admin', 'admin', 'owner', 'bd_admin', 'bd_super_admin', 'master_admin']) {
        for (const preexisting of [false, true]) {
            const f = fixture({ callerRole: 'staff' }); f.db.property_memberships.push({ user_id: 'caller', property_id: 'p1', role: 'property_admin', is_active: true });
            if (preexisting) f.db.property_memberships[0].role = role;
            const response = await post(f, 'approve', { userId: 'pending', propertyId: 'p1', organizationId: 'o1', ...(!preexisting ? { role } : {}) });
            assert.equal(response.status, 403, `${role} preexisting=${preexisting}`); assert.equal(f.writes.length, 0);
        }
    }
});
test('rejecting one property preserves globally approved profile with other active organization access', async () => {
    const f = fixture(); addOtherMemberships(f); Object.assign(f.db.users.find(u => u.id === 'pending'), { is_approved: true, approval_status: 'approved' });
    f.db.property_memberships.find(m => m.property_id === 'p3').is_active = true;
    f.db.organization_memberships.find(m => m.user_id === 'pending' && m.organization_id === 'o2').is_active = true;
    assert.equal((await post(f, 'approve', { userId: 'pending', propertyId: 'p1', organizationId: 'o1', action: 'reject' })).status, 200);
    const profile = f.db.users.find(u => u.id === 'pending'); assert.equal(profile.is_approved, true); assert.equal(profile.approval_status, 'approved');
});
test('approving one scope keeps another inactive membership pending in its own directory', async () => {
    const f = fixture(); addOtherMemberships(f); assert.equal((await post(f, 'approve', { userId: 'pending', propertyId: 'p1', organizationId: 'o1' })).status, 200);
    f.db.users[0].is_master_admin = true;
    const response = await f.route('list').GET({ url: 'http://fixture/api/users/list?orgId=o2' }); assert.equal(response.status, 200);
    const pending = (await response.json()).users.find(u => u.id === 'pending'); assert.ok(pending); assert.equal(pending.is_approved, false); assert.equal(pending.approval_status, 'pending');
});
test('scoped rejection and membership removal stay hidden without hiding another pending scope', async () => {
    const f = fixture(); addOtherMemberships(f); f.db.property_memberships.find(m => m.property_id === 'p3').is_active = true;
    Object.assign(f.db.users.find(u => u.id === 'pending'), { is_approved: true, approval_status: 'approved' });
    assert.equal((await post(f, 'approve', { userId: 'pending', propertyId: 'p1', organizationId: 'o1', action: 'reject' })).status, 200);
    f.db.property_memberships.find(m => m.property_id === 'p2').approval_status = 'inactive';
    f.db.users[0].is_master_admin = true;
    const response = await f.route('list').GET({ url: 'http://fixture/api/users/list?propertyId=p1' }); assert.deepEqual((await response.json()).users, []);
    const removed = await f.route('list').GET({ url: 'http://fixture/api/users/list?propertyId=p2' }); assert.deepEqual((await removed.json()).users, []);
});
test('organization super admin cannot assign a master-admin role', async () => {
    const f = fixture({ callerRole: 'org_super_admin' }); assert.equal((await post(f, 'assign-property', { userId: 'pending', propertyId: 'p2', organizationId: 'o1', role: 'master_admin' })).status, 403); assert.equal(f.writes.length, 0);
});
