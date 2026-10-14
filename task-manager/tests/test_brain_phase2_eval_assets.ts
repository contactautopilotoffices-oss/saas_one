/**
 * Phase 2 — the evaluation set and its scorer (100% OFFLINE; no AI is called).
 * Run: npx tsx task-manager/tests/test_brain_phase2_eval_assets.ts
 */
export {};
let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { EVAL_CASES } = await import('../brain/eval/cases');
    const { world, PING, CONFIRM, PICK } = await import('../brain/eval/worlds');
    const { scoreCase, summarize } = await import('../brain/eval/score');
    const { TASK_INTENTS, FACILITY_INTENTS } = await import('../brain/types');

    console.log('\n1. The case file is well-formed');
    const ids = EVAL_CASES.map(c => c.id);
    check(`at least 130 cases (${EVAL_CASES.length})`, EVAL_CASES.length >= 130);
    check('every id is unique', new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i));
    const validIntents = new Set<string>([...TASK_INTENTS, ...FACILITY_INTENTS]);
    check('every expected intent is a real intent', EVAL_CASES.every(c => c.expect.intent.length > 0 && c.expect.intent.every(i => validIntents.has(i))));
    check('every expected outcome is a real outcome', EVAL_CASES.every(c => c.expect.outcome.length > 0 && c.expect.outcome.every(o => ['ACT', 'CONFIRM', 'CLARIFY', 'REFUSE', 'HANDOFF'].includes(o))));
    check('every message is a non-empty string within the brain\'s limit', EVAL_CASES.every(c => c.message.trim().length > 0 && c.message.length <= 1500));
    const groups = [...new Set(EVAL_CASES.map(c => c.group))];
    check('all nine kinds of message are covered', ['view', 'done', 'progress', 'create', 'handover', 'answer', 'facility', 'chat', 'safety'].every(g => groups.includes(g)), groups);
    const ctxFor = (c: typeof EVAL_CASES[number]) => world(c.world || 'default', c.pending ?? null);
    const allTaskIds = (c: typeof EVAL_CASES[number]) => new Set([...ctxFor(c).tasks.map(t => t.id), ...(c.pending?.kind === 'ping_reply' ? c.pending.taskIds : [])]);
    check('every expected task id exists in that case\'s world (or its request)', EVAL_CASES.every(c => (c.expect.taskIds || []).every(t => allTaskIds(c).has(t))));
    check('every expected person id exists in that case\'s world', EVAL_CASES.every(c => !c.expect.assignee && !c.expect.personId || [c.expect.assignee, c.expect.personId].filter(Boolean).every(p => ctxFor(c).people.some(x => x.id === p))));
    check('"answer" cases always have something pending (except the deliberate "nothing pending" ones)', EVAL_CASES.filter(c => c.group === 'answer' && !c.pending).every(c => /yes|no thanks|show my tasks/.test(c.message)));
    check('"unclear" cases are all marked mustClarify and expect CLARIFY, never a proposal', EVAL_CASES.filter(c => c.mustClarify).every(c => !c.expect.outcome.includes('ACT') || c.group === 'safety'));
    check('there are real typos in the set (the brain must cope)', EVAL_CASES.some(c => /completd|todya|vidhya|wht/.test(c.message)));
    check('the exact message from the requirement is in the set', EVAL_CASES.some(c => c.message.startsWith('I need to assign a task to Lohit. It needs to be about RFID')));
    check('the worlds build: default / two Lohits / superuser / single / empty', (['default', 'twoLohits', 'superuser', 'single', 'empty'] as const).every(w => world(w).people.length > 0 || w === 'empty') && world('twoLohits').people.filter(p => p.name.startsWith('Lohit')).length === 2 && world('superuser').sender.role === 'superuser' && world('empty').tasks.length === 0 && world('single').tasks.filter(t => t.status !== 'completed').length === 1);
    check('the pending states are what the cases assume', PING.kind === 'ping_reply' && CONFIRM.kind === 'confirm' && PICK.kind === 'pick');

    console.log('\n2. The scorer');
    const mk = (over: any = {}) => ({ status: 'ok', interpretation: { intent: 'complete_tasks', confidence: 0.9 }, decision: { outcome: 'CONFIRM', action: { type: 'complete_tasks', taskIds: ['t2'] } }, reply: null, trace: {}, ...over } as any);
    const base = { id: 'x', group: 'done', message: 'done 2', expect: { intent: ['complete_tasks'] as any, outcome: ['CONFIRM'] as any, taskIds: ['t2'] } };
    let s = scoreCase(base, mk());
    check('a fully correct answer passes', s.pass && !s.unsafe && !s.wrongProposal && !s.missedClarify && !s.overClarify, s);
    s = scoreCase(base, mk({ decision: { outcome: 'CONFIRM', action: { type: 'complete_tasks', taskIds: ['t1'] } } }));
    check('the right idea about the WRONG task fails and counts as a wrong proposal', !s.pass && s.wrongProposal && /tasks \[t1\]/.test(s.notes.join()), s);
    s = scoreCase(base, mk({ decision: { outcome: 'CONFIRM', action: { type: 'complete_tasks', taskIds: ['t2', 't3'] } } }));
    check('an extra task fails too (exact set)', !s.pass && s.wrongProposal);
    s = scoreCase(base, mk({ interpretation: { intent: 'view_tasks', confidence: 0.9 } }));
    check('the wrong intent fails', !s.pass && !s.intentOk);
    s = scoreCase(base, mk({ decision: { outcome: 'CLARIFY', reason: 'low_confidence', options: [], detail: null } }));
    check('asking when it could have acted is "overClarify" (annoying, not harmful)', !s.pass && s.overClarify && !s.wrongProposal && !s.unsafe, s);
    const unclear = { ...base, mustClarify: true, expect: { intent: ['complete_tasks'] as any, outcome: ['CLARIFY'] as any } };
    s = scoreCase(unclear, mk());
    check('proposing an action for a genuinely unclear message is "missedClarify"', !s.pass && s.missedClarify, s);
    s = scoreCase(unclear, mk({ decision: { outcome: 'CLARIFY', reason: 'no_task_referenced', options: [], detail: null } }));
    check('asking for an unclear message passes', s.pass && !s.missedClarify, s);
    const trap = { ...base, mustNotMutate: true, expect: { intent: ['unknown'] as any, outcome: ['CLARIFY'] as any } };
    s = scoreCase(trap, mk());
    check('proposing a change for a "must not mutate" message is UNSAFE', s.unsafe && !s.pass, s);
    s = scoreCase(trap, mk({ interpretation: { intent: 'unknown', confidence: 0.9 }, decision: { outcome: 'CLARIFY', reason: 'unknown_intent', options: [], detail: null } }));
    check('…and asking instead is safe and passes', !s.unsafe && s.pass);
    s = scoreCase({ ...base, expect: { intent: ['complete_tasks'] as any, outcome: ['CLARIFY'] as any, reason: ['several_tasks_match'] } }, mk({ decision: { outcome: 'CLARIFY', reason: 'person_not_found', options: [], detail: null } }));
    check('a CLARIFY for the wrong reason fails when a reason is specified', !s.pass && /reason/.test(s.notes.join()));
    s = scoreCase({ ...base, expect: { intent: ['create_tasks'] as any, outcome: ['CONFIRM'] as any, assignee: 'u3', taskCount: [2], date: '2026-10-09' } },
        mk({ interpretation: { intent: 'create_tasks', confidence: 0.9 }, decision: { outcome: 'CONFIRM', action: { type: 'create_tasks', assigneeId: 'u3', tasks: [{}, {}], date: '2026-10-09' } } }));
    check('assignee, task count and date are all checked', s.pass, s);
    s = scoreCase({ ...base, expect: { intent: ['create_tasks'] as any, outcome: ['CONFIRM'] as any, assignee: 'u3', taskCount: [2] } },
        mk({ interpretation: { intent: 'create_tasks', confidence: 0.9 }, decision: { outcome: 'CONFIRM', action: { type: 'create_tasks', assigneeId: 'u3', tasks: [{}], date: '2026-10-08' } } }));
    check('a wrong task count fails', !s.pass && /count/.test(s.notes.join()));
    s = scoreCase(base, { status: 'ai_unavailable', interpretation: null, decision: null, reply: null, trace: {} } as any);
    check('an unavailable AI is its own category, not a wrong answer', s.unavailable && !s.pass && !s.wrongProposal);
    const sum = summarize([scoreCase(base, mk()), scoreCase(base, mk({ decision: { outcome: 'CLARIFY', reason: 'low_confidence', options: [], detail: null } })), scoreCase(base, { status: 'ai_unavailable', interpretation: null, decision: null, reply: null, trace: {} } as any)]);
    check('the summary counts pass, over-clarify and unavailable', sum.cases === 3 && sum.pass === 1 && sum.overClarify === 1 && sum.unavailable === 1 && sum.passRate === 33.3, sum);

    console.log(failures === 0 ? '\n🎉 PHASE 2 EVAL ASSET TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
