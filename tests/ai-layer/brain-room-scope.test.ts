// 2026-11-20 (owner: "keep the whatsapp bot consistent with the fms"; "if the app doesnt allow, dont change the app"):
// HR, CRM/BD, IT, Design and Tech logins book rooms at every property of the organisation, as on the app's Book Meeting
// Room page. Everyone else books only at their own properties, as before. No database, no model, no network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeActor, type ScopeRows } from '../../backend/lib/aiLayer/scope';
import { runTurn } from '../../backend/lib/aiLayer/brain/loop/turn';
import { ANDHERI, FakeBrainData, PAREL, ROOM_A, ROOM_B, THANE, ScriptedModel, actor, call, turnDeps, turnInput } from './brain-helpers';
import { NAMES, ORG, OTHER_ORG, USER } from './helpers';

const orgProperties = { [ANDHERI]: NAMES[ANDHERI], [PAREL]: NAMES[PAREL], [THANE]: NAMES[THANE] };
const rows = (over: Partial<ScopeRows> = {}): ScopeRows => ({ userApproved: true, orgMemberships: [], propertyMemberships: [], orgProperties, superTenantPropertyIds: [], ...over });
const mem = (role: string, extra: Record<string, unknown> = {}) => ({ organization_id: ORG, role, is_active: true, approval_status: 'approved', ...extra });
const pmem = (property_id: string, role: string) => ({ property_id, role, is_active: true, approval_status: 'approved' });

describe('who books rooms where', () => {
    it('a Tech login with one property login books rooms at every property; everything else stays at its own', () => {
        const a = computeActor(USER, ORG, rows({ orgMemberships: [mem('tech')], propertyMemberships: [pmem(ANDHERI, 'property_admin')] }))!;
        assert.deepEqual(a.propertyIds, [ANDHERI]);
        assert.equal(a.roomPropertyIds?.[0], ANDHERI, 'their own property first');
        assert.deepEqual([...a.roomPropertyIds!].sort(), [ANDHERI, PAREL, THANE].sort());
        assert.equal(a.roomPropertyNames?.[THANE], NAMES[THANE]);
    });

    it('HR, CRM/BD, IT and Design get the same; the role is matched in any case', () => {
        for (const role of ['hr', 'hr_ops', 'bd_rep', 'bd_super_admin', 'it', 'design', 'TECH']) {
            const a = computeActor(USER, ORG, rows({ orgMemberships: [mem(role)], propertyMemberships: [pmem(ANDHERI, 'staff')] }));
            assert.equal(a?.roomPropertyIds?.length, 3, role);
        }
    });

    it('tenants, staff without such a role, inactive roles and roles in another org: own properties only, as before', () => {
        assert.equal(computeActor(USER, ORG, rows({ propertyMemberships: [pmem(ANDHERI, 'tenant')] }))!.roomPropertyIds, undefined);
        assert.equal(computeActor(USER, ORG, rows({ propertyMemberships: [pmem(ANDHERI, 'property_admin')] }))!.roomPropertyIds, undefined);
        assert.equal(computeActor(USER, ORG, rows({ orgMemberships: [mem('tech', { is_active: false })], propertyMemberships: [pmem(ANDHERI, 'staff')] }))!.roomPropertyIds, undefined);
        assert.equal(computeActor(USER, ORG, rows({ orgMemberships: [mem('tech', { organization_id: OTHER_ORG })], propertyMemberships: [pmem(ANDHERI, 'staff')] }))!.roomPropertyIds, undefined);
    });

    it('org-wide admins already see every property: nothing extra is added', () => {
        const a = computeActor(USER, ORG, rows({ orgMemberships: [mem('org_admin'), mem('tech')] }))!;
        assert.equal(a.orgWide, true);
        assert.equal(a.roomPropertyIds, undefined);
    });
});

describe('the room skills use it', () => {
    const tech = () => actor({ propertyIds: [ANDHERI], propertyNames: { [ANDHERI]: 'A Mafatlal Chambers' }, roomPropertyIds: [ANDHERI, PAREL, THANE], roomPropertyNames: { [ANDHERI]: 'A Mafatlal Chambers', [PAREL]: 'C Mafatlal Chambers', [THANE]: 'D Mafatlal Chambers' } });
    const roomsElsewhere = () => { const d = new FakeBrainData(); d.rooms = [{ id: ROOM_A, name: 'Conference room 1', propertyId: PAREL }, { id: ROOM_B, name: 'Boardroom', propertyId: THANE }]; return d; };

    it('rooms in the other wings are offered, not "no rooms"', async () => {
        const model = new ScriptedModel([call('rooms_list', { property: null }), call('ask_user', { question: 'Which property?', options: ['C Mafatlal Chambers', 'D Mafatlal Chambers'] })]);
        await runTurn(turnDeps(roomsElsewhere(), model), turnInput('show meeting rooms', { actor: tech() }));
        assert.match(model.toolResults()[0], /C Mafatlal Chambers \| D Mafatlal Chambers/);
    });

    it('a room at another wing can be booked by name, card then Yes', async () => {
        const data = roomsElsewhere();
        const model = new ScriptedModel([call('room_book', { room: 'Boardroom', property: 'D Mafatlal', date: '2026-11-05', start_time: '16:00', end_time: '17:00', purpose: null })]);
        const first = await runTurn(turnDeps(data, model), turnInput('book the boardroom at D Mafatlal tomorrow 4 to 5', { actor: tech() }));
        assert.equal(first.outcome, 'propose');
        assert.match(first.reply!.text, /Boardroom, D Mafatlal Chambers/);
        const second = await runTurn(turnDeps(data, new ScriptedModel([])), turnInput('yes', { state: first.state, actor: tech() }));
        assert.equal(second.outcome, 'executed');
        assert.deepEqual(data.booked.map(b => b.roomId), [ROOM_B]);
    });

    it('without the wider list, the same person sees only their own property, as before', async () => {
        const model = new ScriptedModel([call('rooms_list', { property: null }), 'x']);
        await runTurn(turnDeps(roomsElsewhere(), model), turnInput('show meeting rooms', { actor: actor({ propertyIds: [ANDHERI] }) }));
        assert.match(model.toolResults()[0], /Work Square Andheri has no meeting rooms set up in the app\. Your property team can tell you about other options\./);
    });
});

describe('a login with no property login', () => {
    it('only the WhatsApp brain asks for it: everyone else still gets nothing, as before', () => {
        const r = rows({ orgMemberships: [mem('hr')] });
        assert.equal(computeActor(USER, ORG, r), null);
        const a = computeActor(USER, ORG, r, { roomsOnlyLogins: true })!;
        assert.equal(a.roomsOnly, true);
        assert.deepEqual(a.propertyIds, []);
        assert.deepEqual([...a.roomPropertyIds!].sort(), [ANDHERI, PAREL, THANE].sort());
    });

    it('other roles with no property login, unapproved people and inactive roles get nothing', () => {
        assert.equal(computeActor(USER, ORG, rows({ orgMemberships: [mem('procurement')] }), { roomsOnlyLogins: true }), null);
        assert.equal(computeActor(USER, ORG, rows({ orgMemberships: [mem('hr')], userApproved: false }), { roomsOnlyLogins: true }), null);
        assert.equal(computeActor(USER, ORG, rows({ orgMemberships: [mem('hr', { is_active: false })] }), { roomsOnlyLogins: true }), null);
    });

    it('people with a property login are unchanged by the option', () => {
        const r = rows({ orgMemberships: [mem('tech')], propertyMemberships: [pmem(ANDHERI, 'staff')] });
        assert.deepEqual(computeActor(USER, ORG, r, { roomsOnlyLogins: true }), computeActor(USER, ORG, r));
    });
});
