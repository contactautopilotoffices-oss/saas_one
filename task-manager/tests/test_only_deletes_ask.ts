/**
 * Owner 2026-11-21: "for these - rename, change, remind, give to someone, don't ask for a yes confirmation. just perform and
 * give an undo option" + "ask for a yes only for a Delete option. nothing else" + option A (messages to other people wait
 * 1 minute). OFFLINE: fake data and recorders; no network, no database, no message can be sent from this file.
 * Run: npx tsx task-manager/tests/test_only_deletes_ask.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    (globalThis as any).fetch = async () => { throw new Error('network must not be used'); };
    const T = await import('../brain/types');
    const F = await import('../brain/frontDoor');
    const X = await import('../brain/execute');
    const H = await import('../heldMessages');
    const { tasksDomain } = await import('../brain/tasksDomain');
    const { world } = await import('../brain/eval/worlds');

    const NOTE_TARGETS = [{ id: 'g1', title: 'Onboarding docs', ownerId: 'u2', ownerName: 'Vidya Nair', date: '2026-10-11' }];
    const REQ = [{ id: 'r1', title: 'Payroll query', fromName: 'Neeti Rao', fromDepartment: 'HR' }];
    const base = world('default');
    const ctx: any = { ...base, pending: null, recent: [], noteTargets: NOTE_TARGETS, supportRequests: REQ, tasks: base.tasks.map((t: any) => t.id === 't3' ? { ...t, locked: true } : t) };
    const interp = (intent: string, slots: any, extra: any = {}): any => ({ intent, slots: { intent, ...slots }, confidence: 0.95, language: 'en', ambiguities: [], clarifyQuestion: null, summary: 'summary', grounded: true, ...extra });
    const one = (n: number) => ({ all: false, numbers: [n], hints: [] });
    const hint = (h: string) => ({ all: false, numbers: [], hints: [h] });
    const before = { ...T.DEFAULT_CONFIRM_POLICY, confirmCompletions: false, confirmCreates: false };          // undo ON, as until now
    const now = { ...before, onlyDeletesAsk: true };                                                            // undo ON, owner 2026-11-21
    const cases: Array<[string, any]> = [
        ['give a task to someone (hand over)', interp('hand_over_task', { which: one(1), to: 'Vidya', note: null })],
        ['rename', interp('rename_task', { which: one(1), newTitle: 'Carpet PO for Mafatlal' })],
        ['change the day / person', interp('change_task', { which: hint('onboarding'), person: null, date: '2026-10-30', to: null })],
        ['remind someone', interp('remind_tasks', { which: hint('onboarding'), person: null, overdueOnly: false })],
        ['add a note', interp('add_note', { which: one(1), person: null, note: 'vendor called back' })],
        ['lock a task', interp('lock_task', { which: one(2), action: 'lock' })],
        ['answer a request', interp('answer_request', { which: { all: false, numbers: [], hints: [] }, decision: 'accept', reason: null })],
        ['assign a new task to someone', interp('create_tasks', { tasks: [{ title: 'Call the lift vendor', details: null }], assignee: 'Vidya', assignees: null, date: null })],
    ];

    console.log('\n1. Only deleting asks for a Yes (undo ON)');
    for (const [name, i] of cases) {
        const was = tasksDomain.decide(i, ctx, before) as any;
        const d = tasksDomain.decide(i, ctx, now) as any;
        check(`${name}: straight through now (was ${was.outcome})`, d.outcome === 'ACT', d);
    }
    const del = tasksDomain.decide(interp('delete_tasks', { which: one(2) }), ctx, now) as any;
    check('delete: still asks first', del.outcome === 'CONFIRM' && del.action.type === 'delete_tasks', del);
    const combo = tasksDomain.decide(interp('rename_task', { which: one(1), newTitle: 'New name' }, { also: [{ intent: 'delete_tasks', slots: { intent: 'delete_tasks', which: one(2) }, summary: 'Delete task 2', grounded: true }] }), ctx, now) as any;
    check('a message that renames AND deletes: one Yes for both (a delete is never done without asking)', combo.outcome === 'CONFIRM', combo);
    const unsure = tasksDomain.decide(interp('hand_over_task', { which: one(1), to: 'Vidya', note: null }, { confidence: 0.6 }), ctx, now) as any;
    check('a middling confidence goes straight through too (undo covers it)', unsure.outcome === 'ACT', unsure);
    const doubt = tasksDomain.decide(interp('hand_over_task', { which: one(1), to: 'Vidya', note: null }, { confidence: 0.6, ambiguities: ['task 1 or task 2?'] }), ctx, now) as any;
    check('a real doubt the AI wrote down is still a question (not a Yes card)', doubt.outcome === 'CLARIFY', doubt);
    const off = tasksDomain.decide(cases[0][1], ctx, T.DEFAULT_CONFIRM_POLICY) as any;
    check('undo OFF ("One front door" off): everything asks first, as before', off.outcome === 'CONFIRM', off);

    console.log('\n2. Every change is remembered so it can be undone');
    const at = new Date('2026-10-11T10:00:00.000Z');
    const ch = (a: any) => F.changeFromAction(a, ctx, at)!;
    const ho = ch({ type: 'hand_over_task', taskId: 't1', toId: 'u2' });
    check('hand-over: task and person kept (reversible now)', ho.items[0].kind === 'handover' && (ho.items[0] as any).taskId === 't1' && (ho.items[0] as any).toId === 'u2');
    const rn = ch({ type: 'rename_task', taskId: 't1', title: 'New name' });
    check('rename: the old name kept', rn.items[0].kind === 'rename' && (rn.items[0] as any).before === 'Carpet Installation PO');
    const cg = ch({ type: 'change_task', taskId: 'g1', title: 'Onboarding docs', ownerName: 'Vidya Nair', date: '2026-10-30', toId: 'u3' });
    check('change: old person and day kept', cg.items[0].kind === 'change' && (cg.items[0] as any).beforeOwnerId === 'u2' && (cg.items[0] as any).beforeDate === '2026-10-11');
    const rm = ch({ type: 'remind_tasks', taskIds: ['g1'], lines: ['Onboarding docs'] });
    check('reminder: who it goes to kept', rm.items[0].kind === 'remind' && JSON.stringify((rm.items[0] as any).toIds) === '["u2"]');
    const lk = ch({ type: 'lock_tasks', taskIds: ['t2', 't3'], lock: true });
    check('lock: an already-locked task is not counted', lk.items.length === 1 && (lk.items[0] as any).taskId === 't2');
    check('note and answer are remembered', ch({ type: 'add_note', taskId: 't1', note: 'x', title: 'Carpet', ownerName: null }).items[0].kind === 'note'
        && ch({ type: 'answer_request', requestId: 'r1', title: 'Payroll query', fromName: 'Neeti Rao', accept: true, reason: null }).items[0].kind === 'answer');
    check('stored records with the new kinds survive being read back', F.normalizeChange(JSON.parse(JSON.stringify({ at: at.toISOString(), items: [...ho.items, ...rn.items, ...cg.items, ...rm.items, ...lk.items] })))!.items.length === 5);
    check('"tells others": hand-over, reminder, change of person, new task for someone else, answer', [ho, rm, cg].every(c => F.tellsOthers(c, 'u1')) && !F.tellsOthers(rn, 'u1') && !F.tellsOthers(lk, 'u1'));

    console.log('\n3. Undo: within the minute nobody is told; after it, the person who was told hears it was taken back');
    const calls: any[] = [];
    const io = (toldUserIds: string[], cancelled: number): any => ({
        currentStatus: async () => 'completed', setStatus: async () => undefined, findCreated: async () => 'n1', deleteTask: async (_a: string, id: string) => { calls.push(['delete', id]); },
        cancelHeld: async () => ({ cancelled, toldUserIds }),
        undoHandOver: async (_a: string, id: string, to: string) => { calls.push(['handBack', id, to]); },
        changeBack: async (_a: string, id: string, to: any) => { calls.push(['changeBack', id, to.ownerId, to.date]); },
        renameTask: async (_a: string, id: string, t: string) => { calls.push(['rename', id, t]); },
        removeNote: async (_a: string, id: string, n: string) => { calls.push(['removeNote', id, n]); },
        setLocked: async (_a: string, id: string, l: boolean) => { calls.push(['lock', id, l]); },
        undoAnswer: async (_a: string, id: string) => { calls.push(['unanswer', id]); },
        tellTakenBack: async (_a: string, who: string) => { calls.push(['toldBack', who]); },
        nameOf: (id: string) => (id === 'u2' ? 'Vidya Nair' : id === 'u3' ? 'Harsh' : null),
    });
    const later = new Date('2026-10-11T10:00:30.000Z');
    let r = await F.runUndo(ho, 'u1', io([], 2), later);
    check('hand-over undone within the minute: back on your list, nobody told', JSON.stringify(calls) === '[["handBack","t1","u2"]]' && /back on your list/.test(r.text) && /Nobody else was told/.test(r.text), { calls, r });
    calls.length = 0;
    r = await F.runUndo(ho, 'u1', io(['u2'], 0), new Date('2026-10-11T10:03:00.000Z'));
    check('hand-over undone after the minute: Vidya gets a "taken back" note', JSON.stringify(calls) === '[["handBack","t1","u2"],["toldBack","u2"]]' && /Vidya Nair had already been told/.test(r.text), { calls, r });
    calls.length = 0;
    r = await F.runUndo({ at: at.toISOString(), items: [...rn.items, ...cg.items, ...lk.items] }, 'u1', io([], 1), later);
    check('rename, change and lock are put back', JSON.stringify(calls) === '[["rename","t1","Carpet Installation PO"],["changeBack","g1","u2","2026-10-11"],["lock","t2",false]]', calls);
    calls.length = 0;
    r = await F.runUndo(rm, 'u1', io([], 2), later);
    check('a reminder undone within the minute is never sent', /Reminder about Onboarding docs → not sent/.test(r.text), r);
    r = await F.runUndo(rm, 'u1', io(['u2'], 0), new Date('2026-10-11T10:03:00.000Z'));
    check('a reminder that already went says so (a WhatsApp message cannot be pulled back)', /already sent to Vidya Nair/.test(r.text), r);
    calls.length = 0;
    r = await F.runUndo(ho, 'u1', { ...io([], 0), undoHandOver: async () => { const e = new Error('They have already started or finished it.'); e.name = 'WorkspaceError'; throw e; } }, later);
    check('a task they already started is left alone, with the reason', /already started or finished it/.test(r.text) && r.undone === 0, r);
    r = await F.runUndo(ho, 'u1', io([], 0), new Date('2026-10-11T10:11:00.000Z'));
    check('after 10 minutes: not undone here', r.undone === 0 && /more than 10 minutes/.test(r.text));
    const oldRecord = { at: at.toISOString(), items: [{ kind: 'handover', title: 'Old', toName: 'Vidya Nair' }] } as any;
    r = await F.runUndo(oldRecord, 'u1', io([], 0), later);
    check('a hand-over saved before this change still says who to ask', /ask Vidya Nair to give it back/.test(r.text), r);

    console.log('\n4. Wording while messages wait');
    const xio: any = {
        holdsMessages: true, setStatus: async () => undefined, assign: async () => undefined, handOver: async () => ({ toName: 'Vidya Nair' }),
        readPerson: async () => '', readInsight: async () => '',
        remindTasks: async () => ({ reminded: [{ name: 'Vidya Nair', count: 1 }], skipped: [] }),
        changeTask: async () => undefined, answerRequest: async () => undefined,
    };
    const rem = await X.executeAction({ type: 'remind_tasks', taskIds: ['g1'], lines: ['Onboarding docs'] }, ctx, xio);
    check('reminder: "goes out in a minute"', /reminder to Vidya Nair( \(1\))? goes out in a minute/i.test(rem!.summary), rem);
    const chg = await X.executeAction({ type: 'change_task', taskId: 'g1', title: 'Onboarding docs', ownerName: 'Vidya Nair', date: null, toId: 'u3' }, ctx, xio);
    check('change of person: "will be told in a minute"', /will be told in a minute/.test(chg!.summary), chg);
    const ans = await X.executeAction({ type: 'answer_request', requestId: 'r1', title: 'Payroll query', fromName: 'Neeti Rao', accept: true, reason: null }, ctx, xio);
    check('accepted request: "will be told in a minute"', /Neeti Rao will be told in a minute/.test(ans!.summary), ans);
    const rem2 = await X.executeAction({ type: 'remind_tasks', taskIds: ['g1'], lines: ['Onboarding docs'] }, ctx, { ...xio, holdsMessages: false });
    check('without the waiting list (table not there yet): "Sent a reminder", as before', /^Sent a reminder to Vidya Nair/.test(rem2!.summary), rem2);
    const dup = await X.executeAction({ type: 'create_tasks', assigneeId: 'u1', date: ctx.today, tasks: [{ title: 'Carpet PO', details: null }], similar: ['Carpet Installation PO'] } as any, ctx, xio);
    check('a similar open task is mentioned in the reply (it used to be in the Yes card)', /similar open task: Carpet Installation PO/.test(dup!.summary), dup);

    console.log('\n5. The 1-minute hold');
    check('outside a task-assistant change nothing is parked (the rest of the app is unchanged)', (await H.holdIfScoped('whatsapp', { phone: '9', text: 'x' })) === false && !H.holding());
    const parked = await H.withHold('u1', async () => H.holding());
    check('inside a change, sends are inside the hold', parked === true);
    check('a missing table means "send now" (fails open, as before)', (await H.withHold('u1', () => H.holdIfScoped('bell', { userId: 'u2' }))) === false);
    const sent: string[] = []; const fin: any[] = [];
    const rio = (sendOk: boolean): any => ({
        claimDue: async () => [{ id: 'h1', actor_id: 'u1', kind: 'whatsapp', payload: { phone: '9', text: 'hi' }, attempts: 0 }, { id: 'h2', actor_id: 'u1', kind: 'bell', payload: { userId: 'u2' }, attempts: 2 }],
        send: async (row: any) => { sent.push(row.id); return sendOk; },
        finish: async (id: string, status: string, p: any) => { fin.push([id, status, p.attempts]); },
        failStuck: async () => 0,
    });
    let rel = await H.releaseDue(rio(true), new Date('2026-10-11T10:01:00Z'));
    check('due messages are sent and marked sent', rel.sent === 2 && JSON.stringify(fin) === '[["h1","sent",1],["h2","sent",3]]', { rel, fin });
    fin.length = 0;
    rel = await H.releaseDue(rio(false), new Date('2026-10-11T10:01:00Z'));
    check('a failed send is tried again next minute, up to 3 times, then marked failed', rel.retried === 1 && rel.failed === 1 && JSON.stringify(fin) === '[["h1","held",1],["h2","failed",3]]', { rel, fin });

    console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
    process.exit(failures ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
