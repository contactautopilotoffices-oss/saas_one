import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleTurn } from '../../backend/lib/aiLayer/pipeline';
import { gate, parseSettings, trainingSettings } from '../../backend/lib/aiLayer/settings';
import { catalogFor } from '../../backend/lib/aiLayer/catalog';
import { FakeAudit, FakeData, FakeLlm, actor, deps, settings } from './helpers';

describe('training chat', () => {
    it('works even while the AI is off for the org, with every capability the admin\'s own access allows', () => {
        const admin = actor({ roles: ['org_super_admin'], orgWide: true });
        const s = trainingSettings(parseSettings({}), admin.roles, admin.userId);
        const g = gate(admin, s, 'app_chat');
        assert.ok(g.ok);
        if (g.ok) {
            const entries = catalogFor(g.actor, s);
            assert.deepEqual(entries.map(e => e.entry.id).sort(), ['electricity.consumption', 'electricity.readings_status', 'ticket.create', 'tickets.count', 'tickets.list']);
            assert.equal(entries.find(e => e.entry.id === 'ticket.create')?.mode, 'shadow', 'nothing real is created while training');
        }
        assert.equal(s.learning.enabled, false, 'no mistake-flagging in the training chat');
    });

    it('can\'t give more than the app allows: a tenant still sees nothing about meters', () => {
        const tenant = actor({ roles: ['tenant'], ownRecordsOnly: true, recordRule: 'raised_by_me' });
        const s = trainingSettings(parseSettings({}), tenant.roles, tenant.userId);
        assert.ok(!catalogFor(tenant, s).some(e => e.entry.id.startsWith('electricity.')));
    });

    it('a live ticket setting is forced to test mode while training', () => {
        const s = trainingSettings(settings({ entryModes: { 'ticket.create': 'live' } }), ['property_admin'], 'u');
        assert.equal(s.entryModes['ticket.create'], 'shadow');
    });

    it('every reply says what the AI understood', async () => {
        const llm = new FakeLlm([[/kitne/, { entry: 'tickets.count', fields: { period: 'today', status: 'open' } }], [/tasks/, { entry: 'tasks', fields: {} }]]);
        const d = deps(new FakeData(), llm, new FakeAudit());
        const a = await handleTurn(d, { actor: actor(), settings: settings(), channel: 'app_chat', message: 'aaj kitne open tickets', state: null });
        assert.equal(a.understood?.entryId, 'tickets.count');
        assert.equal(a.understood?.fields?.status, 'open');
        const b = await handleTurn(d, { actor: actor(), settings: settings(), channel: 'app_chat', message: 'show my tasks please', state: null });
        assert.equal(b.understood?.entryId, 'tasks');
        const c = await handleTurn(d, { actor: actor(), settings: settings(), channel: 'app_chat', message: 'something odd', state: null });
        assert.equal(c.understood?.entryId, 'none');
        const h = await handleTurn(d, { actor: actor(), settings: settings(), channel: 'app_chat', message: 'I want to complain about my manager', state: null });
        assert.equal(h.understood?.entryId, 'hr');
    });
});
