/**
 * Brain → Review → Tickets (owner 2026-11-15). An in-memory fake database only: nothing real is read or written, no
 * model is called, nobody is assigned and no message is sent.
 * Run: npx tsx --test tests/ticketing/sort-review.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hideMentions, judgeTicketSort, keepExample, ticketReviewView, ticketText, undoTicketJudgement, type Reassign } from '@/backend/lib/ticketing/sortReview';
import { confidenceLabel, confidenceWord } from '@/backend/lib/ticketing/confidenceWord';
import { userPrompt, type CategoryOption } from '@/backend/lib/ticketing/aiClassifier';

type Row = Record<string, unknown>;

/** A tiny query builder over arrays: the calls sortReview.ts makes, nothing more. */
function fakeDb(tables: Record<string, Row[]>, opts: { missing?: string[]; failUpdate?: string; beforeUpdate?: (table: string) => void } = {}) {
    const writes: Array<{ table: string; op: string; row: Row }> = [];
    const match = (r: Row, expr: string): boolean => {
        // "a.eq.v,and(b.eq.w,c.lt.n)": any of the comma parts; and(...) needs all of its parts
        const parts: string[] = [];
        let depth = 0, cur = '';
        for (const ch of expr) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
        parts.push(cur);
        return parts.some(p => {
            if (p.startsWith('and(')) return p.slice(4, -1).split(',').every(q => match(r, q));
            const [col, op, val] = p.split('.');
            if (op === 'eq') return String(r[col]) === val;
            if (op === 'lt') return typeof r[col] === 'number' && (r[col] as number) < Number(val);
            throw new Error(`fake: ${op}`);
        });
    };
    const from = (table: string) => {
        const filters: Array<(r: Row) => boolean> = [];
        let head = false, limitN = Infinity, mode: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
        let payload: Row = {};
        const rows = () => (tables[table] ??= []);
        const result = () => {
            if (opts.missing?.includes(table)) return { data: null, error: { code: '42P01', message: 'missing' }, count: null };
            if (mode === 'insert') {
                if (table === 'ticket_sort_reviews' && rows().some(r => r.ticket_id === payload.ticket_id)) return { data: null, error: { code: '23505', message: 'dup' } };
                const row = { id: `id-${rows().length + 1}`, created_at: new Date().toISOString(), ...payload };
                rows().push(row); writes.push({ table, op: 'insert', row });
                return { data: row, error: null };
            }
            if (mode === 'upsert') {
                // onConflict ticket_id: replace the row with the same ticket, else add one
                const had = rows().find(r => r.ticket_id === payload.ticket_id);
                const row = had ? Object.assign(had, payload) : { id: `00000000-0000-4000-9000-${String(rows().length + 1).padStart(12, '0')}`, created_at: new Date().toISOString(), ...payload };
                if (!had) rows().push(row);
                writes.push({ table, op: 'upsert', row });
                return { data: row, error: null };
            }
            if (mode === 'update') opts.beforeUpdate?.(table);
            if (mode === 'update' && opts.failUpdate === table) return { data: null, error: { code: 'XX000', message: 'update failed' } };
            const hit = rows().filter(r => filters.every(f => f(r)));
            if (mode === 'delete') { tables[table] = rows().filter(r => !hit.includes(r)); writes.push({ table, op: 'delete', row: {} }); return { data: null, error: null }; }
            if (mode === 'update') { for (const r of hit) Object.assign(r, payload); writes.push({ table, op: 'update', row: payload }); return { data: hit, error: null }; }
            return { data: head ? null : hit.slice(0, limitN), error: null, count: hit.length };
        };
        const q: Record<string, unknown> = {
            select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; },
            insert: (row: Row) => { mode = 'insert'; payload = row; return q; },
            update: (row: Row) => { mode = 'update'; payload = row; return q; },
            upsert: (row: Row) => { mode = 'upsert'; payload = row; return q; },
            is: (c: string, v: unknown) => { filters.push(r => (r[c] ?? null) === v); return q; },
            delete: () => { mode = 'delete'; return q; },
            eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return q; },
            gte: (c: string, v: string) => { filters.push(r => String(r[c]) >= v); return q; },
            in: (c: string, vs: unknown[]) => { filters.push(r => vs.includes(r[c])); return q; },
            or: (expr: string) => { filters.push(r => match(r, expr)); return q; },
            order: () => q,
            limit: (n: number) => { limitN = n; return q; },
            maybeSingle: async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
            single: async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
            then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
        };
        return q;
    };
    return { db: { from } as unknown as SupabaseClient, writes, tables };
}

const ORG = 'org-1', OTHER_ORG = 'org-2', PROP = 'prop-1';
const TID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const recent = new Date().toISOString();

function world() {
    return {
        tickets: [
            { id: TID(1), organization_id: ORG, property_id: PROP, ticket_number: 'T-1', title: 'MCP needs to be fixed', description: 'call @Anil Jena on 9876543210', created_at: recent, status: 'assigned', priority: 'high', confidence_score: 52, classification_source: 'llm', llm_reasoning: 'probably the fire alarm call point', risk_flag: 'Fire risk', issue_code: 'fire_alarm', skill_group_code: 'vendor', category_id: 'cat-fire', category: { code: 'fire_alarm', name: 'Fire Alarm' }, skill_group: { code: 'vendor' }, property: { name: 'SS Plaza' }, raised_by: 'user-secret' },
            { id: TID(2), organization_id: ORG, property_id: PROP, ticket_number: 'T-2', title: 'AC not cooling', description: '', created_at: recent, status: 'open', priority: 'high', confidence_score: 95, classification_source: 'llm', issue_code: 'ac_breakdown', skill_group_code: 'technical', category: { code: 'ac_breakdown', name: 'AC Breakdown' } },
            { id: TID(3), organization_id: ORG, property_id: PROP, ticket_number: 'T-3', title: 'workstation dusting', description: '', created_at: recent, status: 'closed', priority: 'low', confidence_score: 100, classification_source: 'rule', issue_code: 'desk_alignment', skill_group_code: 'soft_services', category: { code: 'desk_alignment', name: 'Desk Alignment' } },
            { id: TID(4), organization_id: OTHER_ORG, property_id: 'prop-9', ticket_number: 'X-1', title: 'other org ticket', created_at: recent, status: 'open', confidence_score: 40, classification_source: 'llm' },
            { id: TID(5), organization_id: ORG, property_id: PROP, ticket_number: 'T-5', title: 'already changed by hand', created_at: recent, status: 'open', confidence_score: 100, classification_source: 'manual' },
        ],
        issue_categories: [
            { id: 'cat-fire', code: 'fire_alarm', name: 'Fire Alarm', priority: 'critical', is_active: true, property_id: null, skill_group_id: 'sg-vendor', skill_group: { code: 'vendor' } },
            { id: 'cat-ac', code: 'ac_breakdown', name: 'AC Breakdown', priority: 'high', is_active: true, property_id: null, skill_group_id: 'sg-tech', skill_group: { code: 'technical' } },
            { id: 'cat-power', code: 'power_outage', name: 'Power Outage', priority: 'urgent', is_active: true, property_id: null, skill_group_id: 'sg-tech', skill_group: { code: 'technical' } },
            { id: 'cat-clean', code: 'cleaning_required', name: 'Cleaning Required', priority: 'low', is_active: true, property_id: null, skill_group_id: 'sg-soft', skill_group: { code: 'soft_services' } },
            { id: 'cat-desk', code: 'desk_alignment', name: 'Desk Alignment', priority: 'low', is_active: true, property_id: null, skill_group_id: 'sg-soft', skill_group: { code: 'soft_services' } },
            { id: 'cat-elsewhere', code: 'only_elsewhere', name: 'Elsewhere', priority: 'low', is_active: true, property_id: 'prop-9', skill_group_id: null, skill_group: null },
        ],
        skill_groups: [{ id: 'sg-tech', code: 'technical' }],
        ticket_sort_reviews: [] as Row[],
        ticket_activity_log: [] as Row[],
    };
}

const noReassign: Reassign = async () => { throw new Error('should not be called'); };

test('the confidence words: "72% (Medium)", High from 85, Low below 60', () => {
    assert.equal(confidenceLabel(72), '72% (Medium)');
    assert.deepEqual([confidenceWord(85), confidenceWord(84), confidenceWord(60), confidenceWord(59)], ['High', 'Medium', 'Medium', 'Low']);
});

test('the queue: the AI below High and the keyword rules, this organisation only, never the person', async () => {
    const { db } = fakeDb(world());
    const v = await ticketReviewView(db, ORG);
    assert.deepEqual(v.queue.map(q => q.number).sort(), ['T-1', 'T-3'], 'not the High one, not the hand-sorted one, not another organisation');
    const t1 = v.queue.find(q => q.number === 'T-1')!;
    assert.equal(t1.sortedBy, 'ai');
    assert.equal(t1.confidence, 52);
    assert.equal(t1.confidenceWord, 'Low');
    assert.equal(t1.canMove, true);
    assert.ok(!t1.text.includes('Anil') && !t1.text.includes('9876543210'), t1.text);
    assert.ok(!JSON.stringify(v).includes('user-secret'), 'who raised it is never sent');
    const t3 = v.queue.find(q => q.number === 'T-3')!;
    assert.deepEqual([t3.sortedBy, t3.confidence, t3.canMove], ['rules', null, false]);
    assert.ok(v.choices[t1.choicesKey].some(c => c.code === 'power_outage'));
    assert.ok(!v.choices[t1.choicesKey].some(c => c.code === 'only_elsewhere'), 'another property\'s category is not offered');
    assert.equal(v.accuracy.sorted, 4);
    assert.equal(v.accuracy.resorted, 1);
    assert.equal(v.accuracy.percent, 75);
});

test('the review table not applied yet: the queue still reads, and judging says so', async () => {
    const { db } = fakeDb(world(), { missing: ['ticket_sort_reviews'] });
    const v = await ticketReviewView(db, ORG);
    assert.equal(v.tableMissing, true);
    assert.equal(v.queue.length, 2);
    const r = await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(1), verdict: 'right' }, noReassign);
    assert.deepEqual(r, { ok: false, status: 503, error: 'Ticket review needs migration 20261115000003 to be applied.' });
});

test('right: recorded once; the ticket is not touched', async () => {
    const { db, writes, tables } = fakeDb(world());
    const r = await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(1), verdict: 'right' }, noReassign);
    assert.deepEqual(r, { ok: true, message: 'Marked right.' });
    assert.equal(writes.filter(w => w.table === 'tickets').length, 0);
    const review = tables.ticket_sort_reviews[0];
    assert.deepEqual([review.verdict, review.sorted_by, review.chosen_code, review.chosen_confidence, review.reviewed_by], ['right', 'ai', 'fire_alarm', 52, 'tech-1']);
    assert.ok(!String(review.ticket_text).includes('Anil'), 'the kept words have no name');
    const again = await judgeTicketSort(db, ORG, 'tech-2', { ticketId: TID(1), verdict: 'right' }, noReassign);
    assert.equal(again.ok, false);
    const v = await ticketReviewView(db, ORG);
    assert.ok(!v.queue.some(q => q.number === 'T-1'), 'a judged ticket leaves the queue');
});

test('wrong on an open ticket: recorded, the ticket moves to the right category and team, and is assigned again', async () => {
    const { db, tables } = fakeDb(world());
    const moved: unknown[] = [];
    const r = await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(1), verdict: 'wrong', code: 'power_outage' }, async t => { moved.push(t); });
    assert.equal(r.ok, true);
    const t = tables.tickets.find(x => x.id === TID(1))!;
    assert.deepEqual([t.category_id, t.skill_group_id, t.issue_code, t.skill_group_code, t.classification_source], ['cat-power', 'sg-tech', 'power_outage', 'technical', 'manual']);
    assert.deepEqual(moved, [{ id: TID(1), property_id: PROP, skill_group_code: 'technical', title: 'MCP needs to be fixed', description: 'call @Anil Jena on 9876543210' }], 'the assignment (server only) gets the words, so an @-mention still picks that person');
    const review = tables.ticket_sort_reviews[0];
    assert.deepEqual([review.verdict, review.right_code, review.right_team, review.ticket_moved], ['wrong', 'power_outage', 'technical', true]);
    assert.equal(tables.ticket_activity_log[0].action, 'classification_override');
});

test('wrong on a closed ticket: recorded so the AI learns, the ticket is not moved', async () => {
    const { db, tables } = fakeDb(world());
    const r = await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(3), verdict: 'wrong', code: 'cleaning_required' }, noReassign);
    assert.equal(r.ok, true);
    assert.match((r as { message: string }).message, /not moved because it is no longer open/);
    assert.equal(tables.tickets.find(x => x.id === TID(3))!.issue_code, 'desk_alignment');
    assert.equal(tables.ticket_sort_reviews[0].ticket_moved, false);
});

test('refused: another organisation\'s ticket, a category the property does not have, the same category, no category, a hand-sorted ticket', async () => {
    const { db } = fakeDb(world());
    assert.equal((await judgeTicketSort(db, ORG, 't', { ticketId: TID(4), verdict: 'right' }, noReassign) as { status: number }).status, 404);
    assert.equal((await judgeTicketSort(db, ORG, 't', { ticketId: 'not-a-uuid', verdict: 'right' }, noReassign) as { status: number }).status, 404);
    assert.match((await judgeTicketSort(db, ORG, 't', { ticketId: TID(1), verdict: 'wrong', code: 'only_elsewhere' }, noReassign) as { error: string }).error, /not available/);
    assert.match((await judgeTicketSort(db, ORG, 't', { ticketId: TID(1), verdict: 'wrong', code: 'fire_alarm' }, noReassign) as { error: string }).error, /already has/);
    assert.match((await judgeTicketSort(db, ORG, 't', { ticketId: TID(1), verdict: 'wrong' }, noReassign) as { error: string }).error, /Choose the right category/);
    assert.match((await judgeTicketSort(db, ORG, 't', { ticketId: TID(5), verdict: 'right' }, noReassign) as { error: string }).error, /by hand/);
    assert.match((await judgeTicketSort(db, ORG, 't', { ticketId: TID(1), verdict: 'maybe' }, noReassign) as { error: string }).error, /right or wrong/);
});

test('the AI is shown past corrections, but only for categories on the list', () => {
    const options: CategoryOption[] = [{ code: 'power_outage', name: 'Power Outage', team: 'technical', priority: 'urgent' }];
    const u = userPrompt('MCP tripped again', options, [
        { text: 'MCP needs to be fixed', code: 'power_outage', team: 'technical' },
        { text: 'something else', code: 'removed_category', team: null },
    ]);
    assert.match(u, /Past corrections/);
    assert.match(u, /"MCP needs to be fixed" → power_outage/);
    assert.ok(!u.includes('removed_category'));
    assert.ok(!userPrompt('x', options, []).includes('Past corrections'));
});

test('ticket words: an @-mention of a person is hidden, in its usual forms, and the problem words stay', () => {
    assert.equal(ticketText({ title: '@Anil Jena kindly check the carpet', description: '' }), '@[person] kindly check the carpet');
    assert.equal(hideMentions('@anil jena please'), '@[person] jena please', 'a lower-case surname cannot be told from a word');
    assert.equal(hideMentions('@Anil Kumar Jena AC leaking'), '@[person] AC leaking', 'up to two more name words');
    assert.equal(hideMentions('@ANIL JENA lift stuck'), '@[person] lift stuck');
    assert.equal(hideMentions('@Ravi AC leaking'), '@[person] AC leaking', 'AC is kept');
});

test('a ticket started by someone after it was read is not moved', async () => {
    const w = world();
    const { db, tables } = fakeDb(w, { beforeUpdate: table => { if (table === 'tickets') w.tickets[0].status = 'in_progress'; } });
    const r = await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(1), verdict: 'wrong', code: 'power_outage' }, noReassign);
    assert.equal(r.ok, true);
    assert.match((r as { message: string }).message, /not moved/);
    assert.equal(tables.tickets[0].issue_code, 'fire_alarm');
    assert.equal(tables.ticket_sort_reviews[0].ticket_moved, false);
});

test('a move that fails takes the judgement back, so it can be made again', async () => {
    const { db, tables } = fakeDb(world(), { failUpdate: 'tickets' });
    const r = await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(1), verdict: 'wrong', code: 'power_outage' }, noReassign);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /nothing was saved/);
    assert.equal(tables.ticket_sort_reviews.length, 0);
});

test('an assignment that fails after the move is said', async () => {
    const { db } = fakeDb(world());
    const r = await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(1), verdict: 'wrong', code: 'power_outage' }, async () => { throw new Error('no staff'); });
    assert.match((r as { message: string }).message, /could not be assigned again/);
});

// ── 2026-11-19: learning from judgements ────────────────────────────────────────────────────────────────────────────

test('every judgement becomes a learning example, right ones too, with the masked words and the right answer', async () => {
    const { db, tables } = fakeDb(world());
    await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(1), verdict: 'wrong', code: 'power_outage' }, async () => {});
    await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(3), verdict: 'right' }, noReassign);
    const ex = tables.ticket_sort_examples;
    assert.equal(ex.length, 2);
    const wrong = ex.find(e => e.ticket_id === TID(1))!;
    assert.deepEqual([wrong.organization_id, wrong.property_id, wrong.code, wrong.team, wrong.source], [ORG, PROP, 'power_outage', 'technical', 'judged_wrong']);
    assert.ok(!String(wrong.ticket_text).includes('Anil') && !String(wrong.ticket_text).includes('9876543210'), String(wrong.ticket_text));
    const right = ex.find(e => e.ticket_id === TID(3))!;
    assert.deepEqual([right.code, right.team, right.source], ['desk_alignment', 'soft_services', 'judged_right']);
});

test('undo: a moved ticket goes back to its first category and team, is assigned again, and the AI stops learning from it', async () => {
    const { db, tables } = fakeDb(world());
    await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(1), verdict: 'wrong', code: 'power_outage' }, async () => {});
    const again: unknown[] = [];
    const r = await undoTicketJudgement(db, ORG, 'tech-1', { ticketId: TID(1) }, async t => { again.push(t); });
    assert.equal(r.ok, true);
    assert.match((r as { message: string }).message, /went back/);
    const t = tables.tickets.find(x => x.id === TID(1))!;
    assert.deepEqual([t.category_id, t.issue_code, t.skill_group_code, t.classification_source], ['cat-fire', 'fire_alarm', 'vendor', 'llm']);
    assert.equal((again[0] as { skill_group_code: string }).skill_group_code, 'vendor');
    assert.equal(tables.ticket_sort_reviews.length, 0);
    assert.equal(tables.ticket_sort_examples.length, 0);
    const v = await ticketReviewView(db, ORG);
    assert.ok(v.queue.some(q => q.number === 'T-1'), 'back in the queue');
});

test('undo: refused after 7 days, for another organisation, and for a judgement that does not exist', async () => {
    const { db, tables } = fakeDb(world());
    await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(3), verdict: 'right' }, noReassign);
    assert.equal((await undoTicketJudgement(db, OTHER_ORG, 't', { ticketId: TID(3) }, noReassign) as { status: number }).status, 404);
    assert.equal((await undoTicketJudgement(db, ORG, 't', { ticketId: TID(2) }, noReassign) as { status: number }).status, 404);
    tables.ticket_sort_reviews[0].created_at = new Date(Date.now() - 8 * 86_400_000).toISOString();
    assert.match((await undoTicketJudgement(db, ORG, 't', { ticketId: TID(3) }, noReassign) as { error: string }).error, /within 7 days/);
    assert.equal(tables.ticket_sort_reviews.length, 1);
});

test('undo: a moved ticket someone has started since is left where it is, and that is said', async () => {
    const { db, tables } = fakeDb(world());
    await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(1), verdict: 'wrong', code: 'power_outage' }, async () => {});
    tables.tickets.find(x => x.id === TID(1))!.status = 'in_progress';
    const r = await undoTicketJudgement(db, ORG, 'tech-1', { ticketId: TID(1) }, noReassign);
    assert.match((r as { message: string }).message, /not moved back/);
    assert.equal(tables.tickets.find(x => x.id === TID(1))!.issue_code, 'power_outage');
    assert.equal(tables.ticket_sort_examples.length, 0);
});

test('examples that disagree: listed on the screen, and keeping one retires the other (this organisation only)', async () => {
    const w = world() as ReturnType<typeof world> & { ticket_sort_examples: Row[] };
    const ex = (n: number, org: string, text: string, code: string): Row => ({ id: `00000000-0000-4000-a000-00000000000${n}`, organization_id: org, ticket_id: null, ticket_text: text, code, team: null, source: 'judged_wrong', created_at: recent, retired_at: null });
    w.ticket_sort_examples = [ex(1, ORG, 'water dripping from ceiling near pantry', 'water_leakage'), ex(2, ORG, 'water dripping from ceiling near pantry', 'ac_breakdown'), ex(3, OTHER_ORG, 'x y z', 'fire_alarm')];
    const { db, tables } = fakeDb(w);
    const v = await ticketReviewView(db, ORG);
    assert.equal(v.learning?.conflicts.length, 1);
    assert.equal(v.learning?.examples, 2);
    assert.equal((await keepExample(db, ORG, { keep: String(w.ticket_sort_examples[0].id), drop: String(w.ticket_sort_examples[2].id) }) as { status: number }).status, 404, 'not another organisation\'s');
    const r = await keepExample(db, ORG, { keep: String(w.ticket_sort_examples[0].id), drop: String(w.ticket_sort_examples[1].id) });
    assert.equal(r.ok, true);
    assert.ok(tables.ticket_sort_examples[1].retired_at, 'the other one is retired');
    assert.equal(tables.ticket_sort_examples[0].retired_at, null);
    assert.equal((await ticketReviewView(db, ORG)).learning?.conflicts.length, 0);
});

test('the screen shows each ticket\'s similar tickets and why, from its trace', async () => {
    const w = world() as ReturnType<typeof world> & { ticket_sort_traces: Row[] };
    w.ticket_sort_traces = [{ ticket_id: TID(1), organization_id: ORG, mode: 'shadow', method: 'ai', search: 'words', old_code: 'fire_alarm', old_confidence: 52, new_code: 'power_outage', model_confidence: 70, new_confidence: 81, why: 'The AI said 70%.', neighbours: [{ id: 'e1', text: 'MCB tripping', code: 'power_outage', source: 'judged_wrong', strength: 0.6, by: 'words' }], created_at: recent }];
    const { db } = fakeDb(w);
    const v = await ticketReviewView(db, ORG);
    const t1 = v.queue.find(q => q.number === 'T-1')!;
    assert.equal(t1.learning?.newCode, 'power_outage');
    assert.equal(t1.learning?.neighbours[0].text, 'MCB tripping');
    assert.equal(v.queue.find(q => q.number === 'T-3')!.learning, null);
    assert.equal(v.learning?.watch?.differed, 1);
    assert.equal(v.learning?.weeks.length, 8);
});

test('a judged ticket keeps what the AI read in its photo with its learning example', async () => {
    const w = world() as ReturnType<typeof world> & { ticket_photo_checks: Row[] };
    w.ticket_photo_checks = [{ ticket_id: TID(1), status: 'read', description: 'Wall switch board with a tripped MCB' }];
    const { db, tables } = fakeDb(w);
    await judgeTicketSort(db, ORG, 'tech-1', { ticketId: TID(1), verdict: 'wrong', code: 'power_outage' }, async () => {});
    assert.match(String(tables.ticket_sort_examples[0].ticket_text), /\(photo: Wall switch board with a tripped MCB\)$/);
});
