import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { claimWhatsApp, type WhatsAppDeps } from '../../backend/lib/aiLayer/whatsapp';
import { handleTurn } from '../../backend/lib/aiLayer/pipeline';
import { ORG, OTHER_ORG, USER, FakeAudit, FakeData, FakeLlm, actor, deps, settings } from './helpers';

const PHONE = '919876543210';
const COUNT = { entry: 'tickets.count', fields: { period: 'today', status: 'all' } };

function wa(over: Partial<WhatsAppDeps> = {}, llm = new FakeLlm([[/kitne|tickets/, COUNT]])) {
    const sent: Array<{ phone: string; text: string }> = [];
    const saved: unknown[] = [];
    const data = new FakeData();
    const s = settings({ channels: { app_chat: true, whatsapp: true, app_voice: false }, access: { mode: 'selected_people', userIds: [USER], roles: [] } });
    const d: WhatsAppDeps = {
        env: {},
        findUser: async () => ({ id: USER, is_master_admin: false }),
        orgsForUser: async () => [ORG],
        loadActor: async () => actor(),
        loadSettings: async () => s,
        loadState: async () => null,
        saveState: async (_o, _u, st) => { saved.push(st); },
        runTurn: (input) => handleTurn(deps(data, llm, new FakeAudit()), input),
        sendReply: async (phone, text) => { sent.push({ phone, text }); return true; },
        ...over,
    };
    return { d, sent, saved, data, llm };
}
const msg = (text: string, extra = {}) => ({ phone: PHONE, text, messageId: 'm1', ...extra });

describe('WhatsApp channel: only for configured people, never breaks the existing bot', () => {
    it('answers a configured person and sends the reply in the background', async () => {
        const { d, sent, saved } = wa();
        const r = await claimWhatsApp(d, msg('aaj kitne tickets bane?'));
        assert.equal(r.handled, true);
        assert.equal(sent.length, 0, 'nothing is sent before the webhook answers');
        if (r.handled) await r.background();
        assert.equal(sent[0].phone, PHONE);
        assert.match(sent[0].text, /Aaj, Work Square Andheri/);
        assert.equal(saved.length, 1);
    });

    it('people not selected by the org super admin go to the existing bot', async () => {
        const { d, llm } = wa({ loadSettings: async () => settings({ channels: { app_chat: true, whatsapp: true, app_voice: false }, access: { mode: 'selected_people', userIds: [], roles: [] } }) });
        assert.deepEqual(await claimWhatsApp(d, msg('aaj kitne tickets bane?')), { handled: false, why: 'not_enabled' });
        assert.equal(llm.calls, 0);
    });

    it('WhatsApp switched off for the org → existing bot', async () => {
        const { d } = wa({ loadSettings: async () => settings({ access: { mode: 'selected_people', userIds: [USER], roles: [] } }) });
        assert.equal((await claimWhatsApp(d, msg('aaj kitne tickets bane?'))).handled, false);
    });

    it('messages it does not understand go to the existing bot', async () => {
        const { d, sent } = wa({}, new FakeLlm([]));
        assert.deepEqual(await claimWhatsApp(d, msg('hi')), { handled: false, why: 'unsupported' });
        assert.equal(sent.length, 0);
    });

    it('unknown numbers, master admins, photos and voice notes → existing bot', async () => {
        assert.equal((await claimWhatsApp(wa({ findUser: async () => null }).d, msg('aaj kitne tickets?'))).handled, false);
        assert.equal((await claimWhatsApp(wa({ findUser: async () => ({ id: USER, is_master_admin: true }) }).d, msg('aaj kitne tickets?'))).handled, false);
        assert.equal((await claimWhatsApp(wa().d, msg('AC broken', { mediaUrl: 'https://x/y.jpg' }))).handled, false);
        assert.equal((await claimWhatsApp(wa().d, msg(''))).handled, false);
    });

    it('switched on in two orgs → does not guess, existing bot answers', async () => {
        const { d } = wa({ orgsForUser: async () => [ORG, OTHER_ORG], loadActor: async (_u, orgId) => actor({ orgId }) });
        assert.deepEqual(await claimWhatsApp(d, msg('aaj kitne tickets bane?')), { handled: false, why: 'several_orgs' });
    });

    it('kill switch → existing bot', async () => {
        const { d } = wa({ env: { AI_LAYER_DISABLED: 'true' } });
        assert.equal((await claimWhatsApp(d, msg('aaj kitne tickets bane?'))).handled, false);
    });

    it('an error anywhere inside never breaks the webhook', async () => {
        const { d } = wa({ loadSettings: async () => { throw new Error('db down'); } });
        assert.deepEqual(await claimWhatsApp(d, msg('aaj kitne tickets bane?')), { handled: false, why: 'error' });
    });

    it('a ticket draft continues across WhatsApp messages using the saved state', async () => {
        let stored: unknown = null;
        const llm = new FakeLlm([[/AC/, { entry: 'ticket.create', fields: { description: 'AC not working', location: null } }]]);
        const { d, sent } = wa({ loadState: async () => stored, saveState: async (_o, _u, st) => { stored = st; } }, llm);
        let r = await claimWhatsApp(d, msg('AC not working'));
        if (r.handled) await r.background();
        assert.match(sent.at(-1)!.text, /Floor, room or cabin/);
        r = await claimWhatsApp(d, msg('3rd floor'));
        if (r.handled) await r.background();
        assert.match(sent.at(-1)!.text, /Reply Yes \/ Change \/ Cancel/);
        r = await claimWhatsApp(d, msg('yes'));
        if (r.handled) await r.background();
        assert.match(sent.at(-1)!.text, /Test mode/);
    });
});
