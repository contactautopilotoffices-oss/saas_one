/**
 * Ticket sorting that learns (owner 2026-11-19). A fake model and handed-in examples only: no network, no database.
 * Run: npx tsx --test tests/ticketing/sort-learning.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BrainLlm, LlmRequest } from '@/task-manager/brain/llm';
import type { CategoryOption } from '@/backend/lib/ticketing/aiClassifier';
import { calibrated, calibrationFrom, measuredConfidence, repeatShortcut, similarByWords, meaningStrength, mergeNeighbours, type Example } from '@/backend/lib/ticketing/sortLearning';
import { trackRecord } from '@/backend/lib/ticketing/sortLearningStore';
import { watchComparison, weekRows } from '@/backend/lib/ticketing/sortLearningView';
import { resolveClassification } from '@/backend/lib/ticketing/resolver';
import { brainSettingsSchema } from '@/backend/lib/aiLayer/brain/config';

assert.equal(process.env.CATEGORIZATION_WEBHOOK_URL ?? '', '', 'run the tests without CATEGORIZATION_WEBHOOK_URL');

const OPTIONS: CategoryOption[] = [
    { code: 'ac_breakdown', name: 'AC Breakdown', team: 'technical', priority: 'high' },
    { code: 'water_leakage', name: 'Water Leakage', team: 'plumbing', priority: 'high' },
    { code: 'cleaning_required', name: 'Cleaning Required', team: 'soft_services', priority: 'low' },
];
const ALLOWED = new Set(OPTIONS.map(o => o.code));
let n = 0;
const ex = (text: string, code: string, source: Example['source'] = 'judged_wrong', extra: Partial<Example> = {}): Example =>
    ({ id: `ex-${++n}`, ticketId: `t-${n}`, propertyId: null, text, code, team: null, source, at: `2026-11-${String(10 + (n % 9)).padStart(2, '0')}T10:00:00Z`, ...extra });

function fakeLlm(answer: (req: LlmRequest) => string | Error): BrainLlm & { calls: LlmRequest[] } {
    const calls: LlmRequest[] = [];
    return { calls, async complete(req) { calls.push(req); const a = answer(req); if (a instanceof Error) throw a; return { text: a, tokensIn: 10, tokensOut: 5 }; } } as BrainLlm & { calls: LlmRequest[] };
}
const json = (code: string, confidence: number) => JSON.stringify({ category: code, team: 'technical', priority: 'medium', risk: null, reason: 'r', vague: false, confidence });

// ── finding similar tickets ─────────────────────────────────────────────────────────────────────────────────────────

test('similar by words: strongest first, only categories the property can use, never the ticket itself', () => {
    const own = ex('AC water dripping in cabin 4', 'ac_breakdown', 'judged_wrong', { ticketId: 'me' });
    const list = [ex('AC water dripping cabin 4', 'ac_breakdown'), ex('cabin 4 needs cleaning', 'cleaning_required'), ex('AC water dripping cabin 4', 'fire_alarm'), own, ex('lift stuck', 'water_leakage')];
    const got = similarByWords('AC water dripping in cabin 4', list, ALLOWED, { ticketId: 'me' });
    assert.equal(got[0].example.code, 'ac_breakdown');
    assert.ok(!got.some(g => g.example.code === 'fire_alarm'), 'a category this property does not have is never shown');
    assert.ok(!got.some(g => g.example.ticketId === 'me'));
    assert.ok(!got.some(g => g.example.text === 'lift stuck'), 'unrelated tickets are not shown');
    assert.deepEqual(similarByWords('', list, ALLOWED), []);
});

test('meaning and words on one scale; merged one per example, the stronger kept', () => {
    assert.equal(meaningStrength(0.6), 0);
    assert.ok(Math.abs(meaningStrength(0.8) - 0.5) < 1e-9);
    assert.ok(Math.abs(meaningStrength(0.92) - 0.8) < 1e-9);
    const e = ex('a b c', 'ac_breakdown');
    const merged = mergeNeighbours([{ example: e, strength: 0.3, by: 'words' }], [{ example: e, strength: 0.7, by: 'meaning' }]);
    assert.deepEqual(merged.map(m => [m.strength, m.by]), [[0.7, 'meaning']]);
});

// ── the repeat shortcut ─────────────────────────────────────────────────────────────────────────────────────────────

test('repeat shortcut: two near-identical tickets sorted the same way, nothing disagreeing → that category, no AI', () => {
    const text = 'washroom 3rd floor dustbin full please clean';
    const nb = similarByWords(text, [ex('washroom 3rd floor dustbin full please clean', 'cleaning_required'), ex('washroom 3rd floor dustbin full clean', 'cleaning_required', 'judged_right')], ALLOWED);
    const r = repeatShortcut(text, nb, OPTIONS);
    assert.ok(r);
    assert.deepEqual([r!.verdict.code, r!.verdict.team, r!.verdict.priority, r!.verdict.confidence], ['cleaning_required', 'soft_services', 'low', 92]);
    assert.match(r!.verdict.reason, /Same as 2 earlier tickets/);
});

test('repeat shortcut: not with one example, not when a similar one disagrees, never for danger words, never for a category not on the list', () => {
    const one = similarByWords('washroom dustbin full clean', [ex('washroom dustbin full clean', 'cleaning_required')], ALLOWED);
    assert.equal(repeatShortcut('washroom dustbin full clean', one, OPTIONS), null);
    const split = similarByWords('washroom dustbin full clean', [ex('washroom dustbin full clean', 'cleaning_required'), ex('washroom dustbin full clean', 'cleaning_required'), ex('washroom dustbin full clean now', 'water_leakage')], ALLOWED);
    assert.equal(repeatShortcut('washroom dustbin full clean', split, OPTIONS), null);
    const smoke = similarByWords('smoke from AC unit cabin', [ex('smoke from AC unit cabin', 'ac_breakdown'), ex('smoke from AC unit cabin', 'ac_breakdown')], ALLOWED);
    assert.equal(repeatShortcut('smoke from AC unit cabin', smoke, OPTIONS), null, 'danger words always go to the AI');
    const hindi = similarByWords('AC mein aag lagi', [ex('AC mein aag lagi', 'ac_breakdown'), ex('AC mein aag lagi', 'ac_breakdown')], ALLOWED);
    assert.equal(repeatShortcut('AC mein aag lagi', hindi, OPTIONS), null, 'Hindi danger words too');
    const gone = similarByWords('lift door noise', [ex('lift door noise', 'ac_breakdown'), ex('lift door noise', 'ac_breakdown')], ALLOWED);
    assert.equal(repeatShortcut('lift door noise', gone, OPTIONS.filter(o => o.code !== 'ac_breakdown')), null);
});

// ── measured confidence ─────────────────────────────────────────────────────────────────────────────────────────────

test('calibrated: the AI\'s 90% that was right 74% of the time drops towards 74%; no record keeps its own number', () => {
    const history = [...Array.from({ length: 74 }, () => ({ confidence: 92, right: true })), ...Array.from({ length: 26 }, () => ({ confidence: 92, right: false }))];
    const t = calibrationFrom(history);
    const c = calibrated(92, t);
    assert.ok(c.value > 74 && c.value < 76, String(c.value));
    assert.equal(calibrated(65, t).value, 65);
});

test('measured confidence: similar tickets that agree raise it, ones that disagree lower it, and the reason says so', () => {
    const empty = calibrationFrom([]);
    const agree = similarByWords('AC not cooling cabin 4', [ex('AC not cooling cabin 4', 'ac_breakdown'), ex('AC not cooling in cabin 4', 'ac_breakdown'), ex('AC cooling cabin 4 issue', 'ac_breakdown')], ALLOWED);
    const up = measuredConfidence(70, 'ac_breakdown', agree, empty);
    assert.ok(up.confidence > 85, String(up.confidence));
    assert.match(up.why, /3 of 3 similar past tickets went to the same category/);
    const down = measuredConfidence(90, 'water_leakage', agree, empty, c => (c === 'ac_breakdown' ? 'AC Breakdown' : c));
    assert.ok(down.confidence < 50, String(down.confidence));
    assert.match(down.why, /0 of 3 .*others: AC Breakdown/);
    const none = measuredConfidence(77, 'ac_breakdown', [], empty);
    assert.equal(none.confidence, 77);
    assert.match(none.why, /No similar past ticket/);
});

// ── the track record ───────────────────────────────────────────────────────────────────────────────────────────────

test('track record: judged, re-sorted by hand, or left alone a week counts; a new untouched ticket does not', () => {
    const now = Date.parse('2026-11-19T12:00:00Z');
    const old = '2026-11-01T10:00:00Z', fresh = '2026-11-18T10:00:00Z';
    const traces = [
        { ticket_id: 'a', method: 'ai', new_code: 'ac_breakdown', model_confidence: 90 },   // judged wrong → water_leakage
        { ticket_id: 'b', method: 'ai', new_code: 'ac_breakdown', model_confidence: 80 },   // re-sorted by hand to water
        { ticket_id: 'c', method: 'ai', new_code: 'ac_breakdown', model_confidence: 95 },   // left alone 18 days: right
        { ticket_id: 'd', method: 'ai', new_code: 'ac_breakdown', model_confidence: 60 },   // 1 day old: unknown yet
        { ticket_id: 'e', method: 'shortcut', new_code: 'ac_breakdown', model_confidence: null },
    ];
    const reviews = [
        { ticket_id: 'a', verdict: 'wrong', right_code: 'water_leakage', chosen_code: 'ac_breakdown', sorted_by: 'ai', chosen_confidence: 70 },
        { ticket_id: 'z', verdict: 'right', chosen_code: 'cleaning_required', sorted_by: 'ai', chosen_confidence: 66 },  // before learning
    ];
    const tickets = new Map([
        ['b', { issue_code: 'water_leakage', classification_source: 'manual', created_at: fresh }],
        ['c', { issue_code: 'ac_breakdown', classification_source: 'llm', created_at: old }],
        ['d', { issue_code: 'ac_breakdown', classification_source: 'llm', created_at: fresh }],
    ]);
    const r = trackRecord({ reviews, traces, tickets, now });
    assert.deepEqual(r, [{ confidence: 90, right: false }, { confidence: 80, right: false }, { confidence: 95, right: true }, { confidence: 66, right: true }]);
});

// ── the three settings, end to end through the resolver ─────────────────────────────────────────────────────────────

const EXAMPLES = [ex('AC water dripping cabin 4', 'ac_breakdown'), ex('AC water dripping near cabin 4 desk', 'ac_breakdown', 'judged_right')];
const common = (llm: BrainLlm, mode: 'off' | 'shadow' | 'live', examples = EXAMPLES) => ({
    organizationId: 'org-1', propertyId: null, categories: OPTIONS, corrections: [{ text: 'older correction', code: 'water_leakage', team: 'plumbing' as const }],
    deps: { llm, chain: ['m1'] }, learning: { setting: { mode, meaning: false }, examples, calibration: calibrationFrom([]) },
});

test('off: exactly as before (newest corrections in the prompt, the AI\'s own rating saved, no trace)', async () => {
    const llm = fakeLlm(() => json('ac_breakdown', 77));
    const r = await resolveClassification('AC water dripping cabin 4 again', common(llm, 'off'));
    assert.equal(llm.calls.length, 1);
    assert.match(llm.calls[0].user, /Past corrections/);
    assert.ok(!llm.calls[0].user.includes('Similar past tickets'));
    assert.deepEqual([r.issue_code, r.confidenceScore, r.learningTrace], ['ac_breakdown', 77, undefined]);
});

test('watch only: the old way decides; the learning way is recorded next to it', async () => {
    const llm = fakeLlm(req => (req.user.includes('Similar past tickets') ? json('ac_breakdown', 80) : json('water_leakage', 60)));
    const r = await resolveClassification('AC water dripping cabin 4 again today', common(llm, 'shadow'));
    assert.equal(llm.calls.length, 2, 'both ways ran');
    assert.deepEqual([r.issue_code, r.confidenceScore], ['water_leakage', 60], 'the ticket is sorted the old way');
    const t = r.learningTrace!;
    assert.deepEqual([t.mode, t.method, t.oldCode, t.oldConfidence, t.newCode, t.modelConfidence], ['shadow', 'ai', 'water_leakage', 60, 'ac_breakdown', 80]);
    assert.ok(t.newConfidence! > 80, 'two agreeing similar tickets raise it');
    assert.ok(t.neighbours.length >= 1 && t.why);
});

test('on: similar examples shown (marked corrected / confirmed), the measured confidence is saved', async () => {
    const llm = fakeLlm(() => json('ac_breakdown', 70));
    const r = await resolveClassification('AC water dripping cabin 4 again today', common(llm, 'live'));
    assert.equal(llm.calls.length, 1);
    const u = llm.calls[0].user;
    assert.match(u, /Similar past tickets of this organisation/);
    assert.match(u, /the team corrected it to this/);
    assert.match(u, /the team confirmed it/);
    assert.ok(!u.includes('older correction'), 'the newest-30 list is not used');
    assert.equal(r.issue_code, 'ac_breakdown');
    assert.ok(r.confidenceScore! > 70, String(r.confidenceScore));
    assert.deepEqual([r.learningTrace?.mode, r.learningTrace?.modelConfidence], ['live', 70]);
});

test('on: a repeat is sorted without calling the AI', async () => {
    const llm = fakeLlm(() => new Error('must not be called'));
    const ex2 = [ex('pantry dustbin full please clean', 'cleaning_required'), ex('pantry dustbin full please clean', 'cleaning_required', 'override')];
    const r = await resolveClassification('pantry dustbin full please clean', common(llm, 'live', ex2));
    assert.equal(llm.calls.length, 0);
    assert.deepEqual([r.issue_code, r.skill_group, r.decisionSource, r.learningTrace?.method, r.llmResult?.model], ['cleaning_required', 'soft_services', 'llm', 'shortcut', 'learned-examples']);
});

test('on, but no examples yet: sorted exactly the old way, no trace', async () => {
    const llm = fakeLlm(() => json('ac_breakdown', 77));
    const r = await resolveClassification('AC not cooling', common(llm, 'live', []));
    assert.match(llm.calls[0].user, /Past corrections/);
    assert.deepEqual([r.confidenceScore, r.learningTrace], [77, undefined]);
});

test('on, but the learning way fails: the old way sorts it, and the failure is recorded', async () => {
    const llm = fakeLlm(req => (req.user.includes('Similar past tickets') ? new Error('down') : json('water_leakage', 65)));
    const r = await resolveClassification('AC water dripping cabin 4 again today', common(llm, 'live'));
    assert.deepEqual([r.issue_code, r.confidenceScore, r.learningTrace?.method, r.learningTrace?.oldCode], ['water_leakage', 65, 'failed', 'water_leakage']);
});

test('on, everything fails: the keyword rules still sort the ticket', async () => {
    const llm = fakeLlm(() => new Error('down'));
    const r = await resolveClassification('AC water dripping cabin 4 again today', common(llm, 'live'));
    assert.equal(r.decisionSource, 'rule');
});

test('the setting: off by default, and an old saved row without it still reads', () => {
    const d = brainSettingsSchema.parse({});
    assert.deepEqual(d.ticketLearning, { mode: 'off', meaning: false, rulesDaily: true });
    assert.equal(brainSettingsSchema.safeParse({ mode: 'live', ticketLearning: { mode: 'sometimes' } }).success, false);
});

// ── the screen's numbers ────────────────────────────────────────────────────────────────────────────────────────────

test('weeks: 8 weeks, counted by the week a ticket or judgement fell in', () => {
    const now = new Date('2026-11-19T12:00:00Z');   // a Thursday: the week starts Monday 16 Nov
    const w = weekRows(
        [{ created_at: '2026-11-17T10:00:00Z', classification_source: 'llm', confidence_score: 70 }, { created_at: '2026-11-18T10:00:00Z', classification_source: 'manual' }, { created_at: '2026-11-18T10:00:00Z', classification_source: 'llm', confidence_score: 90 }],
        [{ created_at: '2026-11-18T10:00:00Z', verdict: 'right', sorted_by: 'ai', chosen_confidence: 70 }, { created_at: '2026-11-18T11:00:00Z', verdict: 'wrong', sorted_by: 'ai', chosen_confidence: 80 }],
        now);
    assert.equal(w.length, 8);
    const last = w[7];
    assert.deepEqual([last.from, last.tickets, last.resorted, last.toReview, last.judgedRight, last.judgedWrong, last.saidAvg, last.actuallyRight], ['2026-11-16', 3, 1, 1, 1, 1, 75, 50]);
});

test('watch comparison: right answers known from judgements, overrides or a quiet week', () => {
    const now = Date.parse('2026-11-19T12:00:00Z');
    const traces = [
        { ticket_id: 'a', mode: 'shadow', method: 'ai', old_code: 'water_leakage', old_confidence: 90, new_code: 'ac_breakdown', new_confidence: 70 },
        { ticket_id: 'b', mode: 'shadow', method: 'shortcut', old_code: 'cleaning_required', old_confidence: 80, new_code: 'cleaning_required', new_confidence: 92 },
        { ticket_id: 'c', mode: 'live', method: 'ai', old_code: null, old_confidence: null, new_code: 'x', new_confidence: 50 },
    ];
    const c = watchComparison(traces, [{ ticket_id: 'a', verdict: 'wrong', right_code: 'ac_breakdown' }], new Map([['b', { issue_code: 'cleaning_required', classification_source: 'llm', created_at: '2026-11-01T00:00:00Z' }]]), now)!;
    assert.deepEqual([c.known, c.oldRight, c.newRight, c.differed, c.oldWrongButHigh, c.newWrongButHigh, c.shortcuts, c.oldToReview, c.newToReview], [2, 1, 2, 1, 1, 0, 1, 1, 1]);
    assert.equal(watchComparison([], [], new Map(), now), null);
});
