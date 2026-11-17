import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleTurn, type TurnState } from '../../backend/lib/aiLayer/pipeline';
import { matchProperty, suggestProperties } from '../../backend/lib/aiLayer/catalog';
import { examplePasses, maskText, runExampleTests, selectExamples, validateExample, type Example, type ReviewFlag } from '../../backend/lib/aiLayer/learning';
import { ANDHERI, PAREL, THANE, FakeAudit, FakeData, FakeLlm, actor, deps, settings } from './helpers';

const DMC = 'dddddddd-0000-4000-8000-000000000001';
const KAMALA = 'dddddddd-0000-4000-8000-000000000002';
const names = { [DMC]: 'D Mafatlal Chambers', [KAMALA]: 'Kamala Chambers', [ANDHERI]: 'Work Square Andheri' };

describe('property matching: spelling mistakes, nicknames, "did you mean"', () => {
    it('"D maftalal chambers" finds D Mafatlal Chambers, not Kamala Chambers', () => {
        assert.equal(matchProperty('D maftalal chambers', names), DMC);
        assert.equal(matchProperty('mafatlal', names), DMC);
        assert.equal(matchProperty('andheri', names), ANDHERI);
    });
    it('nicknames work', () => {
        assert.equal(matchProperty('DMC', names, { [DMC]: ['DMC', 'Mafatlal'] }), DMC);
        assert.equal(matchProperty('DMC', names), null);
    });
    it('two equally good matches → no guess, but suggestions', () => {
        assert.equal(matchProperty('chambers', names), null);
        assert.deepEqual(suggestProperties('chambers', names).sort(), [DMC, KAMALA].sort());
    });
});

describe('learning: taught answers are validated, tested, and masked', () => {
    it('rejects unknown questions and invalid details (L7), drops free text', () => {
        assert.equal(validateExample('delete.everything', {}).ok, false);
        assert.equal(validateExample('tickets.count', { period: 'next_century' }).ok, false);
        assert.deepEqual(validateExample('tickets.count', { period: 'today', status: 'open' }), { ok: true, fields: { period: 'today', status: 'open' } });
        assert.deepEqual(validateExample('ticket.create', { description: 'AC broken', urgent: true }), { ok: true, fields: { urgent: true } });
        assert.deepEqual(validateExample('tasks', { anything: 1 }), { ok: true, fields: {} });
    });
    it('a test passes only with the same answer and the same taught details', () => {
        const ex: Example = { messageText: 'what is missing', entryId: 'electricity.readings_status', fields: { day: 'today' } };
        assert.equal(examplePasses(ex, { entry: 'electricity.readings_status', fields: { day: 'today' } }), true);
        assert.equal(examplePasses(ex, { entry: 'electricity.readings_status', fields: { day: 'yesterday' } }), false);
        assert.equal(examplePasses(ex, { entry: 'tasks' }), false);
    });
    it('each example is tested WITHOUT itself as guidance', async () => {
        const examples: Example[] = [{ messageText: 'a', entryId: 'tasks', fields: {} }, { messageText: 'b', entryId: 'none', fields: {} }];
        const seen: string[][] = [];
        const rep = await runExampleTests(examples, async (m, others) => { seen.push(others.map(o => o.messageText)); return { entry: m === 'a' ? 'tasks' : 'tasks' }; });
        assert.deepEqual(seen, [['b'], ['a']]);
        assert.equal(rep.passed, 1); assert.equal(rep.failures.length, 1);
    });
    it('phone numbers and emails are masked before anything is stored', () => {
        assert.equal(maskText('call 98765 43210 or a.b@x.com about ticket'), 'call ••• or •••@••• about ticket');
    });
    it('picks the most similar taught examples, only for answers this person may use', () => {
        const ex: Example[] = [
            { messageText: 'what is missing', entryId: 'electricity.readings_status', fields: {} },
            { messageText: 'pending petty cash', entryId: 'pettycash.list', fields: {} },
            { messageText: 'show my tasks', entryId: 'tasks', fields: {} },
        ];
        const got = selectExamples('what is missing today', ex, ['electricity.readings_status']);
        assert.equal(got[0].messageText, 'what is missing');
        assert.ok(!got.some(e => e.entryId === 'pettycash.list'));
    });
});

describe('learning loop in the conversation', () => {
    const flagsOf = () => { const flags: ReviewFlag[] = []; return { flags, learning: { load: async () => ({ enabled: true, examples: [{ messageText: 'what is missing', entryId: 'electricity.readings_status', fields: { day: 'today' } }], instructions: '"DG" means the diesel generator meter.' }), flag: async (f: ReviewFlag) => { flags.push(f); } } }; };
    const on = () => settings({ learning: { enabled: true } });

    it('the AI sees taught examples and the live instructions', async () => {
        const llm = new FakeLlm([[/./, { entry: 'none', fields: {} }]]);
        const { learning } = flagsOf();
        await handleTurn({ ...deps(new FakeData(), llm, new FakeAudit()), learning }, { actor: actor(), settings: on(), channel: 'app_chat', message: 'what is missing', state: null });
        assert.match(llm.prompts[0], /Examples taught by this organization/);
        assert.match(llm.prompts[0], /what is missing<\/message> → \{"entry":"electricity.readings_status"/);
        assert.match(llm.prompts[0], /diesel generator meter/);
    });

    it('"what is missing" right after a meter answer is understood as a follow-up', async () => {
        const data = new FakeData();
        data.meters.push({ propertyId: ANDHERI, meterName: 'DG', meterStatus: 'active', logged: false, alertStatus: null, units: null });
        const llm = new FakeLlm([[/reading/, { entry: 'electricity.readings_status', fields: { day: 'today' } }], [/missing/, { entry: 'electricity.readings_status', fields: { day: 'today' } }]]);
        const d = deps(data, llm, new FakeAudit());
        const first = await handleTurn(d, { actor: actor(), settings: settings(), channel: 'app_chat', message: 'meter reading status', state: null });
        assert.equal(first.state.last?.entryId, 'electricity.readings_status');
        await handleTurn(d, { actor: actor(), settings: settings(), channel: 'app_chat', message: 'what is missing', state: first.state });
        assert.match(llm.prompts[1], /The previous question .*electricity.readings_status/);
    });

    it('flags "didn\'t understand" only while the learning loop is on', async () => {
        const llm = new FakeLlm([[/./, { entry: 'none', fields: {}, topic: 'parking' }]]);
        let x = flagsOf();
        await handleTurn({ ...deps(new FakeData(), llm, new FakeAudit()), learning: x.learning }, { actor: actor(), settings: on(), channel: 'app_chat', message: 'parking for guest', state: null });
        await new Promise(r => setImmediate(r));
        assert.deepEqual(x.flags.map(f => f.triggers), [['unknown']]);
        x = flagsOf();
        await handleTurn({ ...deps(new FakeData(), llm, new FakeAudit()), learning: x.learning }, { actor: actor(), settings: settings(), channel: 'app_chat', message: 'parking for guest', state: null });
        await new Promise(r => setImmediate(r));
        assert.equal(x.flags.length, 0);
    });

    it('"no, I meant…" flags the PREVIOUS message with this one as the follow-up', async () => {
        const x = flagsOf();
        const llm = new FakeLlm([[/./, { entry: 'tickets.count', fields: { period: 'today' } }]]);
        const prev: TurnState = { lang: 'en', last: { text: 'how many tickets', at: new Date('2026-11-04T06:29:00Z').toISOString(), entryId: 'tickets.count', fields: {}, reply: 'Today: 4 tickets' } };
        await handleTurn({ ...deps(new FakeData(), llm, new FakeAudit()), learning: x.learning }, { actor: actor(), settings: on(), channel: 'app_chat', message: 'no I meant this week', state: prev });
        await new Promise(r => setImmediate(r));
        assert.equal(x.flags[0].messageText, 'how many tickets');
        assert.equal(x.flags[0].followUpText, 'no I meant this week');
        assert.deepEqual(x.flags[0].triggers, ['correction']);
    });

    it('the property list is always numbered, and a misspelt name gets "Did you mean…?"', async () => {
        const many = Object.fromEntries(Array.from({ length: 22 }, (_, i) => [`aaaaaaaa-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, `Site ${i}`]));
        many[DMC] = 'D Mafatlal Chambers'; many[KAMALA] = 'Kamala Chambers';
        const a = actor({ roles: ['org_super_admin'], orgWide: true, propertyIds: Object.keys(many), propertyNames: many });
        const llm = new FakeLlm([[/AC/, { entry: 'ticket.create', fields: { description: 'AC not working', location: 'cabin 4' } }]]);
        const d = deps(new FakeData(), llm, new FakeAudit());
        let out = await handleTurn(d, { actor: a, settings: settings(), channel: 'app_chat', message: 'AC not working in cabin 4', state: null });
        assert.match(out.reply.text, /\n1\) Site 0\n/);
        assert.match(out.reply.text, /23\) D Mafatlal Chambers/);
        out = await handleTurn(d, { actor: a, settings: settings(), channel: 'app_chat', message: 'chambers', state: out.state });
        assert.match(out.reply.text, /couldn't find "chambers"\. Did you mean:/);
        assert.match(out.reply.text, /23\) D Mafatlal Chambers/);
        out = await handleTurn(d, { actor: a, settings: settings(), channel: 'app_chat', message: 'D maftalal chambers', state: out.state });
        assert.ok(out.reply.awaitingConfirm, out.reply.text);
        assert.match(out.reply.text, /D Mafatlal Chambers/);
    });

    it('meter status for many properties is a short summary', async () => {
        const data = new FakeData();
        for (const p of [ANDHERI, PAREL, THANE, DMC]) data.meters.push({ propertyId: p, meterName: 'EB', meterStatus: 'active', logged: p === PAREL, alertStatus: null, units: null });
        const a = actor({ roles: ['org_super_admin'], orgWide: true, propertyIds: [ANDHERI, PAREL, THANE, DMC], propertyNames: { [ANDHERI]: 'Andheri', [PAREL]: 'Parel', [THANE]: 'Thane', [DMC]: 'D Mafatlal Chambers' } });
        const llm = new FakeLlm([[/./, { entry: 'electricity.readings_status', fields: { day: 'today' } }]]);
        const out = await handleTurn(deps(data, llm, new FakeAudit()), { actor: a, settings: settings(), channel: 'app_chat', message: 'meter status', state: null });
        assert.match(out.reply.text, /^Today: 1 of 4 active meters logged across 4 properties\./);
        assert.match(out.reply.text, /• Parel: 1\/1 logged/);
        assert.match(out.reply.text, /Ask about one property/);
    });
});
