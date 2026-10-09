/**
 * Phase 4 — smart chat, live (100% OFFLINE: fake data, a scripted AI, a RECORDER in place of WhatsApp and of the task functions;
 * no network, no real database, no message can be sent from this file).
 * Run: npx tsx task-manager/tests/test_brain_phase4_live.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const L = await import('../brain/live');
    const X = await import('../brain/execute');
    const { world } = await import('../brain/eval/worlds');
    const { tasksDomain } = await import('../brain/tasksDomain');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');

    const PHONE = '918433649199';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });

    // ── a scripted AI: answers like the real one would, for exactly the messages these tests send ────
    const interps = (msg: string): any => {
        const has = (s: string) => msg.toLowerCase().includes(s);
        const mk = (intent: string, slots: any, summary: string, extra: any = {}) => ({ intent, slots, summary, ...extra });
        if (has('change of mind') && has('lohit')) return mk('create_tasks', { assignee: 'Lohit', tasks: [{ title: 'Review the RFID rollout', details: null }], date: '2026-10-09' }, 'Give Lohit a task to review the RFID rollout tomorrow');
        if (has('specifically: lohit mehta')) return mk('create_tasks', { assignee: 'Lohit Mehta', tasks: [{ title: 'Review the RFID rollout', details: null }], date: null }, 'Give Lohit Mehta a task to review the RFID rollout');
        if (has('make it tomorrow')) return mk('answer_pending', { answer: 'edit', pick: null, instruction: 'make it tomorrow' }, 'Change the date to tomorrow');
        if (has('review the rfid rollout')) return mk('create_tasks', { assignee: 'Lohit', tasks: [{ title: 'Review the RFID rollout', details: null }], date: null }, 'Give Lohit a task to review the RFID rollout');
        if (has('add two things')) return mk('create_tasks', { assignee: 'me', tasks: [{ title: 'Call the vendor', details: null }, { title: 'Email the quote', details: null }], date: null }, 'Add two tasks for myself');
        if (has('show my tasks')) return mk('view_tasks', { scope: 'self', person: null, department: null }, 'Show my tasks');
        if (has('what is vidya working on')) return mk('view_tasks', { scope: 'person', person: 'Vidya', department: null }, 'Show what Vidya is working on');
        if (has('done 2')) return mk('complete_tasks', { which: { all: false, numbers: [2], hints: [] } }, 'Mark task 2 as done');
        if (has('working on the carpet')) return mk('progress_update', { state: 'working', which: { all: false, numbers: [1], hints: [] }, note: null }, 'Working on the carpet task');
        if (has('stuck on the carpet')) return mk('progress_update', { state: 'blocked', which: { all: false, numbers: [1], hints: [] }, note: null }, 'Stuck on the carpet task');
        if (has('book the boardroom')) return mk('facility_request', { service: 'room' }, 'Book the boardroom');
        if (has('gibberish')) return mk('unknown', {}, 'Unclear message');
        return mk('smalltalk', {}, 'Said hello');
    };
    const replyFor = (u: any) => {
        const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join(' ');
        return u.mustEndWithQuestion ? `Quick check, is this right? ${need}` : `Okay, here you go: ${need}`;
    };

    // ── a fake world ────────────────────────────────────────────────────────
    const mk = (over: any = {}) => {
        const w: any = {
            depts: new Set(['d1']), cfg: { enabled: true, employees: [{ name: 'Sahil', phone: '8433649199' }] }, employee: emp, access: { allowed: true },
            facility: false, state: null as null | { type: string; data: any }, worldName: 'default', aiDown: false,
            sent: [] as string[], audits: [] as any[], calls: { understand: 0, reply: 0 }, builds: [] as any[], exec: [] as any[], seen: new Set<string>(), execFail: null as null | ((kind: string, n: number) => string | null), n: 0, ...over,
        };
        const llm = { complete: async (req: any) => {
            if (w.aiDown) throw new Error('HTTP 503');
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) { w.calls.reply++; return { text: JSON.stringify({ text: replyFor(u) }), tokensIn: 5, tokensOut: 5 }; }
            w.calls.understand++;
            const spec = interps(u.message);
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...spec }), tokensIn: 10, tokensOut: 8 };
        } };
        const fail = (kind: string) => { const f = w.execFail ? w.execFail(kind, ++w.n) : null; if (f) throw new Error(f); };
        w.io = {
            getSmartChatDepartments: async () => w.depts, getConfig: async () => w.cfg, getEmployee: async () => w.employee, checkAccess: async () => w.access,
            facilityActive: async () => w.facility,
            getState: async () => w.state,
            setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { if (w.state?.type === L.LIVE_STATE_TYPE) w.state = null; },
            buildContext: async (_e: any, _p: string, opts: any) => { w.builds.push(opts); return { ...world(w.worldName), pending: opts.pending, recent: opts.recent }; },
            brain: { llm },
            exec: {
                setStatus: async (a: string, id: string, s: string) => { fail('setStatus'); w.exec.push(['setStatus', a, id, s]); },
                assign: async (a: string, i: any) => { fail('assign'); w.exec.push(['assign', a, i.targetUserId, i.title, i.date]); },
                handOver: async (a: string, id: string, to: string) => { fail('handOver'); w.exec.push(['handOver', a, id, to]); return { toName: 'Vidya Nair' }; },
                readPerson: async (_a: string, p: string) => { w.exec.push(['readPerson', p]); return '1. Chase quote (Pending)'; },
                readInsight: async (_a: string, k: string, s: string | null) => { w.exec.push(['readInsight', k, s]); return 'Procurement: 3 open'; },
            },
            reply: async (_p: string, t: string) => { w.sent.push(t); },
            audit: async (d: any) => { w.audits.push(d); },
            seenBefore: (id: string) => w.seen.has(id), markSeen: (id: string) => { w.seen.add(id); },
        };
        return w;
    };
    /** A whole turn: the quick decision, then the slow part (as the webhook would run it after answering). */
    const turn = async (w: any, text: string, id: string) => {
        const claim = await L.claimSmartChat(body(text, id), w.io);
        if (claim.background) await claim.background();
        return claim;
    };

    console.log('\n1. When the brain must stay out of the way (the old bot answers as before)');
    const stays = async (label: string, over: any, text = 'show my tasks') => {
        const w = mk(over); const c = await L.claimSmartChat(body(text, 'x1'), w.io);
        check(label, !c.handled && w.calls.understand === 0 && w.sent.length === 0 && w.audits.length === 0 && w.state === (over.state ?? null), { c, calls: w.calls });
    };
    await stays('no department has Smart chat ON (the default) → untouched, no AI call', { depts: new Set() });
    await stays('Smart chat ON only for ANOTHER department → untouched', { depts: new Set(['d9']) });
    await stays('Task Manager locked for the person → untouched', { access: { allowed: false } });
    await stays('an unregistered number → untouched', { employee: null });
    await stays('sandbox ON and a stranger → untouched', { cfg: { enabled: true, employees: [{ name: 'x', phone: '9000000000' }] } });
    await stays('an import preview is still open → that older conversation finishes first', { state: { type: 'IMPORT_PREVIEW', data: { tasks: [] } } });
    await stays('an old "confirm?" is still open → untouched', { state: { type: 'NL_CONFIRM', data: {} } });
    await stays('a room / ticket conversation is open → untouched', { facility: true });
    await stays('an empty message → untouched', {}, '   ');
    let w = mk();
    let c = await L.claimSmartChat({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id: 'img', message_type: 'image', image: { url: 'https://cdn.example.com/a.jpg', caption: 'tasks' } }] } }, w.io);
    check('an image / file is never taken (that is the import\'s job)', !c.handled && w.calls.understand === 0);
    w = mk({ aiDown: true });
    c = await L.claimSmartChat(body('show my tasks', 'x2'), w.io);
    check('the AI being down → NOT taken, so the old keyword bot answers; nothing sent, nothing saved', !c.handled && w.sent.length === 0 && w.state === null);
    w = mk();
    c = await L.claimSmartChat(body('book the boardroom for tomorrow', 'x3'), w.io);
    check('a room request → NOT taken (handed to the facility assistant); nothing sent, nothing saved', !c.handled && w.sent.length === 0 && w.state === null && w.calls.reply === 0);
    w = mk({ state: { type: L.LIVE_STATE_TYPE, data: { recent: [], pending: null, action: null, originalSummary: null, pickOptions: [] } } });
    c = await L.claimSmartChat(body('show my tasks', 'x4'), w.io);
    check('the brain\'s OWN earlier state does not block it', c.handled === true);

    console.log('\n2. Looking at tasks');
    w = mk();
    c = await turn(w, 'show my tasks', 'm1');
    check('handled, answered with the real list, nothing changed', c.handled && w.sent.length === 1 && /1\. Carpet Installation PO \(Pending\)/.test(w.sent[0]) && w.exec.length === 0, w.sent);
    check('two AI calls: understand + reply', w.calls.understand === 1 && w.calls.reply === 1);
    check('exactly one audit row, marked live, with the interpretation', w.audits.length === 1 && w.audits[0].live === true && w.audits[0].intent === 'view_tasks' && w.audits[0].outcome === 'ACT', w.audits[0]);
    check('a short memory is kept (what was understood + what the bot said), not the person\'s words', w.state.data.recent.length === 2 && /Person: Show my tasks/.test(w.state.data.recent[0]) && /Assistant:/.test(w.state.data.recent[1]) && !JSON.stringify(w.state).toLowerCase().includes('show my tasks.'), w.state);
    w = mk();
    await turn(w, 'what is vidya working on', 'm2');
    check('another person\'s tasks → read through the checked read function, then answered with that list', w.exec[0]?.[0] === 'readPerson' && w.exec[0][1] === 'u2' && /Chase quote/.test(w.sent[0]), { exec: w.exec, sent: w.sent });

    console.log('\n3. Adding a task: propose → confirm → done');
    w = mk();
    await turn(w, 'give lohit a task to review the rfid rollout', 'c1');
    check('the change is PROPOSED, not made: a question is sent and nothing was executed', w.exec.length === 0 && /\?/.test(w.sent[0]) && /Review the RFID rollout/.test(w.sent[0]), { exec: w.exec, sent: w.sent });
    check('the proposal is remembered as a pending confirmation', w.state.data.pending?.kind === 'confirm' && w.state.data.action?.type === 'create_tasks' && w.state.data.action.assigneeId === 'u3');
    c = await turn(w, 'yes', 'c2');
    check('"yes" (no AI needed to understand it) → the task is created for the right person, today', c.handled && w.calls.understand === 1 && JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'u3', 'Review the RFID rollout', '2026-10-08']]), w.exec);
    check('the reply says it is done, with the real details', /Review the RFID rollout/.test(w.sent[1]) && !/\?/.test(w.sent[1]), w.sent[1]);
    check('the pending state is cleared; the audit row records what was confirmed and executed', w.state.data.pending === null && w.state.data.action === null && w.audits[1].confirmedAction === 'create_tasks' && /Added 1 task for Lohit Kumar/.test(w.audits[1].executed), w.audits[1]);
    w = mk();
    await turn(w, 'give lohit a task to review the rfid rollout', 'c3');
    await turn(w, 'no', 'c4');
    check('"no" → nothing executed, state cleared, a natural reply', w.exec.length === 0 && w.state === null && w.sent.length === 2);
    w = mk();
    await turn(w, 'add two things for me: call the vendor and email the quote', 'c5');
    await turn(w, 'yes', 'c6');
    check('two tasks → both created for the sender, summary says two', w.exec.length === 2 && w.exec.every((e: any) => e[2] === 'u1') && /Added 2 tasks to your list/.test(w.audits[1].executed), w.audits[1]);
    w = mk({ execFail: (k: string, n: number) => (k === 'assign' && n === 2 ? 'Cannot assign a task to Vidya: Kickoff not sent yet.' : null) });
    await turn(w, 'add two things for me: call the vendor and email the quote', 'c7');
    await turn(w, 'yes', 'c8');
    check('one of two fails → honest partial result: 1 done, the failure and its reason shown, never "all done"', /Added 1 of 2 tasks/.test(w.audits[1].executed) && /⚠️ Email the quote — Cannot assign/.test(w.sent[1]) && /✅ Call the vendor/.test(w.sent[1]), w.sent[1]);
    w = mk({ execFail: () => 'You can only assign tasks to people who report to you.' });
    await turn(w, 'give lohit a task to review the rfid rollout', 'c9');
    await turn(w, 'yes', 'c10');
    check('everything fails (permission refused at the moment of the change) → told plainly, nothing claimed as done', /I could not add/.test(w.audits[1].executed) && !/Added/.test(w.sent[1]) && /report to you/.test(w.sent[1]), w.sent[1]);

    console.log('\n4. Finishing and status notes');
    w = mk();
    await turn(w, 'done 2', 'd1');
    check('"done 2" is proposed first, never done on the spot', w.exec.length === 0 && /Kone Lift AMC Renewal/.test(w.sent[0]) && /\?/.test(w.sent[0]), w.sent[0]);
    await turn(w, 'yes', 'd2');
    check('…and after "yes" the task is marked done through the checked function', JSON.stringify(w.exec) === JSON.stringify([['setStatus', 'u1', 't2', 'completed']]), w.exec);
    w = mk();
    await turn(w, 'working on the carpet one', 'd3');
    check('a status note goes straight through (the agreed exception): task → in progress, no question asked', JSON.stringify(w.exec) === JSON.stringify([['setStatus', 'u1', 't1', 'in_progress']]) && !/\?/.test(w.sent[0]), { exec: w.exec, sent: w.sent });
    w = mk();
    await turn(w, 'stuck on the carpet one', 'd4');
    check('"stuck" is noted without changing the task\'s status', w.exec.length === 0 && /Carpet Installation PO/.test(w.sent[0]) && w.audits[0].executed?.startsWith('Noted that you are stuck'), { exec: w.exec, a: w.audits[0] });

    console.log('\n5. Two people with the same name, and changing your mind');
    w = mk({ worldName: 'twoLohits' });
    await turn(w, 'give lohit a task to review the rfid rollout', 'p1');
    check('two Lohits → asked which, with both shown; nothing executed', w.exec.length === 0 && /Lohit Kumar \(Tech\)/.test(w.sent[0]) && /Lohit Mehta \(Procurement\)/.test(w.sent[0]) && w.state.data.pending?.kind === 'pick', w.sent[0]);
    await turn(w, '2', 'p2');
    check('"2" → the request is resumed for the SECOND Lohit and proposed again for confirmation', w.exec.length === 0 && w.state.data.pending?.kind === 'confirm' && w.state.data.action.assigneeId === 'u8', w.state);
    await turn(w, 'yes', 'p3');
    check('"yes" → created for Lohit Mehta, not for the other one', JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'u8', 'Review the RFID rollout', '2026-10-08']]), w.exec);
    w = mk();
    await turn(w, 'give lohit a task to review the rfid rollout', 'e1');
    await turn(w, 'make it tomorrow', 'e2');
    check('"make it tomorrow" → a NEW proposal dated tomorrow; the old one is replaced; still nothing executed', w.exec.length === 0 && w.state.data.action.date === '2026-10-09' && w.state.data.pending?.kind === 'confirm', w.state.data);
    await turn(w, 'yes', 'e3');
    check('…and "yes" creates it for tomorrow', JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'u3', 'Review the RFID rollout', '2026-10-09']]), w.exec);
    check('the second message already saw a short memory of the first (so a follow-up makes sense)', w.builds[1].recent.length > 0 && w.builds[0].recent.length === 0);

    console.log('\n6. Unclear messages are asked about, and nothing is double-handled');
    w = mk();
    c = await turn(w, 'gibberish xyz', 'u1');
    check('an unclear message → a question back; nothing executed', c.handled && w.exec.length === 0 && /\?/.test(w.sent[0]), w.sent);
    w = mk();
    const first = await L.claimSmartChat(body('give lohit a task to review the rfid rollout', 'dup1'), w.io);
    const again = await L.claimSmartChat(body('give lohit a task to review the rfid rollout', 'dup1'), w.io);
    check('the provider re-delivers the same message → swallowed (handled, no second proposal)', first.handled && !!first.background && again.handled && !again.background && w.calls.understand === 1);
    await first.background!();
    check('…and only ONE reply went out', w.sent.length === 1);
    w = mk(); w.io.reply = async () => { throw new Error('whatsapp down'); };
    const cl = await L.claimSmartChat(body('show my tasks', 'r1'), w.io);
    let threw = false; try { await cl.background!(); } catch { threw = true; }
    check('a sending failure never escapes the slow part', !threw);
    w = mk(); w.io.exec.assign = async () => { throw new Error('db exploded'); };
    await turn(w, 'give lohit a task to review the rfid rollout', 'r2');
    await turn(w, 'yes', 'r3');
    check('an unexpected crash while executing → one honest answer, never a half-claim of success', w.sent.length === 2 && !/Added 1 task/.test(w.sent[1]));

    console.log('\n7. The executor on its own (what it says about what really happened)');
    const calls: any[] = []; let failNext: string | null = null;
    const xio: any = {
        setStatus: async (_a: string, id: string) => { if (failNext === id) throw new Error('Not allowed.'); calls.push(id); },
        assign: async () => undefined, handOver: async () => { throw new Error('This task changed just now.'); },
        readPerson: async () => null, readInsight: async (_a: string, k: string, s: string | null) => `${k}:${s}`,
    };
    const ctx = world('default');
    let r: any = await X.executeAction({ type: 'complete_tasks', taskIds: ['t1', 't4'] }, ctx, xio);
    check('all done → "Marked 2 tasks as done." with the titles', /^Marked 2 tasks as done\.$/.test(r.summary) && /• Carpet Installation PO/.test(r.values.details), r);
    failNext = 't4'; r = await X.executeAction({ type: 'complete_tasks', taskIds: ['t1', 't4'] }, ctx, xio);
    check('one fails → "Marked 1 of 2 tasks…; 1 could not be done" and the reason', /Marked 1 of 2 tasks as done; 1 could not be done/.test(r.summary) && /Damaged Ceiling Tile Replacement — Not allowed\./.test(r.values.details), r);
    failNext = 't1'; r = await X.executeAction({ type: 'complete_tasks', taskIds: ['t1'] }, ctx, xio);
    check('the only one fails → "I could not mark it. <reason>"', /^I could not mark it\. Not allowed\.$/.test(r.summary), r.summary);
    failNext = null;
    r = await X.executeAction({ type: 'hand_over_task', taskId: 't5', toId: 'u2' }, ctx, xio);
    check('a refused hand-over is reported with the reason, never as done', /I could not give that task to Vidya Nair\. This task changed just now\./.test(r.summary), r.summary);
    r = await X.executeAction({ type: 'view_tasks', scope: 'person', personId: 'u2', department: null }, ctx, xio);
    check('reading someone you may not see → "You are not allowed to see that."', /not allowed to see that/.test(r.summary));
    r = await X.executeAction({ type: 'view_tasks', scope: 'department', personId: null, department: 'Procurement' }, ctx, xio);
    check('a department overview is fetched as a department progress lookup', r.values.data === 'department_progress:Procurement');
    r = await X.executeAction({ type: 'view_tasks', scope: 'pending_overview', personId: null, department: null }, ctx, xio);
    check('"who has pending tasks" → the pending lookup; the whole company → the overview', r.values.data === 'pending_tasks:null' && (await X.executeAction({ type: 'view_tasks', scope: 'org', personId: null, department: null }, ctx, xio))!.values.data === 'org_overview:null');
    r = await X.executeAction({ type: 'progress_update', state: 'working', taskIds: ['t2'], note: null }, ctx, xio);
    check('a task that is already in progress is not touched again, but is still acknowledged', !calls.includes('t2') && /Noted 1 task as in progress\./.test(r.summary), r);
    check('needsExecution: reads of your own list, chat and answers need none; changes do', !X.needsExecution({ type: 'chat', kind: 'help' }) && !X.needsExecution({ type: 'view_tasks', scope: 'self', personId: null, department: null }) && !X.needsExecution({ type: 'answer_pending', answer: 'yes', pick: null, instruction: null }) && X.needsExecution({ type: 'complete_tasks', taskIds: [] }));

    console.log('\n8. Replies after a change really happened');
    const sender = world('default').sender;
    const yesDecision: any = { outcome: 'ACT', action: { type: 'answer_pending', answer: 'yes', pick: null, instruction: null } };
    const withResult = tasksDomain.replyFacts(yesDecision, world('default'), { summary: 'Marked 2 tasks as done.', values: { details: '• A\n• B' } })!;
    check('with a result, the reply may say it is done (nothing-done is no longer claimed) and must include the details', withResult.claimsNothingDone === false && withResult.required.join() === 'details' && /Marked 2 tasks as done/.test(withResult.fallback) && /• A/.test(withResult.fallback), withResult);
    const without = tasksDomain.replyFacts(yesDecision, world('default'))!;
    check('without a result it may not claim anything is done', without.claimsNothingDone === true);
    check('a plain status note with a result gets result-based facts', tasksDomain.replyFacts({ outcome: 'ACT', action: { type: 'progress_update', state: 'working', taskIds: ['t1'], note: null } } as any, world('default'), { summary: 'Noted 1 task as in progress.', values: { details: '• X' } })!.kind === 'progress_result');
    check('the sender in these tests is Priyanka', sender.name === 'Priyanka Shah');

    console.log('\n9. The Smart chat switch (one per department)');
    const access: any = TaskAccessService; const db: any = TaskDatabaseService;
    const audits2: any[] = []; db.logAudit = async (a: any) => { audits2.push(a); }; db.getDepartmentById = async (id: string) => (id === 'd-proc' ? { id, name: 'Procurement' } : null);
    (supabaseAdmin as any).from = () => ({ select: async () => ({ data: [{ department_id: 'd-proc', smart_chat_enabled: true }, { department_id: 'd-hr', smart_chat_enabled: false }], error: null }) });
    let g = await TaskAccessService.getSmartChatDepartments();
    check('only departments explicitly ON are returned', g.departments.size === 1 && g.departments.has('d-proc') && !g.columnMissing);
    (supabaseAdmin as any).from = () => ({ select: async () => ({ data: null, error: { code: '42703', message: 'column does not exist' } }) });
    g = await TaskAccessService.getSmartChatDepartments();
    check('column not created yet (migration not run) → nobody has it, flagged (FAIL CLOSED)', g.departments.size === 0 && g.columnMissing === true && (await TaskAccessService.isSmartChatEnabled('d-proc')) === false);
    (supabaseAdmin as any).from = () => ({ select: async () => { throw new Error('down'); } });
    check('database unreadable → nobody has it, no exception', (await TaskAccessService.getSmartChatDepartments()).departments.size === 0);
    access.getSnapshot = async () => ({ provisioned: true, readable: true, departmentEnabled: new Map(), onboarded: new Map() });
    let upserted: any = null;
    (supabaseAdmin as any).from = () => ({ upsert: async (p: any, o: any) => { upserted = { p, o }; return { error: null }; } });
    await TaskAccessService.setSmartChatEnabled('d-proc', true, 'Admin A');
    check('switching ON writes ONLY its own column for that department, and is audited with who did it', upserted.p.smart_chat_enabled === true && !('task_import_enabled' in upserted.p) && !('peer_assign' in upserted.p) && upserted.o.onConflict === 'department_id' && audits2[0].event_type === 'task_access_smart_chat_updated' && audits2[0].details.actor === 'Admin A', { upserted, a: audits2[0] });
    let msg = ''; try { await TaskAccessService.setSmartChatEnabled('nope', true); } catch (e: any) { msg = e.message; }
    check('an unknown department is refused', /Department not found/.test(msg));
    (supabaseAdmin as any).from = () => ({ upsert: async () => ({ error: { code: '42703', message: 'x' } }) });
    msg = ''; try { await TaskAccessService.setSmartChatEnabled('d-proc', true); } catch (e: any) { msg = e.message; }
    check('migration not run → a friendly message naming the SQL file', /20261007000005_task_manager_smart_chat\.sql/.test(msg));
    const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
    const sql = read('supabase/migrations/20261007000005_task_manager_smart_chat.sql').split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    check('the migration only ADDS one boolean column, default false, nothing destructive', /ADD COLUMN IF NOT EXISTS smart_chat_enabled BOOLEAN NOT NULL DEFAULT false;/.test(sql) && !/\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/i.test(sql));

    console.log('\n10. Wiring (source checks)');
    const route = read('app/api/webhooks/aisensy/route.ts');
    check('the webhook tries the import first, then Smart chat, then shadow mode, then everything else exactly as before', route.indexOf('claimTaskImport(body)') < route.indexOf('claimSmartChat(body)') && route.indexOf('claimSmartChat(body)') < route.indexOf('scheduleShadow('));
    check('a handled message answers the webhook at once and does the slow part after it (after())', /if \(smartChat\.handled\) \{\s*if \(smartChat\.background\) after\(async \(\) => \{ await smartChat\.background!\(\); \}\);\s*return NextResponse\.json\(/.test(route));
    const live = read('task-manager/brain/live.ts');
    check('every change goes through the existing checked task functions (WorkspaceService), never straight to the database', /WorkspaceService\.setStatus/.test(live) && /WorkspaceService\.assign/.test(live) && /WorkspaceService\.handOver/.test(live) && !/\.insert\(|\.update\(|\.upsert\(|supabase|createTaskAssignment|updateAssignmentStatus/.test(live + read('task-manager/brain/execute.ts')));
    check('replies go through the safety gate (kill switches + Pretend Mode)', /TaskMessagingService\.sendFreeformReply/.test(live));
    check('only the brain\'s own state is ever cleared or overwritten', /context_type === LIVE_STATE_TYPE\) await TaskDatabaseService\.clearConversationContext/.test(live));
    const panel = read('frontend/components/task-manager/TaskAccessPanel.tsx');
    check('the Control Center has a per-department "Smart chat" button with its SQL-file banner', /Smart chat: \{d\.smartChatEnabled/.test(panel) && /action: 'set_smart_chat', departmentId/.test(panel) && /20261007000005_task_manager_smart_chat\.sql/.test(panel));
    check('nothing in this whole test touched the network', net.length === 0, net);

    console.log(failures === 0 ? '\n🎉 PHASE 4 SMART CHAT TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
