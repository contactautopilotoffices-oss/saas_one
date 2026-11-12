import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkLines, type CheckInputs } from '../../backend/lib/aiLayer/diagnose';
import { USER, OTHER_USER, actor, settings } from './helpers';

const base = (over: Partial<CheckInputs> = {}): CheckInputs => ({
    tableMissing: false,
    settings: settings({ channels: { app_chat: true, whatsapp: true, app_voice: false }, access: { mode: 'selected_people', userIds: [USER], roles: [] } }),
    userId: USER, name: 'Harsh', phone: '9876543210', isMasterAdmin: false, phoneOwnerId: USER,
    actor: actor({ roles: ['ops_super_admin'], orgWide: true }), whatsappOrgCount: 1, ...over,
});
const failed = (i: CheckInputs) => checkLines(i).filter(l => !l.ok).map(l => l.label);

describe('"Check this person" explains exactly what blocks the WhatsApp AI', () => {
    it('all green when everything is set', () => {
        const s = settings({ channels: { app_chat: true, whatsapp: true, app_voice: false }, access: { mode: 'selected_people', userIds: [USER], roles: [] },
            grid: { ops_super_admin: { tickets: 'questions_actions', electricity_readings: 'questions' } } });
        assert.deepEqual(failed(base({ settings: s })), []);
        assert.match(checkLines(base({ settings: s })).find(l => l.label.startsWith('Something'))!.detail, /count tickets/);
    });
    it('WhatsApp not ticked / org switch off', () => {
        assert.ok(failed(base({ settings: settings({ access: { mode: 'selected_people', userIds: [USER], roles: [] } }) })).includes('WhatsApp ticked'));
        assert.ok(failed(base({ settings: { ...base().settings, enabled: false } })).includes('AI assistant switched on'));
    });
    it("the person's role has nothing switched on: names their roles", () => {
        const lines = checkLines(base({ actor: actor({ roles: ['tech'] }) }));
        const line = lines.find(l => l.label === 'Something switched on for their role')!;
        assert.equal(line.ok, false);
        assert.match(line.detail, /\(tech\)/);
    });
    it('phone problems: missing, on another account, not recognised', () => {
        assert.ok(failed(base({ phone: null })).includes('Phone number recognised'));
        assert.match(checkLines(base({ phoneOwnerId: OTHER_USER })).find(l => l.label === 'Phone number recognised')!.detail, /different account/);
        assert.match(checkLines(base({ phoneOwnerId: null })).find(l => l.label === 'Phone number recognised')!.detail, /more than one account/);
    });
    it('not selected, blocked, master admin, no membership, two orgs, missing tables', () => {
        assert.ok(failed(base({ settings: { ...base().settings, access: { mode: 'selected_people', userIds: [], roles: [] } } })).includes('Selected in "Who can use it"'));
        assert.ok(failed(base({ settings: { ...base().settings, blockedUserIds: [USER] } })).includes('Not blocked'));
        assert.ok(failed(base({ isMasterAdmin: true })).includes('Not a master admin'));
        assert.ok(failed(base({ actor: null })).includes('Active membership'));
        assert.ok(failed(base({ whatsappOrgCount: 2 })).includes('Only one organization'));
        assert.ok(failed(base({ tableMissing: true })).includes('Database set up'));
    });
});
