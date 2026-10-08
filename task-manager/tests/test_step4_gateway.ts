/**
 * Step 4 — natural-language front door (OFFLINE: pure rules + stubbed database/messaging; no network).
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { classifyNaturalLanguage: c, parseConfirmAnswer, matchTaskByHint } = await import('../TaskGateway');
    const kind = (t: string) => c(t).kind;

    console.log('\n1. What the front door understands');
    for (const t of ['show my tasks', "what's pending", 'what do I have today?', 'how many tasks do I have left', "how's my progress"])
        check(`ask: "${t}" → task_query`, kind(t) === 'task_query', c(t));
    for (const t of ["I've finished everything", 'all my work is done', 'mark all as done', 'I completed all tasks for today'])
        check(`finished all: "${t}"`, kind(t) === 'task_complete_all', c(t));
    const n = c('I finished task 2 and 3') as any;
    check('finished by number: "I finished task 2 and 3" → [2,3]', n.kind === 'task_complete' && n.numbers.join() === '2,3', n);
    const h = c('I finished the vendor call') as any;
    check('finished by words: "I finished the vendor call" → hint "vendor call"', h.kind === 'task_complete' && h.hint === 'vendor call', h);
    const a1 = c('give Satej a task to call vendor X') as any;
    check('assign: "give Satej a task to call vendor X"', a1.kind === 'task_assign' && a1.targetName === 'Satej' && a1.title === 'call vendor X', a1);
    const a2 = c('ask Vidya to send the quotation') as any;
    check('assign: "ask Vidya to send the quotation"', a2.kind === 'task_assign' && a2.targetName === 'Vidya' && a2.title === 'send the quotation', a2);
    const a3 = c('remind me to call the vendor') as any;
    check('own list: "remind me to call the vendor"', a3.kind === 'task_assign' && a3.targetName === 'me' && a3.title === 'call the vendor', a3);
    const a4 = c('add a task: prepare the PO') as any;
    check('own list: "add a task: prepare the PO"', a4.kind === 'task_assign' && a4.targetName === 'me' && a4.title === 'prepare the PO', a4);

    console.log('\n2. Room / ticket go to the existing bot; nothing is hijacked');
    check('"I need a meeting room tomorrow 3pm" → facility room', (c('I need a meeting room tomorrow 3pm') as any).service === 'room');
    check('"the AC on floor 2 is leaking" → facility ticket', (c('the AC on floor 2 is leaking') as any).service === 'ticket');
    check('"ask the vendor to fix it" is NOT an assignment (not a person)', kind('ask the vendor to fix it') !== 'task_assign');
    check('"I finished cleaning the pantry" stays a task (not a ticket)', kind('I finished cleaning the pantry') === 'task_complete');
    check('"yes" alone is unclear', kind('yes') === 'unclear');
    check('random chat is unclear', kind('good afternoon team lunch plans?') === 'unclear');
    check('a long message is unclear', kind('x'.repeat(400)) === 'unclear');
    check('yes/no answers', parseConfirmAnswer('Yes!') === 'yes' && parseConfirmAnswer('nope') === 'no' && parseConfirmAnswer('maybe') === null);
    check('task match: unique best match only', matchTaskByHint('vendor call', ['Review report', 'Call vendor for quote']) === 2 && matchTaskByHint('call', ['Call vendor', 'Call client']) === null);

    // ── Router with stubs ────────────────────────────────────────────────────
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskMessagingService } = await import('../TaskMessagingService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { TaskMessageRouter } = await import('../TaskMessageRouter');
    const db: any = TaskDatabaseService;

    const contexts = new Map<string, any>();
    let replies: string[] = [];
    let flagOn = true;
    let locked = false;
    let whitelisted = false;
    const tasks: any[] = [
        { id: 't1', title: 'Review report', status: 'pending' },
        { id: 't2', title: 'Call vendor for quote', status: 'pending' },
    ];
    const me = { id: 'u1', name: 'Alice Test', phone_number: '9876543210', department_id: 'dA', department_name: 'Procurement', role: 'employee', active: true };

    db.getTestingConfig = async () => ({ enabled: true, employees: whitelisted ? [{ name: 'Alice', phone: '9876543210' }] : [], nlGatewayEnabled: flagOn });
    db.getEmployeeByPhone = async () => me;
    db.getConversationContext = async (_p: string, sys: string) => contexts.get(sys) || null;
    db.setConversationContext = async (p: any) => { contexts.set(p.system, { context_type: p.contextType, context_data: p.contextData || {} }); return {}; };
    db.clearConversationContext = async (_p: string, sys?: string) => { if (sys) contexts.delete(sys); else contexts.clear(); };
    db.getDailyAssignments = async () => tasks;
    db.logAudit = async () => {};
    db.updateAssignmentStatus = async (p: any) => { const t = tasks.find(x => x.id === p.assignmentId); t.status = p.status; return t; };
    (TaskMessagingService as any).sendMessage = async (_p: string, text: string) => { replies.push(text); return true; };
    (TaskAccessService as any).check = async () => locked ? { allowed: false, reason: 'not_onboarded', message: 'locked' } : { allowed: true, reason: 'ok', message: '' };
    const reset = () => { replies = []; contexts.clear(); tasks.forEach(t => (t.status = 'pending')); };
    const say = (text: string) => TaskMessageRouter.routeInboundMessage({ phone: '9876543210', text, date: '2026-10-07' });

    console.log('\n3. In the Task Manager (switch ON, person unlocked)');
    reset();
    let r = await say('what do I have today?');
    check('asking shows the task list straight away', r.handledByTaskManager && /Review report/.test(replies[0]), replies);

    reset();
    await say('I finished the vendor call');
    check('a change asks "confirm?" first and changes nothing yet', /confirm/i.test(replies[0]) && /Call vendor/.test(replies[0]) && tasks[1].status === 'pending', replies);
    await say('yes');
    check('YES then completes exactly that task', tasks[1].status === 'completed' && tasks[0].status === 'pending' && /Marked task #2/.test(replies[1]), replies);

    reset();
    await say('I finished the vendor call');
    await say('no');
    check('NO changes nothing', tasks.every(t => t.status === 'pending') && /nothing was changed/i.test(replies[1]), replies);

    reset();
    await say("I've finished everything");
    await say('yes');
    check('"finished everything" + YES completes all', tasks.every(t => t.status === 'completed'), tasks);

    reset();
    tasks.push({ id: 't3', title: 'Call client', status: 'pending' });
    await say('I finished the call');
    check('unsure which task → asks which, changes nothing', /couldn't tell which task/i.test(replies[0]) && tasks.every(t => t.status === 'pending'), replies);
    tasks.pop();

    console.log('\n4. Facility and old sessions');
    reset();
    contexts.set('TASK_MANAGER', { context_type: 'ACTIVE_SESSION', context_data: {} });
    r = await say('my AC is leaking');
    check('a ticket message passes through to the facility bot (not handled here)', r.handledByTaskManager === false && r.system === 'FACILITY', r);
    check('...and ends the old Task Manager session', !contexts.has('TASK_MANAGER'));

    reset();
    contexts.set('TASK_MANAGER', { context_type: 'ACTIVE_SESSION', context_data: {} });
    r = await say('hmm what about lunch');
    check('unclear text in an old session asks "tasks or facility?" instead of a task-help reply', r.system === 'AMBIGUOUS' && /Manage tasks/.test(replies[0]), r);

    console.log('\n5. Old behaviour is untouched when it should be');
    reset(); flagOn = false; whitelisted = true;
    contexts.set('TASK_MANAGER', { context_type: 'ACTIVE_SESSION', context_data: {} });
    r = await say('I finished the vendor call');
    check('switch OFF: a whitelisted person in an old session is handled as before (no confirm question)', r.system === 'TASK_MANAGER' && !/confirm/i.test(replies[0]), replies);
    whitelisted = false;
    reset();
    r = await say('what do I have today?');
    check('switch OFF: the old sandbox whitelist still blocks a non-whitelisted person', r.handledByTaskManager === false, r);
    flagOn = true;
    reset();
    r = await say('what do I have today?');
    check('switch ON: the same person is no longer stopped by the sandbox (the Step 3 lock decides)', r.handledByTaskManager === true, r);

    reset(); locked = true;
    r = await say('what do I have today?');
    check('locked person: natural language is not offered (falls to facility)', r.handledByTaskManager === false, r);
    locked = false;

    console.log(failures === 0 ? '\n🎉 STEP 4 TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
