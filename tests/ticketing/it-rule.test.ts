/**
 * The IT team rule (owner 2026-11-20). No network: categories, IT members and the model are passed in.
 * Run: npx tsx --test tests/ticketing/it-rule.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taggedItMember, itRuleFor, withoutIt, itCategories, defaultItCategory } from '@/backend/lib/ticketing/itRule';
import { resolveClassification, resolveImportRows } from '@/backend/lib/ticketing/resolver';
import { categoryOptionsFrom, type CategoryOption } from '@/backend/lib/ticketing/aiClassifier';

const IT_SUPPORT: CategoryOption = { code: 'it_support', name: 'IT support', team: 'it', priority: 'medium' };
const LAPTOP: CategoryOption = { code: 'laptop', name: 'Laptop issue', team: 'it', priority: 'high' };
const WIFI: CategoryOption = { code: 'wifi_down', name: 'Wi-Fi Down', team: 'technical', priority: 'high' };
const LIGHT: CategoryOption = { code: 'lighting', name: 'Lighting', team: 'technical', priority: 'medium' };
const RAHUL = [{ user_id: 'u-rahul', full_name: 'rahul ramjiyawan' }];

/** A fake model that records which categories it was offered and answers with `answer(offered)`. */
function fakeModel(answer: (offered: string[]) => string) {
    const calls: string[][] = [];
    const llm = {
        async complete(req: { model: string; user: string }) {
            const offered = (req.user.match(/^- ([a-z_]+):/gm) ?? []).map(x => x.slice(2, -1));
            calls.push(offered);
            const category = answer(offered);
            return { text: JSON.stringify({ category, team: 'technical', priority: 'high', risk: null, reason: `picked ${category}`, vague: false, confidence: 90 }), tokensIn: 1, tokensOut: 1 };
        },
    };
    return { calls, deps: { llm, chain: ['m1'] } as never };
}

test('the word "IT" alone never sends a ticket to IT (owner 2026-11-20: "SBI Dhruva IT Store cleaning")', async () => {
    const cats = [IT_SUPPORT, WIFI, LIGHT];
    for (const text of ['7th Floor- SBI Dhruva IT Store cleaning required.', 'Laptop not connecting, please ask IT', 'IT team: printer jammed', 'need IT support for the projector']) {
        assert.equal(await itRuleFor(text, cats, null, RAHUL), null, text);
    }
});

test('tagging an IT-role member by full name, in any case or spacing', () => {
    assert.equal(taggedItMember('@Rahul Ramjiyawan please check the printer', RAHUL)?.user_id, 'u-rahul');
    assert.equal(taggedItMember('printer jammed @rahul  ramjiyawan', RAHUL)?.user_id, 'u-rahul');
    assert.equal(taggedItMember('@Rahul please check', RAHUL), null);
    assert.equal(taggedItMember('Rahul Ramjiyawan please check', RAHUL), null);
});

test('IT categories are the ones whose team is IT; the rule does nothing without one', async () => {
    assert.deepEqual(itCategories([WIFI, IT_SUPPORT, LIGHT, LAPTOP]).map(c => c.code), ['it_support', 'laptop']);
    assert.deepEqual(withoutIt([WIFI, IT_SUPPORT, LIGHT, LAPTOP]).map(c => c.code), ['wifi_down', 'lighting']);
    assert.equal(defaultItCategory([LAPTOP, IT_SUPPORT])?.code, 'it_support');
    assert.equal(defaultItCategory([LAPTOP])?.code, 'laptop');
    assert.equal(await itRuleFor('@Rahul Ramjiyawan printer', [WIFI, LIGHT], null, RAHUL), null);
    assert.equal((await itRuleFor('@Rahul Ramjiyawan printer', [WIFI, IT_SUPPORT], null, RAHUL))?.fallback.code, 'it_support');
    assert.equal(await itRuleFor('@Priti Kamble printer', [WIFI, IT_SUPPORT], null, RAHUL), null);
});

test('a category on the IT team is read with team IT from the database rows', () => {
    const opts = categoryOptionsFrom([
        { code: 'it_support', name: 'IT support', priority: 'medium', is_active: true, property_id: 'p1', skill_group: { code: 'it' } },
        { code: 'wifi_down', name: 'Wi-Fi Down', priority: 'high', is_active: true, property_id: 'p1', skill_group: { code: 'technical' } },
    ], 'p1');
    assert.equal(opts.find(o => o.code === 'it_support')?.team, 'it');
});

test('one IT category: an IT ticket goes to the IT team without asking the AI', async () => {
    const m = fakeModel(() => 'wifi_down');
    const cats = [IT_SUPPORT, WIFI, LIGHT];
    const b = await resolveClassification('@Rahul Ramjiyawan the laptop is slow', { categories: cats, itMembers: RAHUL, rules: null, corrections: [], deps: m.deps });
    assert.equal(b.issue_code, 'it_support');
    assert.equal(b.skill_group, 'it');
    assert.match(String(b.llm_reasoning), /tags someone from the IT team/);
    assert.equal(m.calls.length, 0);
});

test('several IT categories: the AI chooses among the IT ones only, and the team stays IT', async () => {
    const m = fakeModel(offered => (offered.includes('laptop') ? 'laptop' : 'wifi_down'));
    const r = await resolveClassification('@Rahul Ramjiyawan my laptop will not start', { categories: [IT_SUPPORT, LAPTOP, WIFI, LIGHT], itMembers: RAHUL, rules: null, corrections: [], deps: m.deps });
    assert.deepEqual(m.calls[0].filter(c => c !== 'other').sort(), ['it_support', 'laptop']);
    assert.equal(r.issue_code, 'laptop');
    assert.equal(r.skill_group, 'it');
});

test('if the AI cannot choose an IT category, the starter one is used', async () => {
    const m = fakeModel(() => 'made_up');
    const r = await resolveClassification('@Rahul Ramjiyawan my laptop will not start', { categories: [IT_SUPPORT, LAPTOP, WIFI], itMembers: RAHUL, rules: null, corrections: [], deps: m.deps });
    assert.equal(r.issue_code, 'it_support');
    assert.equal(r.skill_group, 'it');
});

test('an ordinary ticket, even one saying "IT", is never offered the IT categories', async () => {
    const m = fakeModel(() => 'wifi_down');
    const r = await resolveClassification('7th Floor- SBI Dhruva IT Store wifi is down', { categories: [IT_SUPPORT, LAPTOP, WIFI, LIGHT], itMembers: RAHUL, rules: null, corrections: [], deps: m.deps });
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].some(c => c === 'it_support' || c === 'laptop'), false);
    assert.equal(r.issue_code, 'wifi_down');
    assert.equal(r.skill_group, 'technical');
});

test('bulk import: IT rows go to the IT team, the other rows never get an IT category', async () => {
    const m = fakeModel(() => 'wifi_down');
    const out = await resolveImportRows(['wifi down in cabin 3', '@Rahul Ramjiyawan please set up the printer'], { categories: [IT_SUPPORT, WIFI, LIGHT], itMembers: RAHUL, rules: null, corrections: [], deps: m.deps });
    assert.equal(out[0].issue_code, 'wifi_down');
    assert.equal(out[1].issue_code, 'it_support');
    assert.equal(out[1].skill_group, 'it');
    assert.equal(m.calls.flat().includes('it_support'), false);
});
