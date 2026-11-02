/**
 * 2026-11-02 — fixes from the real WhatsApp failures of 27–31 Oct (100% OFFLINE: fake data, a scripted AI, a RECORDER in place
 * of WhatsApp, the task functions and the inbox table; no network, no real database, no message can be sent from this file).
 *   1. "TASK 4 DONE" / "4 done" are exact commands (no AI call)
 *   2. the rewrite step is skipped for messages that stand on their own (speed)
 *   3. a doubt / middling confidence: own-list tasks go ahead with undo; other people → one specific question or a preview
 *   4. several requests in one message go straight through when every part would (one undo)
 *   5. Neeti's request: "Yes I cannot take the request because I'm busy" is a yes, and the reason goes with it
 *   6. a correction that cannot be applied keeps the question open (never "nothing is waiting")
 *   7. "answer_pending" with nothing pending is read once more
 *   8. a new task line gets its own suggestion (not the previous one); "… Add task" at the end is not part of the title
 *   9. batching: messages sent back to back become ONE turn and ONE reply (the PharmEasy Swasth.AI behaviour)
 * Run: npx tsx task-manager/tests/test_brain_fixes_2026_11_02.ts
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
    const F = await import('../brain/frontDoor');
    const R = await import('../brain/rewrite');
    const T = await import('../brain/types');
    const { tasksDomain } = await import('../brain/tasksDomain');
    const { world } = await import('../brain/eval/worlds');
    const IB = await import('../SmartChatInbox');

    // ── 1. exact commands ────────────────────────────────────────────────────────────────────────
    console.log('\n1. "TASK 4 DONE" and friends are exact commands (no AI call)');
    const nums = (t: string) => { const c = F.parseExactCommand(t); return c && c.kind === 'done' ? c.numbers.join(',') : null; };
    check('"TASK 4 DONE" → done 4', nums('TASK 4 DONE') === '4');
    check('"4 done" → done 4', nums('4 done') === '4');
    check('"#4 done" → done 4', nums('#4 done') === '4');
    check('"task 4 is done." → done 4', nums('task 4 is done.') === '4');
    check('"tasks 2, 3 completed" → done 2,3', nums('tasks 2, 3 completed') === '2,3');
    check('"task no 2 finished" → done 2', nums('task no 2 finished') === '2');
    check('"done 4" still works', nums('done 4') === '4');
    check('"task 4" alone is NOT a command', F.parseExactCommand('task 4') === null);
    check('"GRIEVENCE TASK DONE" is NOT an exact command (the AI reads it)', F.parseExactCommand('GRIEVENCE TASK DONE') === null);
    check('"4 tasks done today, 2 left" is NOT an exact command', F.parseExactCommand('4 tasks done today, 2 left') === null);

    // ── 2. rewrite only when needed ──────────────────────────────────────────────────────────────
    console.log('\n2. The rewrite step runs only for short or pointing-back messages');
    check('"same for Neeti" → rewritten', R.mayNeedRewrite('same for Neeti'));
    check('"make it tomorrow" → rewritten', R.mayNeedRewrite('make it tomorrow'));
    check('a short message → rewritten', R.mayNeedRewrite('done with vendor'));
    check('"Add four tasks: Airtel bill payment, Kolkata microwave order, VFS snag list" → NOT rewritten (stands alone)',
        !R.mayNeedRewrite('Add four tasks: Airtel bill payment, Kolkata microwave order, VFS snag list'));
    check('a long message that points back ("also add the same for usko bhi") → rewritten', R.mayNeedRewrite('please also add the vendor visit for the team usko bhi'));

    // ── 3–4. deciding ────────────────────────────────────────────────────────────────────────────
    console.log('\n3. A doubt no longer stops a clear request with a vague question');
    const ctx = world('default');
    const frontDoorPolicy = { ...T.DEFAULT_CONFIRM_POLICY, confirmCompletions: false, confirmCreates: false };
    const interp = (intent: string, slots: any, extra: any = {}): any => ({ intent, slots: { intent, ...slots }, confidence: 0.95, language: 'en', ambiguities: [], clarifyQuestion: null, summary: 'summary', grounded: true, ...extra });
    let d: any = tasksDomain.decide(interp('create_tasks', { assignee: 'me', tasks: [{ title: 'database setup in design login', details: null }], date: null },
        { ambiguities: ['one task or two?'], summary: 'Add a task for today: database setup in design login.' }), { ...ctx, message: 'database setup in design login' }, frontDoorPolicy);
    check('own task + a doubt (undo ON) → SAVED straight away, the doubt kept for one short line', d.outcome === 'ACT' && d.action.type === 'create_tasks' && d.aside === 'one task or two?', d);
    const facts = tasksDomain.replyFacts(d, ctx, { summary: 'Added 1 task to your list.', values: { details: '• database setup in design login' } })!;
    check('…the reply ends with that note and the undo hint (fallback text)', /I wasn't fully sure: one task or two\?/.test(facts.fallback) && /undo/i.test(facts.fallback), facts.fallback);
    d = tasksDomain.decide(interp('create_tasks', { assignee: 'me', tasks: [{ title: 'database setup in design login', details: null }], date: null },
        { ambiguities: ['one task or two?'] }), { ...ctx, message: 'database setup in design login' }, T.DEFAULT_CONFIRM_POLICY);
    check('…with undo OFF → one question with the AI\'s reading (never saved unasked)', d.outcome === 'CLARIFY' && d.reason === 'ai_flagged_ambiguity' && d.understood === 'summary', d);
    d = tasksDomain.decide(interp('create_tasks', { assignee: 'Vidya', tasks: [{ title: 'Conduct induction', details: null }], date: null },
        { ambiguities: ['both Vidya and Dipti, or one?'], clarifyQuestion: 'Both Vidya and Dipti, or only Vidya?', summary: 'Give Vidya a task to conduct induction.' }), { ...ctx, message: 'assign vidya and dipti to conduct induction' }, frontDoorPolicy);
    check('another person + a doubt → ONE specific question (the AI\'s own), nothing saved', d.outcome === 'CLARIFY' && d.reason === 'ai_flagged_ambiguity' && d.question === 'Both Vidya and Dipti, or only Vidya?', d);
    const cf = tasksDomain.replyFacts(d, ctx)!;
    check('…the question offers the AI\'s reading and does not dump the task list', cf.fallback === 'Both Vidya and Dipti, or only Vidya?' && !/Carpet/.test(cf.fallback) && cf.noYesNoQuestion === false, cf);
    d = tasksDomain.decide(interp('create_tasks', { assignee: 'me', tasks: [{ title: 'align vendor for sigma IR testing', details: null }], date: null }, { confidence: 0.6 }), { ...ctx, message: '2nd floor align vendor for sigma IR testing' }, frontDoorPolicy);
    check('own task at confidence 0.6 (undo ON) → saved, not "I\'m not sure what you\'d like"', d.outcome === 'ACT', d);
    d = tasksDomain.decide(interp('hand_over_task', { which: { all: false, numbers: [1], hints: [] }, to: 'Vidya' }, { confidence: 0.6 }), ctx, frontDoorPolicy);
    check('a hand-over at confidence 0.6 → a preview for one yes', d.outcome === 'CONFIRM' && d.action.type === 'hand_over_task', d);
    d = tasksDomain.decide(interp('create_tasks', { assignee: 'me', tasks: [{ title: 'noida vrv discussion', details: null }], date: null }, { confidence: 0.4, summary: 'Maybe add a task about the Noida VRV discussion.' }), { ...ctx, message: 'noida vrv discussion' }, frontDoorPolicy);
    check('confidence 0.4 → still asks, proposing the AI\'s reading', d.outcome === 'CLARIFY' && d.reason === 'low_confidence' && d.understood === 'Maybe add a task about the Noida VRV discussion.', d);

    console.log('\n4. Several requests in one message');
    const multi = (extra: any = {}) => interp('complete_tasks', { which: { all: false, numbers: [1], hints: [] } },
        { also: [{ intent: 'create_tasks', slots: { intent: 'create_tasks', assignee: 'me', tasks: [{ title: 'call the vendor', details: null }], date: null }, summary: 'Add a task to call the vendor.', grounded: true }], ...extra });
    d = tasksDomain.decide(multi(), { ...ctx, message: 'done 1 and add task call the vendor' }, frontDoorPolicy);
    check('"done 1 and add a task" with undo ON → BOTH done straight away (one change, one undo)', d.outcome === 'ACT' && d.action.type === 'batch' && d.action.actions.length === 2, d);
    d = tasksDomain.decide(multi(), { ...ctx, message: 'done 1 and add task call the vendor' }, T.DEFAULT_CONFIRM_POLICY);
    check('…with undo OFF → still ONE preview', d.outcome === 'CONFIRM' && d.action.type === 'batch', d);
    const bf = tasksDomain.replyFacts({ outcome: 'ACT', action: d.action } as any, ctx, { summary: 'Marked 1 task as done. Added 1 task to your list.', values: { details: '• Carpet Installation PO\n• call the vendor' } })!;
    check('…the reply for a combined change says what happened, with the undo hint', bf.kind === 'batch_result' && /undo/i.test(bf.fallback), bf);

    // ── a fake world for live turns ──────────────────────────────────────────────────────────────
    const PHONE = '918433649199';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });
    const mkI = (intent: string, slots: any, summary: string, extra: any = {}) => ({ intent, slots, summary, ...extra });
    const interps = (msg: string, pending: string, note: string | undefined): any => {
        const m = msg.toLowerCase(), has = (s: string) => m.includes(s);
        if (has('change of mind')) return mkI('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Answers the question');   // the AI losing track
        if (has('can\'t do it')) return mkI('answer_request', { which: { all: false, numbers: [], hints: [] }, decision: 'decline', reason: null }, 'Decline Neeti\'s request.');
        if (has('i cannot take the request')) return mkI('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Yes, decline it.');
        if (has('only the first one please')) return mkI('answer_pending', { answer: 'edit', pick: null, instruction: 'only the first one please' }, 'Change the preview.');
        if (has('add task call the vendor')) return mkI('create_tasks', { assignee: 'me', tasks: [{ title: 'call the vendor', details: null }], date: null }, 'Add a task: call the vendor.');
        if (has('task four is finished now')) return note
            ? mkI('complete_tasks', { which: { all: false, numbers: [4], hints: [] } }, 'Mark task 4 as done.')
            : mkI('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Repeats the request instead of answering.');
        if (has('can u help') || has('who are u')) return mkI('help', {}, 'Asks who the bot is and what it can do.');
        return mkI('smalltalk', {}, 'Chatting.');
    };
    const replyFor = (u: any) => {
        const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join(' ');
        return u.mustEndWithQuestion ? `Quick check, is this right? ${need}` : `Okay, here you go: ${need}`;
    };
    const mk = (over: any = {}) => {
        const w: any = { state: null as null | { type: string; data: any }, sent: [] as string[], exec: [] as any[], seen: new Set<string>(), prompts: [] as any[], audits: [] as any[], frontDoor: false, inbox: undefined, ...over };
        const llm = { complete: async (req: any) => {
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: replyFor(u) }), tokensIn: 5, tokensOut: 5 };
            if (/"request"/.test(req.system)) return { text: JSON.stringify({ request: u.new_message }), tokensIn: 1, tokensOut: 1 };   // rewrite: unchanged
            w.prompts.push(u);
            const spec = interps(u.message, String(u.context?.pending || ''), u.context?.important_note);
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...spec }), tokensIn: 10, tokensOut: 8 };
        } };
        w.io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp, checkAccess: async () => ({ allowed: true }),
            facilityActive: async () => false,
            getState: async () => w.state,
            setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { w.state = null; },
            openPingPending: async () => null,
            buildContext: async (_e: any, _p: string, opts: any) => ({ ...world('default'), pending: opts.pending, recent: opts.recent,
                supportRequests: [{ id: 'r1', title: 'testing - do not panic!', fromName: 'Neeti Upadhyay', fromDepartment: 'Human Resources' }] }),
            frontDoorOn: async () => w.frontDoor,
            brain: { llm },
            exec: {
                setStatus: async (_a: string, id: string, s: string) => { w.exec.push(['status', id, s]); },
                assign: async (_a: string, i: any) => { w.exec.push(['assign', i.targetUserId, i.title]); },
                handOver: async () => ({ toName: 'x' }),
                answerRequest: async (_a: string, id: string, accept: boolean, reason: string | null) => { w.exec.push(['answer', id, accept, reason]); },
                readPerson: async () => '', readInsight: async () => '',
            },
            reply: async (_p: string, t: string) => { w.sent.push(t); },
            audit: async (dt: any) => { w.audits.push(dt); },
            seenBefore: (id: string) => w.seen.has(id), markSeen: (id: string) => { w.seen.add(id); },
            ...(w.inbox ? { inbox: w.inbox } : {}),
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
    const pendingKind = (w: any) => w.state?.data?.pending?.kind ?? null;

    // ── 5. Neeti ─────────────────────────────────────────────────────────────────────────────────
    console.log('\n5. "Yes I cannot take the request because I\'m busy" is a yes, with its reason');
    let w = mk();
    await turn(w, 'Can\'t do it');
    check('"Can\'t do it" → asks once whether to tell Neeti (a decline waits for a yes)', pendingKind(w) === 'confirm' && w.exec.length === 0, { state: w.state, sent: w.sent });
    await turn(w, 'Yes i cannot take the request because I\'m busy');
    const ans = w.exec.find((e: any[]) => e[0] === 'answer');
    check('→ Neeti is told (declined), NOT "nothing is waiting for a yes"', !!ans && ans[2] === false && !/nothing is waiting/i.test(last(w)), { exec: w.exec, sent: w.sent });
    check('→ with the reason they gave', !!ans && ans[3] === 'I cannot take the request because I\'m busy', ans);
    check('startsWithYes / reasonAfterYes: "Yes, as I\'m on leave" → reason "I\'m on leave"', L.startsWithYes('Yes, as I\'m on leave') && L.reasonAfterYes('Yes, as I\'m on leave') === 'I\'m on leave');
    check('a resent request ("Add tasks: …") does not start with yes', !L.startsWithYes('Add tasks: call vendor, send quote'));

    // ── 6. a correction that cannot be applied ───────────────────────────────────────────────────
    console.log('\n6. A correction that cannot be applied keeps the question open');
    w = mk();
    await turn(w, 'add task call the vendor');
    check('own task with undo OFF → a preview waiting for a yes', pendingKind(w) === 'confirm' && w.exec.length === 0, w.state);
    await turn(w, 'only the first one please');
    check('→ the person is told plainly and the question STAYS open (never "nothing is waiting")', last(w) === L.KEEP_QUESTION && pendingKind(w) === 'confirm' && w.exec.length === 0, { sent: w.sent, state: w.state });
    await turn(w, 'yes');
    check('→ a plain "yes" afterwards still saves it', w.exec.some((e: any[]) => e[0] === 'assign' && e[2] === 'call the vendor'), w.exec);

    // ── 7. answer_pending with nothing pending ───────────────────────────────────────────────────
    console.log('\n7. "Answer to a question" with nothing pending is read once more');
    w = mk();
    await turn(w, 'task four is finished now');
    check('→ the second reading wins: task 4 is proposed to be marked done (not "nothing is waiting")', pendingKind(w) === 'confirm' && w.prompts.length === 2 && !!w.prompts[1].context.important_note && !/nothing is waiting/i.test(last(w)), { prompts: w.prompts.length, sent: w.sent });
    check('…the first reading had no note (the prompt is unchanged unless needed)', !('important_note' in w.prompts[0].context));

    // ── 8. suggestions ───────────────────────────────────────────────────────────────────────────
    console.log('\n8. Suggested task titles');
    check('"2nd floor sigma ir testing vendor align Add task" → the title without "Add task"', L.suggestedTitle('2nd floor sigma ir testing vendor align Add task') === '2nd floor sigma ir testing vendor align');
    check('"Etpl hhmd repair and new supply" → its own title', L.suggestedTitle('Etpl hhmd repair and new supply') === 'Etpl hhmd repair and new supply');
    check('"add task" alone → no title (it is an answer, not a task)', L.suggestedTitle('add task') === null);

    // ── 9. batching ──────────────────────────────────────────────────────────────────────────────
    console.log('\n9. Messages sent back to back → ONE turn, ONE reply');
    const fakeInbox = () => {
        const rows: any[] = [];
        const io: any = {
            rows,
            insert: async (r: any) => { if (!rows.some(x => x.message_id === r.message_id)) rows.push({ ...r, claimed_by: null, claimed_at: null, done_at: null }); return 'ok'; },
            waiting: async (p: string, since: string) => rows.filter(r => r.phone === p && !r.claimed_by && r.received_at >= since).sort((a, b) => a.received_at.localeCompare(b.received_at)).map(r => ({ ...r })),
            busy: async (p: string, since: string) => rows.some(r => r.phone === p && r.claimed_by && !r.done_at && r.claimed_at >= since),
            claim: async (p: string, token: string, since: string) => { const now = new Date().toISOString(); const got = rows.filter(r => r.phone === p && !r.claimed_by && r.received_at >= since); got.forEach(r => { r.claimed_by = token; r.claimed_at = now; }); return got.map(r => ({ ...r })); },
            finish: async (token: string) => { rows.filter(r => r.claimed_by === token).forEach(r => { r.done_at = new Date().toISOString(); r.body = ''; }); },
            now: () => Date.now(), sleep: (ms: number) => new Promise(res => setTimeout(res, ms)),
        };
        return io;
    };
    const pause = (ms: number) => new Promise(res => setTimeout(res, ms));

    let inbox = fakeInbox();
    const started = Date.now();
    const outs = await Promise.all([
        IB.collectBatch({ phone: PHONE, messageId: 'b1', text: 'Hi', io: inbox }),
        pause(120).then(() => IB.collectBatch({ phone: PHONE, messageId: 'b2', text: 'Hello', io: inbox })),
        pause(240).then(() => IB.collectBatch({ phone: PHONE, messageId: 'b3', text: 'Can u help', io: inbox })),
    ]);
    check('the two earlier messages step aside ("deferred")', outs[0].kind === 'deferred' && outs[1].kind === 'deferred', outs);
    check('the newest one answers ALL THREE, in the order sent', outs[2].kind === 'batch' && (outs[2] as any).texts.join('|') === 'Hi|Hello|Can u help', outs[2]);
    check(`…after the person was quiet for ~${IB.QUIET_MS / 1000}s (took ${Date.now() - started} ms)`, Date.now() - started >= IB.QUIET_MS && Date.now() - started < IB.QUIET_MS + 2000);
    check('while that turn runs, a new message waits for it ("busy")', await inbox.busy(PHONE.replace(/\D/g, ''), new Date(Date.now() - 60_000).toISOString()));
    await inbox.finish((outs[2] as any).token);
    check('when it finishes, the text is blanked', inbox.rows.every((r: any) => r.body === '' && r.done_at));
    check('joinBatch → one line per message', IB.joinBatch([' Hi ', '', 'Can u help']) === 'Hi\nCan u help');
    check('no message id → not batched (answered alone, as before)', (await IB.collectBatch({ phone: PHONE, messageId: null, text: 'x', io: fakeInbox() })).kind === 'unavailable');
    const missing = fakeInbox(); missing.insert = async () => 'missing';
    check('table not there yet → not batched (answered alone, as before)', (await IB.collectBatch({ phone: PHONE, messageId: 'z1', text: 'x', io: missing })).kind === 'unavailable');
    IB.resetInboxAvailability();

    console.log('\n   …through the live claim');
    inbox = fakeInbox();
    w = mk({ inbox });
    const claims = await Promise.all([
        L.claimSmartChat(body('Hi', 'c1'), w.io),
        pause(120).then(() => L.claimSmartChat(body('Can u help', 'c2'), w.io)),
        pause(240).then(() => L.claimSmartChat(body('Who are u', 'c3'), w.io)),
    ]);
    check('the earlier webhooks: handled, nothing to do', claims[0].handled && !claims[0].background && claims[1].handled && !claims[1].background, claims);
    check('the newest: ONE turn for "Can u help" + "Who are u" ("Hi" adds nothing)', claims[2].handled && !!claims[2].background && claims[2].text === 'Can u help\nWho are u', claims[2]);
    await claims[2].background!();
    check('→ exactly ONE reply was sent', w.sent.length === 1, w.sent);
    check('→ the AI read them together, one line each', w.prompts.length === 1 && w.prompts[0].message === 'Can u help\nWho are u', w.prompts.map((p: any) => p.message));
    check('→ the batch is finished (the next one is not kept waiting)', inbox.rows.every((r: any) => !!r.done_at));

    inbox = fakeInbox();
    w = mk({ inbox });
    const greet = await Promise.all([L.claimSmartChat(body('Hi', 'g1'), w.io), pause(120).then(() => L.claimSmartChat(body('Hello', 'g2'), w.io))]);
    check('"Hi" + "Hello" only → the old bot answers ONCE (one menu), no AI call', greet[0].handled && !greet[0].background && !greet[1].handled && w.prompts.length === 0, greet);

    inbox = fakeInbox();
    w = mk({ inbox });
    const mix = await Promise.all([L.claimSmartChat(body('Hi', 'h1'), w.io), pause(120).then(() => L.claimSmartChat(body('raise a ticket', 'h2'), w.io))]);
    check('"Hi" + "raise a ticket" → the old bot gets the ticket request', !mix[1].handled && (mix[1].rewrite as any) === undefined && w.prompts.length === 0, mix);

    // ── 10. conversation memory ──────────────────────────────────────────────────────────────────
    console.log('\n10. Conversation memory: compact replies, automatic messages kept short, 8 lines');
    const CM = await import('../ConversationMemory');
    const P = await import('../brain/prompt');
    const longReply = [
        'Sorry Lohitaksha, I didn\'t quite get that. Here\'s what\'s still open for you:',
        '🔄 *Carry forward tasks*',
        ...Array.from({ length: 12 }, (_, i) => `${i + 1}. A fairly long open task title number ${i + 1} for the team`),
        '📋 *Today\'s tasks*',
        'Should I add "database setup in design login" to your list?',
    ].join('\n');
    const compact = CM.compactBotText(longReply);
    check('a long reply keeps its QUESTION at the end (it used to be cut off at 300 characters)', /Should I add "database setup in design login" to your list\?$/.test(compact), compact);
    check('…the list becomes one short bracket, headings go, and it fits in 300 characters', compact.length <= 300 && /\[(?:12 items|[^\]]*\+9 more)\]/.test(compact) && !/Carry forward/.test(compact), compact);
    check('a short reply is unchanged', CM.compactBotText('Done, Sahil. Reply *undo* within 10 minutes to reverse it.') === 'Done, Sahil. Reply *undo* within 10 minutes to reverse it.');
    check('a preview keeps its first items ("• call the vendor • send the quote")', CM.compactBotText('Add these 2 tasks?\n• call the vendor\n• send the quote') === 'Add these 2 tasks? [call the vendor; send the quote]');
    check('an automatic message is one short marked line', /^\(automatic message\) /.test(CM.autoLine(longReply)) && CM.autoLine(longReply).length <= 180);
    const at = (m: number) => new Date(Date.UTC(2026, 10, 2, 9, m)).toISOString();
    const turns = [
        { who: 'bot', text: '(automatic message) Good morning digest', at: at(0), auto: true },
        { who: 'bot', text: '(automatic message) Midday reminder', at: at(1), auto: true },
        { who: 'person', text: 'done 2', at: at(2) },
        { who: 'bot', text: 'Marked done.', at: at(3) },
        { who: 'bot', text: '(automatic message) Neeti needs your help with a task', at: at(4), auto: true },
        { who: 'person', text: 'can\'t do it', at: at(5) },
    ];
    const tr = CM.toTranscript(turns);
    check(`only the newest ${CM.MAX_AUTO_SHOWN} automatic messages are shown; the real chat is all there`, tr.length === 5 && !tr.some(l => /morning digest/.test(l)) && tr.some(l => /Neeti/.test(l)) && tr.some(l => /done 2/.test(l)), tr);
    check('every step now sees the last 8 messages', P.CONVERSATION_LINES === 8 && P.recentConversation(Array.from({ length: 20 }, (_, i) => `l${i}`)).length === 8);

    console.log('\n11. Prompt caching on the Claude call');
    const LLM = await import('../brain/llm');
    const sentBodies: any[] = [];
    const realFetch = (globalThis as any).fetch;
    process.env.CLAUDE_API_KEY = 'test-key-offline';
    (globalThis as any).fetch = async (_u: any, init: any) => { sentBodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 10, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } }) }; };
    const res = await LLM.anthropicComplete({ model: 'anthropic:claude-haiku-5-5', system: 'FIXED INSTRUCTIONS', user: '{"message":"hi"}' });
    (globalThis as any).fetch = realFetch; delete process.env.CLAUDE_API_KEY;
    const sys = sentBodies[0]?.system;
    check('the instructions are sent with a cache marker', Array.isArray(sys) && sys[0].text === 'FIXED INSTRUCTIONS' && sys[0].cache_control?.type === 'ephemeral', sys);
    check('…the person\'s data stays in the (uncached) user part', sentBodies[0]?.messages?.[0]?.content === '{"message":"hi"}');
    check('…token totals still count the cached part (4,900 in, 4,000 of it cached)', res.tokensIn === 4900 && res.cachedIn === 4000, res);

    check('no network was used', net.length === 0, net);
    console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
    process.exit(failures ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
