/**
 * Ticket sorting, Phase 0 numbers (owner 2026-11-19). Pure helpers only: no database, no model.
 * Run: npx tsx --test tests/ticketing/sort-learning-stats.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibration, contradictions, repeatMistakes, similarity, wordsOf, type Judgement } from '@/backend/lib/ticketing/sortLearningStats';

test('words: filler words, numbers and masked bits are left out; Hinglish words stay', () => {
    assert.deepEqual([...wordsOf('Please, the AC is not cooling on 3rd floor [phone]')].sort(), ['3rd', 'ac', 'cooling', 'floor']);
    assert.deepEqual([...wordsOf('washroom tap se paani beh raha hai 123')].sort(), ['beh', 'paani', 'tap', 'washroom']);
    assert.equal(wordsOf('').size, 0);
});

test('similarity: same words 1, nothing shared 0, partly shared in between', () => {
    assert.equal(similarity('AC not cooling', 'ac NOT cooling!!'), 1);
    assert.equal(similarity('AC not cooling', 'tap leaking'), 0);
    const s = similarity('AC not cooling cabin 4', 'AC not cooling meeting room');
    assert.ok(s > 0.2 && s < 0.6, String(s));
    assert.equal(similarity('', 'tap'), 0);
});

test('calibration: said vs really right per band, and the dangerous "wrong but High"', () => {
    const items = [
        ...Array.from({ length: 10 }, (_, i) => ({ confidence: 92, right: i < 7 })), // said 92, right 70%
        ...Array.from({ length: 4 }, (_, i) => ({ confidence: 65, right: i < 2 })),  // said 65, right 50%
    ];
    const c = calibration(items, 85);
    const high = c.bands.find(b => b.band === '90-94%')!;
    assert.deepEqual([high.tickets, high.saidAvg, high.actuallyRight, high.gap], [10, 92, 70, 22]);
    const mid = c.bands.find(b => b.band === '60-69%')!;
    assert.deepEqual([mid.tickets, mid.actuallyRight, mid.gap], [4, 50, 15]);
    assert.equal(c.accuracy, 64);
    assert.equal(c.wrongButHigh, 3);
    assert.equal(c.toReview, 4);
    assert.equal(c.averageGap, Math.round((22 * 10 + 15 * 4) / 14));
    assert.equal(calibration([]).accuracy, null);
});

const j = (at: string, text: string, verdict: 'right' | 'wrong', chosen: string | null, right: string | null, org = 'o1'): Judgement => ({ org, at, text, verdict, chosen, right });

test('repeat mistakes: found only for a similar earlier correction to the same category, same organisation', () => {
    const all = [
        j('2026-11-01', 'AC water dripping in cabin 4', 'wrong', 'water_leakage', 'ac_breakdown'),
        j('2026-11-02', 'lift stuck at ground floor', 'wrong', 'other', 'lift'),
        j('2026-11-05', 'AC water dripping cabin 4 again', 'wrong', 'water_leakage', 'ac_breakdown'),   // repeat
        j('2026-11-06', 'AC water dripping in cabin 4', 'wrong', 'water_leakage', 'ac_breakdown', 'o2'), // other org: not a repeat
        j('2026-11-07', 'AC water dripping in cabin 4', 'wrong', 'other', 'painting'),                 // other answer: not a repeat
    ];
    const r = repeatMistakes(all, 30);
    assert.equal(r.length, 1);
    assert.equal(r[0].right, 'ac_breakdown');
    assert.equal(r[0].wasShown, true);
    // With only 1 correction shown, the older similar one (Nov 1) had dropped out behind the lift one.
    assert.equal(repeatMistakes(all, 1)[0].wasShown, false);
});

test('contradictions: near-identical tickets with different confirmed answers', () => {
    const all = [
        j('2026-11-01', 'water dripping from ceiling near pantry', 'wrong', 'ac_breakdown', 'water_leakage'),
        j('2026-11-02', 'water dripping from ceiling near pantry', 'right', 'ac_breakdown', null),
        j('2026-11-03', 'water dripping from ceiling near pantry', 'wrong', 'other', 'water_leakage', 'o2'),
    ];
    const c = contradictions(all);
    assert.equal(c.length, 1);
    assert.deepEqual([c[0].aCode, c[0].bCode].sort(), ['ac_breakdown', 'water_leakage']);
});
