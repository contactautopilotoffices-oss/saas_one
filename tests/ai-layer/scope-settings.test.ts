import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeActor, type ScopeRows } from '../../backend/lib/aiLayer/scope';
import { gate, effectiveLimits, parseSettings } from '../../backend/lib/aiLayer/settings';
import { catalogFor } from '../../backend/lib/aiLayer/catalog';
import { ANDHERI, NAMES, ORG, OTHER_ORG, PAREL, THANE, USER, OTHER_USER, actor, settings } from './helpers';

const orgProperties = { [ANDHERI]: NAMES[ANDHERI], [PAREL]: NAMES[PAREL], [THANE]: NAMES[THANE] };
function rows(over: Partial<ScopeRows> = {}): ScopeRows {
    return { userApproved: true, orgMemberships: [], propertyMemberships: [], orgProperties, superTenantPropertyIds: [], ...over };
}
const mem = (role: string, extra: Record<string, unknown> = {}) => ({ organization_id: ORG, role, is_active: true, approval_status: 'approved', ...extra });
const pmem = (property_id: string, role: string, extra: Record<string, unknown> = {}) => ({ property_id, role, is_active: true, approval_status: 'approved', ...extra });

describe('scope: who sees which properties', () => {
    it('org super admin sees every property of its own org', () => {
        const a = computeActor(USER, ORG, rows({ orgMemberships: [mem('org_super_admin')] }))!;
        assert.equal(a.orgWide, true);
        assert.deepEqual(a.propertyIds.sort(), [ANDHERI, PAREL, THANE].sort());
        assert.equal(a.recordRule, 'all_in_scope');
    });

    it('a membership in another org gives nothing here', () => {
        assert.equal(computeActor(USER, ORG, rows({ orgMemberships: [mem('org_super_admin', { organization_id: OTHER_ORG })] })), null);
    });

    it('property admin of one building sees only that building', () => {
        const a = computeActor(USER, ORG, rows({ propertyMemberships: [pmem(ANDHERI, 'property_admin')] }))!;
        assert.equal(a.orgWide, false);
        assert.deepEqual(a.propertyIds, [ANDHERI]);
        assert.deepEqual(Object.keys(a.propertyNames), [ANDHERI]);
    });

    it('roles that isOrganizationWideUserRole() calls org-wide are NOT org-wide here (gap S16)', () => {
        for (const role of ['tech', 'it', 'design', 'hr', 'super_tenant', 'accounts', 'procurement']) {
            assert.equal(computeActor(USER, ORG, rows({ orgMemberships: [mem(role)] }))?.orgWide ?? false, false, role);
        }
    });

    it('super tenant sees only the properties assigned to it, and only its own tickets', () => {
        const a = computeActor(USER, ORG, rows({
            orgMemberships: [mem('super_tenant')],
            propertyMemberships: [pmem(ANDHERI, 'super_tenant'), pmem(PAREL, 'super_tenant')],
            superTenantPropertyIds: [PAREL],
        }))!;
        assert.deepEqual(a.propertyIds, [PAREL]);
        assert.equal(a.ownRecordsOnly, true);
        assert.equal(a.recordRule, 'raised_by_me');
    });

    it('super tenant with no assigned properties gets nothing', () => {
        assert.equal(computeActor(USER, ORG, rows({ orgMemberships: [mem('super_tenant')], propertyMemberships: [pmem(ANDHERI, 'super_tenant')] })), null);
    });

    it('tenant: own tickets only; vendor: tickets assigned to them', () => {
        assert.equal(computeActor(USER, ORG, rows({ propertyMemberships: [pmem(ANDHERI, 'tenant')] }))!.recordRule, 'raised_by_me');
        assert.equal(computeActor(USER, ORG, rows({ propertyMemberships: [pmem(ANDHERI, 'vendor')] }))!.recordRule, 'assigned_to_me');
    });

    it('pending, rejected or inactive memberships do not count; unapproved users get nothing', () => {
        assert.equal(computeActor(USER, ORG, rows({ propertyMemberships: [pmem(ANDHERI, 'property_admin', { approval_status: 'pending' })] })), null);
        assert.equal(computeActor(USER, ORG, rows({ propertyMemberships: [pmem(ANDHERI, 'property_admin', { is_active: false })] })), null);
        assert.equal(computeActor(USER, ORG, rows({ userApproved: false, orgMemberships: [mem('org_super_admin')] })), null);
    });

    it('a property outside this org is ignored even with a membership', () => {
        const foreign = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const a = computeActor(USER, ORG, rows({ propertyMemberships: [pmem(foreign, 'property_admin'), pmem(ANDHERI, 'mst')] }))!;
        assert.deepEqual(a.propertyIds, [ANDHERI]);
    });

    it('mixed staff + tenant roles: the narrower reading wins (staff properties only)', () => {
        const a = computeActor(USER, ORG, rows({ propertyMemberships: [pmem(ANDHERI, 'mst'), pmem(PAREL, 'tenant')] }))!;
        assert.deepEqual(a.propertyIds, [ANDHERI]);
        assert.equal(a.recordRule, 'all_in_scope');
    });
});

describe('settings gate: configurable, and can only narrow', () => {
    it('is off by default and when the org switch is off', () => {
        assert.deepEqual(gate(actor(), parseSettings({}), 'app_chat'), { ok: false, reason: 'org_off' });
    });

    it('WhatsApp is off by default and on only when the org switches it on', () => {
        assert.deepEqual(gate(actor(), settings(), 'whatsapp'), { ok: false, reason: 'channel_off' });
        const s = settings({ channels: { app_chat: true, whatsapp: true, app_voice: false } });
        assert.equal(gate(actor(), s, 'whatsapp').ok, true);
    });

    it('selected people / selected roles / both', () => {
        const me = actor();
        assert.equal(gate(me, settings({ access: { mode: 'selected_people', userIds: [OTHER_USER], roles: [] } }), 'app_chat').ok, false);
        assert.equal(gate(me, settings({ access: { mode: 'selected_people', userIds: [USER], roles: [] } }), 'app_chat').ok, true);
        assert.equal(gate(me, settings({ access: { mode: 'selected_roles', userIds: [], roles: ['mst'] } }), 'app_chat').ok, false);
        assert.equal(gate(me, settings({ access: { mode: 'selected_roles', userIds: [], roles: ['property_admin'] } }), 'app_chat').ok, true);
        assert.equal(gate(me, settings({ access: { mode: 'people_and_roles', userIds: [USER], roles: ['mst'] } }), 'app_chat').ok, true);
    });

    it('"all staff" never includes tenants or vendors unless picked by name or role', () => {
        const tenant = actor({ roles: ['tenant'], ownRecordsOnly: true, recordRule: 'raised_by_me' });
        assert.equal(gate(tenant, settings({ access: { mode: 'all_staff', userIds: [], roles: [] } }), 'app_chat').ok, false);
        assert.equal(gate(tenant, settings({ access: { mode: 'all_staff', userIds: [], roles: ['tenant'] } }), 'app_chat').ok, true);
    });

    it('a blocked person is refused whatever else is set', () => {
        const s = settings({ access: { mode: 'selected_people', userIds: [USER], roles: [] }, blockedUserIds: [USER] });
        assert.deepEqual(gate(actor(), s, 'app_chat'), { ok: false, reason: 'blocked' });
    });

    it('selected properties narrow the actor; a property the person lacks is never added', () => {
        const me = actor({ propertyIds: [ANDHERI, PAREL] });
        const r = gate(me, settings({ propertyIds: [PAREL, THANE] }), 'app_chat');
        assert.ok(r.ok);
        if (r.ok) assert.deepEqual(r.actor.propertyIds, [PAREL]);
        assert.deepEqual(gate(actor(), settings({ propertyIds: [THANE] }), 'app_chat'), { ok: false, reason: 'no_properties' });
    });

    it('grid: questions only hides ticket creation; off hides the module', () => {
        const s = settings({ grid: { property_admin: { tickets: 'questions', electricity_readings: 'off' } } });
        const ids = catalogFor(actor(), s).map(x => x.entry.id);
        assert.deepEqual(ids, ['tickets.count', 'tickets.list']);
    });

    it('narrow-only: switching meter readings on for tenants still shows them nothing about meters', () => {
        const tenant = actor({ roles: ['tenant'], ownRecordsOnly: true, recordRule: 'raised_by_me' });
        const ids = catalogFor(tenant, settings()).map(x => x.entry.id);
        assert.ok(!ids.some(id => id.startsWith('electricity.')), ids.join(','));
        assert.ok(ids.includes('tickets.count'));
    });

    it('writes start in shadow unless switched live; an entry can be switched off', () => {
        assert.equal(catalogFor(actor(), settings()).find(x => x.entry.id === 'ticket.create')?.mode, 'shadow');
        assert.equal(catalogFor(actor(), settings({ entryModes: { 'ticket.create': 'live' } })).find(x => x.entry.id === 'ticket.create')?.mode, 'live');
        assert.equal(catalogFor(actor(), settings({ entryModes: { 'tickets.list': 'off' } })).some(x => x.entry.id === 'tickets.list'), false);
    });

    it("org limits can't go above the platform ceiling", () => {
        assert.deepEqual(effectiveLimits(settings({ limits: { perUserPerHour: 999, actionsPerUserPerDay: 999 } })), { perUserPerHour: 60, actionsPerUserPerDay: 100 });
    });

    it('rejects unknown keys in saved settings (strict) by falling back to OFF', () => {
        assert.equal(parseSettings({ enabled: true, superMode: true }).enabled, false);
    });
});
