// 2026-11-18: answers that failed the fact check, from the owner's chat ("Which properties access i have" and
// "Show those 22 propertie" both got "I couldn't put that answer together reliably", twice).
// No database, no model key, no network and no WhatsApp: every dependency below is a fake.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runTurn, repairNote } from '../../backend/lib/aiLayer/brain/loop/turn';
import { skillsFor, toolDefs } from '../../backend/lib/aiLayer/brain/skills/registry';
import { FakeBrainData, ScriptedModel, actor, brainSettings, call, turnDeps, turnInput } from './brain-helpers';

/** A person with 22 properties, like the owner's account; some names have numbers in them. */
const NAMES = ['A Mafatlal Chambers', 'Radical Mind - Bangalore', 'NRK Star - Indore', 'RUPA SOLITAIRE', 'SS Plaza', 'Sigma IT Park Rabale 2nd Floor',
    'Sigma IT Park Rabale 7th Floor', 'Sky Mark Noida', 'VFS Lower Parel', 'Marathon Futurex 10th Floor', '401 Centerpoint', '701 Centerpoint',
    'FCB Kinnet', 'Mafatlal D Wing', 'ETPL Thane', 'Gowra Trinity', 'AMR Tech Park', 'BFDL Kolkata', '3i Crescent Solitaire', 'MyGate VKG',
    'Digitide Indore', 'Parsvatech Noida'];
const ids = NAMES.map((_, i) => `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000000`);
const big = () => actor({ propertyIds: ids, propertyNames: Object.fromEntries(ids.map((id, i) => [id, NAMES[i]])), orgWide: true });

describe('the property list', () => {
    it('is offered as a tool to anyone with tickets or rooms on', () => {
        const names = (a = actor()) => toolDefs(skillsFor(a, brainSettings())).map(t => t.name);
        assert.ok(names().includes('properties_mine'));
        assert.ok(!names(actor({ propertyIds: [], propertyNames: {} })).includes('properties_mine'));
    });

    it('"Show those 22 properties": all 22 come from the tool, numbers in names included, and the answer passes', async () => {
        const model = new ScriptedModel([call('properties_mine', { search: null }), (req) => {
            const listed = req.messages.at(-1)!.blocks.map(b => (b as { text?: string }).text ?? '').join('\n');
            return listed.split('\n').filter(l => l.startsWith('• ')).length === 22 ? `Here are all 22:\n${listed.split('\n').slice(1).join('\n')}` : 'missing';
        }]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('Show those 22 propertie', { actor: big() }));
        assert.equal(out.trace.grounded, true);
        assert.equal(out.trace.repaired, undefined, 'no repair needed');
        assert.match(out.reply!.text, /Marathon Futurex 10th Floor/);
        assert.match(out.reply!.text, /Parsvatech Noida/, 'the 22nd property, which the context never names');
        assert.equal(out.reply!.text.split('\n').filter(l => l.startsWith('• ')).length, 22);
    });

    it('search finds one property by part of its name or nickname, and says so when nothing matches', async () => {
        const data = new FakeBrainData();
        const one = await runTurn(turnDeps(data, new ScriptedModel([call('properties_mine', { search: 'rabale' }), 'Yes: Sigma IT Park Rabale 2nd Floor and Sigma IT Park Rabale 7th Floor.'])), turnInput('is rabale one of mine', { actor: big() }));
        assert.equal(one.trace.grounded, true);
        const none = new ScriptedModel([call('properties_mine', { search: 'Pune' }), 'None of your properties is in Pune.']);
        await runTurn(turnDeps(data, none), turnInput('do i have pune', { actor: big() }));
        assert.match(none.toolResults()[0], /None of this person's 22 properties matches "Pune"/);
    });
});

describe('repairing an answer that fails the fact check', () => {
    it('the model is told exactly what could not be traced, looks it up, and the fixed answer is sent', async () => {
        // Before: "Here are 15 of them" (15 is in no source) → "I couldn't put that answer together reliably".
        const model = new ScriptedModel(['You have 22 properties. Here are 15 of them: A Mafatlal Chambers, SS Plaza.', call('properties_mine', { search: null }), 'All of them are in the list above.']);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('Which properties access i have', { actor: big() }));
        assert.equal(out.trace.repaired, true);
        assert.equal(out.trace.grounded, true);
        assert.equal(out.reply!.text, 'All of them are in the list above.');
        const told = model.calls[1].messages.at(-1)!.blocks.map(b => (b as { text?: string }).text).join('');
        assert.match(told, /Your answer was NOT sent\. It contains "15"/);
        assert.equal(model.calls.length, 3, 'one first answer, one look-up, one fixed answer');
    });

    it('a repair that still invents falls back to code\'s own answer, and the fallback says what to do', async () => {
        const model = new ScriptedModel(['You have 99 open tickets.', 'You have 99 open tickets.']);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('how many tickets do i have'));
        assert.equal(out.trace.grounded, false);
        assert.doesNotMatch(out.reply!.text, /99/);
        assert.match(out.reply!.text, /won't guess[\s\S]*one thing at a time/);
        assert.doesNotMatch(out.reply!.text, /ask again in a different way/);
    });

    it('a repair is tried at most once, and a model error during it never breaks the turn', async () => {
        const model = new ScriptedModel(['You have 99 open tickets.', new Error('provider down')]);
        const out = await runTurn(turnDeps(new FakeBrainData(), model), turnInput('how many tickets do i have'));
        assert.equal(out.outcome, 'answer');
        assert.equal(model.calls.length, 2);
        assert.ok(out.trace.hops.some(h => /repair: provider down/.test(h.error)));
    });

    it('the note names at most six parts and never more than 40 characters of each', () => {
        const note = repairNote(['1', '2', '3', '4', '5', '6', '7', 'x'.repeat(100)]);
        assert.equal((note.match(/"/g) ?? []).length, 12);
    });
});
