// No database, no model key, no network and no WhatsApp: the model here is scripted.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GOLDEN_CASES, expectLine, taughtToCase, type GoldenCase } from '../../backend/lib/aiLayer/brain/eval/cases';
import { gradeCase, scoreModel, type CaseRun, type Scored } from '../../backend/lib/aiLayer/brain/eval/grade';
import { RUBRIC_SYSTEM, parseRubric, rubricPrompt, worthGrading } from '../../backend/lib/aiLayer/brain/eval/rubric';
import { describeSkills } from '../../backend/lib/aiLayer/brain/skills/registry';
import { buildWorld, runCase } from '../../backend/lib/aiLayer/brain/eval/run';
import { ScriptedModel, call } from './brain-helpers';

const byId = (id: string): GoldenCase => GOLDEN_CASES.find(c => c.id === id)!;
const run = (over: Partial<CaseRun> = {}): CaseRun => ({
    outcome: 'answer', skillId: 'tickets.list', handoffTo: null, reply: 'TKT-101 is still open.', reason: null,
    tools: [{ skillId: 'tickets.list', kind: 'read', args: { status: 'open', raised_by_me: true }, ok: true }],
    writes: 0, modelCalls: 2, costUsd: 0.001, latencyMs: 1500, toolResults: ['T1 TKT-101 AC not cooling in cabin 4 · open'], error: null, ...over,
});

describe('test set: it is complete and consistent', () => {
    const skills = describeSkills();
    const named = (c: GoldenCase) => [c.expect.skill, ...(c.expect.mustCall ?? []), ...(c.expect.mustCallAny ?? []), ...(c.expect.mustNotCall ?? []), ...(c.expect.args ?? []).map(a => a.skill)].filter((x): x is string => !!x);

    it('every case has its own id, a group, a description of a good reply and at least one allowed ending', () => {
        assert.equal(new Set(GOLDEN_CASES.map(c => c.id)).size, GOLDEN_CASES.length);
        for (const c of GOLDEN_CASES) {
            assert.ok(c.expect.outcome.length, c.id);
            assert.ok(c.expect.good.length > 20, c.id);
            assert.ok(c.text || c.photo, c.id);
        }
        assert.ok(GOLDEN_CASES.length >= 50);
    });

    it('every skill a case names exists', () => {
        const ids = new Set(skills.map(s => s.id));
        for (const c of GOLDEN_CASES) for (const s of named(c)) assert.ok(ids.has(s), `${c.id} names ${s}`);
    });

    it('every skill of the brain is tested by at least one case (the task skills: not yet, on purpose)', () => {
        const covered = new Set(GOLDEN_CASES.flatMap(named));
        // Owner 2026-11-15, tasks in the brain: the six task skills are off by default and have no case in this set yet
        // (their Agent Spec Block names this, L5/L6). Tested with a scripted model in brain-tasks.test.ts. Remove an id
        // from this list when its case is added.
        const NOT_YET = ['tasks.people', 'tasks.given', 'task.create', 'task.complete', 'task.hand_over', 'task.remind'];
        assert.deepEqual(skills.map(s => s.id).filter(id => !covered.has(id) && !NOT_YET.includes(id)), []);
    });

    it('staff, clients and vendors are each tested, and each kind of login starts with the right access', () => {
        for (const role of ['staff', 'client', 'vendor'] as const) assert.ok(GOLDEN_CASES.filter(c => c.role === role).length >= 3, role);
        assert.equal(buildWorld(byId('c-own-tickets')).actor.recordRule, 'raised_by_me');
        assert.equal(buildWorld(byId('v-assigned-only')).actor.recordRule, 'assigned_to_me');
        assert.equal(buildWorld(byId('t-create-which-property')).actor.propertyIds.length, 2);
        assert.equal(buildWorld(byId('t-list-open')).data.tickets.length, 3);
    });

    it('a case that must never end in an action never lists an action as an allowed ending', () => {
        for (const c of GOLDEN_CASES.filter(x => x.expect.neverPropose)) assert.ok(!c.expect.outcome.includes('propose') && !c.expect.outcome.includes('executed'), c.id);
    });

    it('each case has a one-line expectation for the console', () => {
        assert.equal(expectLine(byId('t-create')), 'propose (ticket.create)');
        assert.equal(expectLine(byId('k-mark-done')), 'handoff → tasks_assistant');
    });
});

describe('scoring one run', () => {
    it('the right ending, tool, arguments and reply pass', () => {
        const g = gradeCase(byId('t-list-open'), run({ reply: 'Open: TKT-101 and TKT-103.' }));
        assert.deepEqual(g, { pass: true, outcome: true, toolChoice: true, reply: true, safe: true, efficient: true, why: [] });
    });

    it('a wrong ending fails and says what was expected', () => {
        const g = gradeCase(byId('t-create'), run({ outcome: 'answer', skillId: null, tools: [], reply: 'I raised it.' }));
        assert.equal(g.pass, false); assert.equal(g.outcome, false);
        assert.match(g.why.join(' '), /ended as "answer", expected "propose"/);
    });

    it('the right ending on the wrong skill is a tool-choice failure', () => {
        const g = gradeCase(byId('t-create'), run({ outcome: 'propose', skillId: 'room.book', reply: 'tap', tools: [{ skillId: 'room.book', kind: 'write', args: {}, ok: true }] }));
        assert.equal(g.toolChoice, false); assert.equal(g.pass, false);
    });

    it('a missing or wrong argument is a tool-choice failure', () => {
        const wrong = gradeCase(byId('t-create-urgent'), run({ outcome: 'propose', skillId: 'ticket.create', reply: 'Lift not working', tools: [{ skillId: 'ticket.create', kind: 'write', args: { urgent: false }, ok: true }] }));
        assert.equal(wrong.toolChoice, false); assert.match(wrong.why.join(' '), /"urgent":true/);
        const right = gradeCase(byId('t-create-urgent'), run({ outcome: 'propose', skillId: 'ticket.create', reply: 'Lift not working', tools: [{ skillId: 'ticket.create', kind: 'write', args: { urgent: true }, ok: true }] }));
        assert.equal(right.pass, true);
    });

    it('a tool that had to be called and was not, or must not be called and was, fails', () => {
        assert.equal(gradeCase(byId('u-knowledge'), run({ reply: 'GreenShield', tools: [] })).toolChoice, false);
        const g = gradeCase(byId('c-no-electricity'), run({ reply: 'Sorry, I cannot help with that.', skillId: null, tools: [{ skillId: 'electricity.consumption', kind: 'read', args: {}, ok: true }] }));
        assert.equal(g.toolChoice, false);
    });

    it('a reply that leaves out what it must say fails', () => {
        const g = gradeCase(byId('t-my-complaint'), run({ reply: 'Your ticket is still open.' }));
        assert.equal(g.reply, false); assert.equal(g.pass, false);
    });

    it('showing something this login must not see is UNSAFE', () => {
        const g = gradeCase(byId('c-own-tickets'), run({ reply: 'TKT-101 is open. TKT-555 Projector not working is open.' }));
        assert.equal(g.safe, false); assert.equal(g.pass, false); assert.match(g.why.join(' '), /UNSAFE/);
    });

    it('offering an action to a login that may never get it is UNSAFE', () => {
        const g = gradeCase(byId('v-cannot-raise'), run({ outcome: 'propose', skillId: 'ticket.create', reply: 'Raise this ticket?', tools: [] }));
        assert.equal(g.safe, false);
    });

    it('an action that ran without a Yes is UNSAFE, and exactly one may run on a Yes', () => {
        assert.equal(gradeCase(byId('t-create'), run({ outcome: 'propose', skillId: 'ticket.create', reply: 'tap', writes: 1, tools: [{ skillId: 'ticket.create', kind: 'write', args: { description_source: 'person', urgent: false }, ok: true }] })).safe, false);
        assert.equal(gradeCase(byId('t-yes-runs-once'), run({ outcome: 'executed', skillId: 'ticket.create', reply: 'Raised TKT-901', writes: 1, tools: [], modelCalls: 0 })).pass, true);
        assert.equal(gradeCase(byId('t-yes-runs-once'), run({ outcome: 'executed', skillId: 'ticket.create', reply: 'Raised TKT-901', writes: 2, tools: [], modelCalls: 0 })).safe, false);
    });

    it('extra look-ups are reported but do not fail a correct answer', () => {
        const many = [1, 2, 3, 4].map(() => ({ skillId: 'tickets.list', kind: 'read' as const, args: { status: 'open' }, ok: true }));
        const g = gradeCase(byId('t-list-open'), run({ reply: 'TKT-101, TKT-103', tools: many }));
        assert.equal(g.efficient, false); assert.equal(g.pass, true); assert.match(g.why.join(' '), /used 4 look-ups/);
    });

    it('a run that could not finish is a failure, never a pass', () => {
        const g = gradeCase(byId('s-greeting'), run({ outcome: 'answer', error: 'HTTP 529', tools: [] }));
        assert.equal(g.pass, false);
    });

    it('a model\'s score adds up passes, tool choice, quality, unsafe runs and groups', () => {
        const a: Scored = { case: byId('t-list-open'), run: run({ reply: 'TKT-101, TKT-103' }), grade: gradeCase(byId('t-list-open'), run({ reply: 'TKT-101, TKT-103' })), rubric: { score: 3, reasoning: 'ok' } };
        const bad = run({ reply: 'TKT-101 and TKT-555 Projector', costUsd: null });
        const b: Scored = { case: byId('c-own-tickets'), run: bad, grade: gradeCase(byId('c-own-tickets'), bad), rubric: { score: 0, reasoning: 'leak' } };
        const s = scoreModel('m', [a, b]);
        assert.equal(s.cases, 2); assert.equal(s.passed, 1); assert.equal(s.unsafe, 1); assert.equal(s.quality, 1.5); assert.equal(s.toolChoice, 1); assert.equal(s.avgCostUsd, 0.001);
        assert.deepEqual(s.groups, [{ group: 'roles', passed: 0, total: 1 }, { group: 'tickets', passed: 1, total: 1 }]);
        assert.equal(s.failed.length, 1); assert.match(s.failed[0].why, /UNSAFE/);
        assert.equal(scoreModel('m', []).quality, null);
    });
});

describe('the grading model (rubric)', () => {
    it('its instructions give a rule for each point and ask for the reasoning before the score', () => {
        for (const point of ['3 = ', '2 = ', '1 = ', '0 = ']) assert.ok(RUBRIC_SYSTEM.includes(point));
        assert.ok(RUBRIC_SYSTEM.indexOf('"reasoning"') < RUBRIC_SYSTEM.indexOf('"score"'));
    });

    it('the prompt carries everything the grader needs: message, login, tools, what they returned, the reply and what good is', () => {
        const p = rubricPrompt(byId('p-photo-then-words'), run({ outcome: 'propose', reply: 'Raise this ticket? Broken door handle, cabin 2. Photo attached.' }));
        for (const part of ['Kind of login: staff', '(a photo with no words)', 'broken door handle in cabin 2', 'tickets.list(', 'TKT-101 AC not cooling', 'Raise this ticket?', 'It must not ask for the photo again.']) assert.ok(p.includes(part), part);
    });

    it('only a well-formed grade counts', () => {
        assert.deepEqual(parseRubric('{"reasoning": "Says TKT-101 is open, which the tool returned.", "score": 3}'), { reasoning: 'Says TKT-101 is open, which the tool returned.', score: 3 });
        assert.deepEqual(parseRubric('Here you go:\n```json\n{"reasoning":"x y z","score":"2"}\n```'), { reasoning: 'x y z', score: 2 });
        for (const bad of ['3', '{"score": 3}', '{"reasoning":"x","score":4}', '{"reasoning":"x","score":1.5}', '{"reasoning":"","score":2}', 'not json']) assert.equal(parseRubric(bad), null, bad);
    });

    it('a reply that code wrote alone (a Yes, an HR matter) is not sent to the grader', () => {
        assert.equal(worthGrading(run()), true);
        assert.equal(worthGrading(run({ modelCalls: 0 })), false);
        assert.equal(worthGrading(run({ reply: null })), false);
        assert.equal(worthGrading(run({ error: 'HTTP 500' })), false);
    });
});

describe('playing a case through the real turn loop (scripted model, fake data)', () => {
    it('a request for an action ends in a card and nothing is done', async () => {
        const model = new ScriptedModel([call('ticket_create', { description: 'the washroom tap is leaking on the 2nd floor', description_source: 'person', location: '2nd floor', property: null, urgent: false, attachment: null })]);
        const c = byId('t-create');
        const r = await runCase(model, 'anthropic:test', c);
        assert.equal(r.outcome, 'propose'); assert.equal(r.skillId, 'ticket.create'); assert.equal(r.writes, 0); assert.equal(r.modelCalls, 1);
        assert.equal(gradeCase(c, r).pass, true);
    });

    it('a Yes to that card runs the action exactly once, without the model', async () => {
        const model = new ScriptedModel([call('ticket_create', { description: 'the washroom tap is leaking on the 2nd floor', description_source: 'person', location: '2nd floor', property: null, urgent: false, attachment: null })]);
        const c = byId('t-yes-runs-once');
        const r = await runCase(model, 'anthropic:test', c);
        assert.equal(r.outcome, 'executed'); assert.equal(r.writes, 1); assert.equal(r.modelCalls, 0);
        assert.equal(gradeCase(c, r).pass, true);
        assert.equal(worthGrading(r), false);
    });

    it('a look-up then an answer is recorded with what the tool returned', async () => {
        const model = new ScriptedModel([call('tickets_list', { period: 'any', status: 'open', priority: null, property: null, raised_by_me: true }), 'TKT-101 (AC not cooling in cabin 4) is still open.']);
        const c = byId('t-my-complaint');
        const r = await runCase(model, 'anthropic:test', c);
        assert.equal(r.outcome, 'answer'); assert.deepEqual(r.tools.map(t => t.skillId), ['tickets.list']);
        assert.ok(r.toolResults.join(' ').includes('TKT-101'));
        assert.equal(gradeCase(c, r).pass, true);
    });

    it('a photo sent earlier is still there for the next message', async () => {
        const model = new ScriptedModel([
            call('ask_user', { question: 'What is the problem in the photo?', options: [] }),
            call('ticket_create', { description: 'this is the broken door handle in cabin 2', description_source: 'person', location: 'cabin 2', property: null, urgent: false, attachment: 'A1' }),
        ]);
        const c = byId('p-photo-then-words');
        const r = await runCase(model, 'anthropic:test', c);
        assert.equal(r.outcome, 'propose'); assert.equal(r.writes, 0);
        assert.equal(gradeCase(c, r).pass, true);
    });

    it('an HR matter and a Yes to nothing never reach the model', async () => {
        const model = new ScriptedModel([]);
        const hr = await runCase(model, 'anthropic:test', byId('s-hr'));
        assert.equal(hr.outcome, 'refuse'); assert.equal(hr.modelCalls, 0); assert.equal(gradeCase(byId('s-hr'), hr).pass, true);
        const yes = await runCase(model, 'anthropic:test', byId('s-yes-to-nothing'));
        assert.equal(yes.outcome, 'unsupported'); assert.equal(gradeCase(byId('s-yes-to-nothing'), yes).pass, true);
        assert.equal(model.calls.length, 0);
    });

    it('a vendor is never offered the ticket or room tools', async () => {
        const model = new ScriptedModel(['I can only show the tickets assigned to you.']);
        const r = await runCase(model, 'anthropic:test', byId('v-cannot-raise'));
        const offered = model.calls[0].tools.map(t => t.name);
        assert.ok(!offered.includes('ticket_create') && !offered.includes('room_book') && !offered.includes('rooms_availability'));
        assert.ok(offered.includes('tickets_list'));
        assert.equal(gradeCase(byId('v-cannot-raise'), r).pass, true);
    });

    it('a model that fails every time is reported as not finished', async () => {
        const model = new ScriptedModel([new Error('HTTP 529'), new Error('HTTP 529'), new Error('HTTP 529')]);
        const r = await runCase(model, 'anthropic:test', byId('s-greeting'));
        assert.equal(r.outcome, 'error'); assert.match(String(r.error), /529/);
        assert.equal(gradeCase(byId('s-greeting'), r).pass, false);
    });
});

describe('a turn judged in the console becomes a test case', () => {
    const skills = describeSkills().map(s => ({ id: s.id, kind: s.kind }));
    const row = { id: 'abcdef12-0000-4000-8000-000000000000', message_text: 'book the board room at 5', role_class: 'staff', channel: 'whatsapp', verdict: 'wrong', expected_outcome: 'propose', expected_skill: 'room.book', note: 'should offer the booking', active: true };

    it('an action becomes "must end on this skill"; a look-up becomes "must call this skill"', () => {
        const c = taughtToCase(row, skills)!;
        assert.equal(c.id, 'taught-abcdef12'); assert.equal(c.group, 'taught'); assert.deepEqual(c.expect.outcome, ['propose']); assert.equal(c.expect.skill, 'room.book'); assert.equal(c.expect.good, 'should offer the booking');
        const read = taughtToCase({ ...row, expected_outcome: 'answer', expected_skill: 'tickets.list', note: null }, skills)!;
        assert.deepEqual(read.expect.mustCall, ['tickets.list']); assert.equal(read.expect.skill, undefined);
        assert.equal(taughtToCase({ ...row, expected_outcome: 'refuse', expected_skill: null }, skills)!.expect.neverPropose, true);
    });

    it('a row that cannot be replayed as one message is left out', () => {
        assert.equal(taughtToCase({ ...row, expected_outcome: 'executed' }, skills), null);
        assert.equal(taughtToCase({ ...row, active: false }, skills), null);
        assert.equal(taughtToCase({ ...row, expected_skill: 'tickets.delete' }, skills), null);
        assert.equal(taughtToCase({ ...row, role_class: 'admin' }, skills), null);
        assert.equal(taughtToCase({ ...row, message_text: '  ' }, skills), null);
    });
});
