/**
 * Owner 2026-10-20 — notes on tasks from the smart chat (100% OFFLINE: fake data, a scripted AI, a RECORDER in place of
 * WhatsApp and of the task functions; no network, no real database, no message can be sent from this file).
 *   - a new task with a note ("Onboarding - Satish") → saved as "Remark: Satish", shown as "(note: Satish)" in the preview
 *   - a note on a task that already exists: own task, or one the sender gave; the person's name is optional
 *   - a person's name only narrows WHOSE task it is (never a new task, never a hand-over)
 *   - two tasks fit → the bot asks which (showing whose), and the note survives the choice
 * Run: npx tsx task-manager/tests/test_brain_notes.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- stubs replace services and DTOs on purpose (same as the other brain tests) */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const L = await import('../brain/live');
    const { world } = await import('../brain/eval/worlds');
    const { tasksDomain } = await import('../brain/tasksDomain');

    const PHONE = '918433649199';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });

    // Tasks Priyanka GAVE other people (two people both have an "Onboarding").
    const GIVEN = [
        { id: 'g1', title: 'Onboarding', ownerId: 'u2', ownerName: 'Vidya Nair', date: '2026-10-07' },
        { id: 'g2', title: 'Onboarding', ownerId: 'u6', ownerName: 'Dipti Rao', date: '2026-10-08' },
        { id: 'g3', title: 'Vendor follow-up', ownerId: 'u5', ownerName: 'Suraj Verma', date: '2026-10-08' },
    ];

    // ── a scripted AI: answers like the real one should, for exactly the messages below ────────────
    const mkI = (intent: string, slots: any, summary: string) => ({ intent, slots, summary });
    const note = (hints: string[], person: string | null, text: string | null, numbers: number[] = []) =>
        mkI('add_note', { which: { all: false, numbers, hints }, person, note: text }, 'Add a note to a task');
    const interps = (msg: string, pending = ''): any => {
        const m = msg.toLowerCase(), has = (s: string) => m.includes(s);
        // Owner 2026-10-21: a note when giving or assigning
        const draft = pending.startsWith('UNFINISHED REQUEST');
        if (draft && has('call the vendor first')) return mkI('hand_over_task', { which: { all: false, numbers: [2], hints: [] }, to: 'Vidya', note: 'call the vendor first' }, 'Give task 2 to Vidya with a note');
        if (draft && has('align with accounts')) return mkI('create_tasks', { assignee: 'Vidya', tasks: [{ title: 'Vendor follow-up', details: 'align with accounts' }], date: null }, 'Add a task for Vidya with a note');
        if (has('give task 2 to vidya, note:')) return mkI('hand_over_task', { which: { all: false, numbers: [2], hints: [] }, to: 'Vidya', note: 'call the vendor first' }, 'Give task 2 to Vidya with a note');
        if (has('give task 2 to vidya, add note')) return mkI('hand_over_task', { which: { all: false, numbers: [2], hints: [] }, to: 'Vidya', note: null, wants_note: true }, 'Give task 2 to Vidya');
        if (has('assign vidya vendor follow-up, add note')) return mkI('create_tasks', { assignee: 'Vidya', tasks: [{ title: 'Vendor follow-up', details: null }], date: null, wants_note: true }, 'Add a task for Vidya');
        const remindI = (hints: string[], person: string | null, overdueOnly = false) => mkI('remind_tasks', { which: { all: false, numbers: [], hints }, person, overdue_only: overdueOnly }, 'Remind');
        if (has('remind vidya about onboarding')) return remindI(['onboarding'], 'Vidya');
        if (has('remind about onboarding')) return remindI(['onboarding'], null);
        if (has('remind suraj')) return remindI([], 'Suraj');
        if (has('remind everyone about overdue')) return remindI([], 'everyone', true);
        if (has('remind harsh')) return remindI([], 'Harsh');
        if (has('specifically') && has('vidya')) return note(['onboarding'], 'Vidya', 'documents pending');
        if (m.trim() === '1') return mkI('answer_pending', { answer: 'pick', pick: 1, instruction: null }, 'The first one');
        if (m.trim() === 'yes') return mkI('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Yes');
        // the AI (wrongly) treats words as a note: code keeps a note ONLY when the person wrote "note:" / "remark:"
        if (has('give vidya onboarding')) return mkI('create_tasks', { assignee: 'Vidya', tasks: [{ title: 'Onboarding', details: 'Satish' }], date: null }, 'Give Vidya onboarding');
        // Sanil, 2026-10-20: he sent his list again in a new form while the preview was waiting
        if (has('change of mind') && has('new lineups')) return mkI('create_tasks', { assignee: 'me', tasks: ['New lineups Ops', 'Bangalore Drive', 'Technical exe', 'Ops manager', 'AFM'].map(title => ({ title, details: null })), date: null }, 'Add 5 tasks');
        if (has('add tasks\nnew lineups ops,bangalore drive')) return mkI('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Agreed');
        if (has('1. mail event report')) return mkI('create_tasks', { assignee: 'me', tasks: [
            { title: 'Mail event report', details: null }, { title: 'Navratri budget and count update', details: 'from Srushti' },
            { title: 'Diwali poll', details: 'from Team' }, { title: 'Mail to Divesh', details: 'about my arrears' }], date: null }, 'Add 4 tasks');
        if (has('new lineups ops')) return mkI('create_tasks', { assignee: 'me', tasks: [{ title: 'New lineups Ops, Bangalore Drive', details: 'Technical exe, Ops manager, AFM' }], date: null }, 'Add a task');
        if (has("vidya's onboarding")) return note(['onboarding'], 'Vidya', 'documents pending');
        if (has("harsh's onboarding")) return note(['onboarding'], 'Harsh', 'documents pending');
        if (has('note to onboarding: documents pending')) return note(['onboarding'], null, 'documents pending');
        if (has('vendor follow-up')) return note(['vendor follow-up'], null, 'call before 3pm');
        if (has('task 1')) return note([], null, 'waiting for quote', [1]);
        if (has('invented')) return note(['onboarding'], 'Vidya', 'the client wants a refund by Monday');
        if (has('add a note to onboarding')) return note(['onboarding'], 'Vidya', null);
        return mkI('smalltalk', {}, 'Said hello');
    };
    const replyFor = (u: any) => {
        const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join(' ');
        return u.mustEndWithQuestion ? `Quick check, is this right? ${need}` : `Okay, here you go: ${need}`;
    };

    const mk = () => {
        const w: any = { state: null as null | { type: string; data: any }, sent: [] as string[], exec: [] as any[], seen: new Set<string>(), prompts: [] as any[] };
        const llm = { complete: async (req: any) => {
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: replyFor(u) }), tokensIn: 5, tokensOut: 5 };
            w.prompts.push(u);
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...interps(u.message, String(u.context?.pending || '')) }), tokensIn: 10, tokensOut: 8 };
        } };
        w.io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp, checkAccess: async () => ({ allowed: true }),
            facilityActive: async () => false,
            getState: async () => w.state,
            setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { w.state = null; },
            buildContext: async (_e: any, _p: string, opts: any) => ({ ...world('default'), pending: opts.pending, recent: opts.recent, noteTargets: GIVEN }),
            brain: { llm },
            exec: {
                setStatus: async () => undefined,
                assign: async (a: string, i: any) => { w.exec.push(['assign', a, i.targetUserId, i.title, i.description ?? (i.note ? `Remark: ${i.note}` : undefined)]); },
                handOver: async (a: string, id: string, to: string, note?: string) => { w.exec.push(['handover', a, id, to, note ?? null]); return { toName: 'Vidya Nair' }; },
                addNote: async (a: string, taskId: string, text: string) => { w.exec.push(['note', a, taskId, text]); },
                remindTasks: async (a: string, ids: string[]) => { w.exec.push(['remind', a, ids]); return { reminded: [{ name: 'Vidya Nair', count: ids.length }], skipped: [] }; },
                readPerson: async () => '', readInsight: async () => '',
            },
            reply: async (_p: string, t: string) => { w.sent.push(t); },
            audit: async () => undefined,
            seenBefore: (id: string) => w.seen.has(id), markSeen: (id: string) => { w.seen.add(id); },
        };
        return w;
    };
    let n = 0;
    const turn = async (w: any, text: string) => {
        const claim = await L.claimSmartChat(body(text, `m${++n}`), w.io);
        if (claim.background) await claim.background();
        return claim;
    };
    const last = (w: any) => w.sent[w.sent.length - 1] || '';

    console.log('\n1. A new task with a note');
    let w = mk();
    await turn(w, 'give vidya onboarding, note: satish');
    check('"note:" → the preview shows the note next to the task, nothing saved yet', /Onboarding \(note: Satish\)/.test(last(w)) && w.exec.length === 0, w.sent);
    await turn(w, 'yes');
    check('yes → saved for Vidya with the note as "Remark: Satish"', JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'u2', 'Onboarding', 'Remark: Satish']]), w.exec);
    check('the "Added" reply shows the note too', /Onboarding \(note: Satish\)/.test(last(w)), last(w));
    w = mk();
    await turn(w, 'give vidya onboarding note satish');
    check('the word "note" without ":" also makes a note', /Onboarding \(note: Satish\)/.test(last(w)), last(w));
    w = mk();
    await turn(w, 'give vidya onboarding - satish');
    check('no "note:" written → NO note; every word stays in the task name', w.state?.data.action?.tasks?.[0]?.title === 'Onboarding - Satish' && w.state.data.action.tasks[0].details === null && !/note:/.test(last(w)), w.state?.data.action);
    const spec = tasksDomain.intents.find(s => s.name === 'create_tasks')!;
    check('the AI is told: a note only with "note:" / "remark:", and a list is one task per line or item', /ONLY when the message marks a note/.test(spec.slots) && /ONE TASK PER LINE OR ITEM/.test(spec.slots));

    console.log('\n1c. Roohi\'s numbered list with a detail line under each task (2026-10-20)');
    w = mk();
    await turn(w, '1. Mail event report\nPending\n\n2. Navratri budget and count update\nPending · from srushti\n\n3. Diwali poll\nPending · from Team\n\n4. Mail to Divesh\nPending · about my arrears\nadd these in tasks');
    const rt = w.state?.data.action?.tasks || [];
    check('the detail lines stay as notes ("from Srushti", "from Team", "about my arrears")', rt.length === 4 && rt[1].details === 'from Srushti' && rt[2].details === 'from Team' && rt[3].details === 'about my arrears' && /Diwali poll \(note: from Team\)/.test(last(w)), rt);

    console.log('\n1b. Sanil\'s list (2026-10-20)');
    w = mk();
    await turn(w, 'Add task\nNew lineups Ops,\nBangalore Drive.\nTechnical exe, Ops manager, AFM');
    check('the roles are NOT turned into a note (no "note:" in his message)', !/note:/.test(last(w)) && w.state?.data.action?.tasks?.every((t: any) => t.details === null), { sent: last(w), action: w.state?.data.action });
    await turn(w, 'Add tasks\nNew lineups Ops,Bangalore Drive,Technical exe, Ops manager, AFM');
    check('sending it again is NOT a yes, even if the AI reads it as one: nothing saved', w.exec.length === 0, w.exec);
    check('→ a NEW preview from his new message (5 tasks), waiting for yes', w.state?.data.pending?.kind === 'confirm' && w.state.data.action?.tasks?.length === 5, w.state?.data.action);
    await turn(w, 'yes');
    check('yes → the 5 tasks are saved', w.exec.filter((e: any[]) => e[0] === 'assign').length === 5, w.exec);

    console.log('\n2. A note on a task given to someone, naming the person');
    w = mk();
    await turn(w, "add note to vidya's onboarding: documents pending");
    check('preview: Vidya\'s Onboarding with the note, nothing saved yet', /Onboarding/.test(last(w)) && w.state?.data.action?.type === 'add_note' && w.state.data.action.taskId === 'g1' && w.exec.length === 0, { sent: last(w), action: w.state?.data.action });
    check('naming Vidya did NOT create a task or hand anything over', w.state?.data.action?.type === 'add_note');
    await turn(w, 'yes');
    check('yes → the note is added to Vidya\'s task only', JSON.stringify(w.exec) === JSON.stringify([['note', 'u1', 'g1', 'documents pending']]), w.exec);

    console.log('\n3. No name, two people have "Onboarding" → the bot asks which');
    w = mk();
    await turn(w, 'add note to onboarding: documents pending');
    check('asks which one, showing whose task each is; nothing saved', w.state?.data.pending?.kind === 'pick' && w.state.data.pickOptions.some((o: string) => /Vidya Nair/.test(o)) && w.state.data.pickOptions.some((o: string) => /Dipti Rao/.test(o)) && w.exec.length === 0, w.state?.data);
    check('the person\'s own words are kept (so the note survives the choice)', /documents pending/.test(w.state?.data.originalSummary || ''), w.state?.data.originalSummary);
    await turn(w, '1');
    check('"1" → the note goes to the first one (Vidya), asked to confirm', w.state?.data.action?.type === 'add_note' && w.state.data.action.taskId === 'g1' && w.state.data.action.note === 'documents pending', w.state?.data.action);
    await turn(w, 'yes');
    check('yes → saved on Vidya\'s task', JSON.stringify(w.exec) === JSON.stringify([['note', 'u1', 'g1', 'documents pending']]), w.exec);

    console.log('\n4. No name, only one task fits → no question');
    w = mk();
    await turn(w, 'add note to vendor follow-up: call before 3pm');
    check('goes straight to the preview for Suraj\'s task', w.state?.data.action?.type === 'add_note' && w.state.data.action.taskId === 'g3' && w.state.data.action.ownerName === 'Suraj Verma', w.state?.data.action);

    console.log('\n5. A note on their own task, by number');
    w = mk();
    await turn(w, 'add note to task 1: waiting for quote');
    check('task 1 of their own list, marked as theirs', w.state?.data.action?.type === 'add_note' && w.state.data.action.taskId === 't1' && w.state.data.action.ownerName === null, w.state?.data.action);

    console.log('\n6. Safety');
    w = mk();
    await turn(w, "add note to harsh's onboarding: documents pending");
    check('a person they gave no such task → asks, never adds it elsewhere', !w.state?.data.action && w.exec.length === 0 && w.state?.data.lastOutcome === 'CLARIFY', w.state?.data);
    w = mk();
    await turn(w, 'add the invented note please');
    check('a note that is not in the message → not saved, asks again', !w.state?.data.action && w.exec.length === 0, w.state?.data);
    w = mk();
    await turn(w, 'add a note to onboarding');
    const d: any = tasksDomain.decide({ intent: 'add_note', confidence: 0.95, language: 'en', ambiguities: [], clarifyQuestion: null, summary: '', grounded: true,
        slots: { intent: 'add_note', which: { all: false, numbers: [], hints: ['onboarding'] }, person: 'Vidya', note: null } } as any, { ...world('default'), noteTargets: GIVEN } as any, { confirmProgressUpdates: false });
    check('no note given → asks what it should say, nothing saved', !w.state?.data.action && w.exec.length === 0 && d.outcome === 'CLARIFY' && d.reason === 'no_task_content' && d.detail === 'note', d);

    console.log('\n7. Remind someone about a task you gave them');
    w = mk();
    await turn(w, 'remind vidya about onboarding');
    check('preview of the reminder (Vidya\'s Onboarding only), nothing sent yet', w.state?.data.action?.type === 'remind_tasks' && JSON.stringify(w.state.data.action.taskIds) === '["g1"]' && /Onboarding \(Vidya Nair/.test(last(w)) && w.exec.length === 0, { sent: last(w), action: w.state?.data.action });
    await turn(w, 'yes');
    check('yes → the reminder is sent for that task', JSON.stringify(w.exec) === JSON.stringify([['remind', 'u1', ['g1']]]), w.exec);
    check('the reply says who was reminded', /Vidya Nair/.test(last(w)), last(w));
    w = mk();
    await turn(w, 'remind about onboarding');
    check('no name and two people have "Onboarding" → asks which, nothing sent', w.state?.data.pending?.kind === 'pick' && w.exec.length === 0, w.state?.data);
    w = mk();
    await turn(w, 'remind suraj about his pending tasks');
    check('a name and no task → all open tasks given to Suraj', JSON.stringify(w.state?.data.action?.taskIds) === '["g3"]', w.state?.data.action);
    w = mk();
    await turn(w, 'remind everyone about overdue tasks');
    check('"overdue" → only tasks given before today (Vidya\'s, from 7 Oct)', JSON.stringify(w.state?.data.action?.taskIds) === '["g1"]', w.state?.data.action);
    w = mk();
    await turn(w, 'remind harsh');
    check('nothing given to Harsh → says so, nothing sent', !w.state?.data.action && w.exec.length === 0 && w.state?.data.lastOutcome === 'REFUSE', w.state?.data);

    console.log('\n8. A note when giving a task (2026-10-21)');
    w = mk();
    await turn(w, 'give task 2 to vidya, note: call the vendor first');
    check('the preview shows the note, nothing moved yet', /Note: call the vendor first/.test(last(w)) && w.state?.data.action?.note === 'call the vendor first' && w.exec.length === 0, { sent: last(w), action: w.state?.data.action });
    await turn(w, 'yes');
    check('yes → handed over WITH the note (the alert and the task carry it)', JSON.stringify(w.exec) === JSON.stringify([['handover', 'u1', 't2', 'u2', 'call the vendor first']]), w.exec);
    check('the reply shows the note', /Note: call the vendor first/.test(last(w)), last(w));
    w = mk();
    await turn(w, 'give task 2 to vidya, add note');
    check('only "add note" → the bot asks what the note should say, nothing moved', w.state?.data.lastOutcome === 'CLARIFY' && w.exec.length === 0 && w.state?.data.pending?.kind === 'draft', { sent: last(w), state: w.state?.data });
    const facts: any = (await import('../brain/tasksDomain')).tasksDomain.replyFacts({ outcome: 'CLARIFY', reason: 'note_missing', options: [], detail: 'Vidya Nair' } as any, world('default') as any);
    check('its question: "What note should I add for Vidya?"', facts?.fallback === 'What note should I add for Vidya?', facts?.fallback);
    await turn(w, 'call the vendor first');
    check('the answer finishes the request → preview with the note', /Note: call the vendor first/.test(last(w)) && w.state?.data.action?.type === 'hand_over_task', { sent: last(w), action: w.state?.data.action });

    console.log('\n9. A note when assigning a new task');
    w = mk();
    await turn(w, 'assign vidya vendor follow-up, add note');
    check('only "add note" → asks what the note should say, nothing saved', w.state?.data.lastOutcome === 'CLARIFY' && w.state?.data.pending?.kind === 'draft' && w.exec.length === 0, w.state?.data);
    await turn(w, 'align with accounts');
    check('→ preview with the note', /Vendor follow-up \(note: align with accounts\)/.test(last(w)), last(w));
    await turn(w, 'yes');
    check('yes → saved for Vidya with the note', JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'u2', 'Vendor follow-up', 'Remark: align with accounts']]), w.exec);

    check('\nnothing in this test touched the network', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 NOTES (SMART CHAT) TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
