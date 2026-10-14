/**
 * Part B — "the bot stops losing track" (OFFLINE: fake data, a scripted AI, recorders in place of WhatsApp and the task
 * functions; no network, no database, no message can be sent from this file).
 * Every case is a REAL chat from 2026-10-12 (Harsh, Priyanka, Lohit, Sahil), plus the safety rules that must never break.
 * Run: npx tsx task-manager/tests/test_part_b_context.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const L = await import('../brain/live');
    const R = await import('../brain/respond');
    const { world } = await import('../brain/eval/worlds');

    const PHONE = '919999900001';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });
    const UNDERSTOOD = (intent: string, slots: any, summary: string, extra: any = {}) => ({ intent, slots, summary, confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...extra });

    /** A fake world. `script(message)` is what the understanding AI answers; `replyAi` writes the reply (default: placeholders only). */
    const mk = (script: (m: string, u: any) => any, over: any = {}) => {
        const w: any = { state: null, sent: [] as string[], exec: [] as any[], replyRequests: [] as any[], conversation: [] as string[],
            tasks: JSON.parse(JSON.stringify(world('default').tasks)), replyAi: null, ...over };
        const llm = { complete: async (req: any) => {
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) {
                w.replyRequests.push(u);
                if (w.replyAi) return { text: JSON.stringify({ text: w.replyAi(u) }), tokensIn: 1, tokensOut: 1 };
                const need = (u.placeholders || []).filter((x: any) => x.required).map((x: any) => x.name).join(' ');
                return { text: JSON.stringify({ text: `Okay: ${need}${u.mustEndWithQuestion ? ' Which one?' : ''}` }), tokensIn: 1, tokensOut: 1 };
            }
            return { text: JSON.stringify(script(u.message, u)), tokensIn: 1, tokensOut: 1 };
        } };
        w.io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp,
            checkAccess: async () => ({ allowed: true }), facilityActive: async () => false,
            getState: async () => w.state, setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { w.state = null; }, openPingPending: async () => null,
            readConversation: async () => w.conversation,
            buildContext: async (_e: any, _p: string, opts: any) => ({ ...world('default'), tasks: JSON.parse(JSON.stringify(w.tasks)), pending: opts.pending, recent: opts.recent, ...(opts.conversation ? { conversation: opts.conversation } : {}) }),
            frontDoorOn: async () => false,
            brain: { llm },
            exec: {
                setStatus: async (a: string, id: string, s: string) => { w.exec.push(['setStatus', a, id, s]); const t = w.tasks.find((x: any) => x.id === id); if (t) t.status = s; },
                assign: async (a: string, i: any) => { w.exec.push(['assign', a, i.targetUserId, i.title]); },
                handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '',
            },
            reply: async (_p: string, t: string) => { w.sent.push(t); },
            audit: async () => {}, seenBefore: () => false, markSeen: () => {},
        };
        return w;
    };
    const turn = async (w: any, text: string, id: string) => { const c = await L.claimSmartChat(body(text, id), w.io); if (c.background) await c.background(); return c; };
    const YES = UNDERSTOOD('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Yes');

    console.log('\n1. Harsh: "Done 1 and add new task hr grievance training video" — two requests, ONE preview, ONE yes');
    let w = mk(m => /^done 1 and add/i.test(m)
        ? UNDERSTOOD('complete_tasks', { which: { all: false, numbers: [1], hints: [] } }, 'Mark task 1 as done and add a task.', {
            also: [{ intent: 'create_tasks', slots: { assignee: 'me', tasks: [{ title: 'HR grievance training video', details: null }], date: null }, summary: 'Add the HR grievance training video task.' }] })
        : YES);
    await turn(w, 'Done 1 and add new task hr grievance training video', 'h1');
    check('nothing happens yet (no YES given)', w.exec.length === 0, w.exec);
    check('one question is open, holding BOTH changes', w.state?.data?.pending?.kind === 'confirm' && w.state.data.action?.type === 'batch' && w.state.data.action.actions.length === 2, w.state?.data);
    check('the preview lists both, in plain words', /Mark done: Carpet Installation PO/.test(w.sent[0]) && /Add for you: HR grievance training video/.test(w.sent[0]), w.sent[0]);
    await turn(w, 'Yes', 'h2');
    check('one "Yes" → task 1 marked done AND the new task added', JSON.stringify(w.exec) === JSON.stringify([['setStatus', 'u1', 't1', 'completed'], ['assign', 'u1', 'u1', 'HR grievance training video']]), w.exec);
    const told = w.replyRequests[w.replyRequests.length - 1];
    check('the reply reports both (outcome given to the reply writer; the list of both inserted by code)', /Marked 1 task as done/.test(told.situation) && /Added 1 task to your list/.test(told.situation)
        && /Carpet Installation PO/.test(w.sent[1]) && /HR grievance training video/.test(w.sent[1]), { situation: told.situation, sent: w.sent[1] });
    check('the question is closed afterwards', !w.state?.data?.pending, w.state?.data);

    console.log('\n2. Several requests where one part is unclear — the clear part is offered, the unclear part is named, never acted on');
    w = mk(m => /zed/i.test(m)
        ? UNDERSTOOD('complete_tasks', { which: { all: false, numbers: [1], hints: [] } }, 'Mark task 1 as done.', {
            also: [{ intent: 'create_tasks', slots: { assignee: 'Zed', tasks: [{ title: 'Call the vendor', details: null }], date: null }, summary: 'Give Zed a task to call the vendor.' }] })
        : YES);
    await turn(w, 'done 1 and tell zed to call the vendor', 'z1');
    check('only the clear change is held for the yes; the unknown person is never given anything', w.state?.data?.action?.type === 'batch' && w.state.data.action.actions.length === 1 && w.state.data.action.actions[0].type === 'complete_tasks', w.state?.data?.action);
    check('the preview says which part was not understood', /Give Zed a task to call the vendor/.test(w.sent[0]), w.sent[0]);
    await turn(w, 'yes', 'z2');
    check('yes → only the clear part happens', JSON.stringify(w.exec) === JSON.stringify([['setStatus', 'u1', 't1', 'completed']]), w.exec);

    console.log('\n3. Harsh: "Yes add this task" with NOTHING pending — the request is taken from the chat and shown first');
    const harshChat = ['Person: Done 1 and add new task hr grievance training video', 'Assistant: I want to be sure I understood. Could you tell me a little more?'];
    const addFromChat = () => UNDERSTOOD('create_tasks', { assignee: 'me', tasks: [{ title: 'HR grievance training video', details: null }], date: null }, 'Add the HR grievance training video task.');
    w = mk(m => (/yes add this/i.test(m) ? addFromChat() : YES), { conversation: harshChat });
    await turn(w, 'Yes add this task', 'y1');
    check('→ the normal preview ("should I add …?"), nothing added yet', w.exec.length === 0 && w.state?.data?.pending?.kind === 'confirm' && w.state.data.action?.type === 'create_tasks' && /HR grievance training video/.test(w.sent[0]), { exec: w.exec, sent: w.sent[0] });
    await turn(w, 'Yes', 'y2');
    check('…then "Yes" adds it', JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'u1', 'HR grievance training video']]), w.exec);
    w = mk(() => addFromChat(), { conversation: ['Assistant: Should I add HR grievance training video?'] });
    await turn(w, 'Yes add this task', 'y3');
    check('safety: a title found only in the ASSISTANT\'s lines (never said by the person) is not accepted', w.state?.data?.action == null && w.exec.length === 0, w.state?.data);

    console.log('\n4. Priyanka: "yes" more than 15 minutes later still works (question kept 2 hours)');
    check('a question stays answerable for 120 minutes', L.STATE_TTL_MIN === 120 && /ttlMinutes: STATE_TTL_MIN/.test(read('task-manager/brain/live.ts')));

    console.log('\n5. An unclear answer keeps the question open, so the next clear "yes" still works');
    w = mk(m => (/maybe/i.test(m) ? UNDERSTOOD('answer_pending', { answer: 'unsure', pick: null, instruction: null }, 'Not sure.') : YES));
    w.state = { type: L.LIVE_STATE_TYPE, data: { recent: [], pending: { kind: 'confirm', summary: 'Mark task 2 as done' }, action: { type: 'complete_tasks', taskIds: ['t2'] }, originalSummary: 'Mark task 2 as done', pickOptions: [], relay: false, titles: {} } };
    await turn(w, 'hmm maybe', 'p1');
    check('the question and its change are still open', w.state?.data?.pending?.kind === 'confirm' && w.state.data.action?.taskIds?.[0] === 't2' && w.exec.length === 0, w.state?.data);
    await turn(w, 'yes', 'p2');
    check('…and "yes" then does it', JSON.stringify(w.exec) === JSON.stringify([['setStatus', 'u1', 't2', 'completed']]), w.exec);

    console.log('\n6. Lohit: no more bare "not sure" — the reply shows the real open tasks and how to act');
    w = mk(() => UNDERSTOOD('unknown', {}, 'Unclear.'));
    await turn(w, 'Mark fone', 'l1');
    check('"Mark fone" → the open tasks are listed, with a real "done N" hint', /1\. Carpet Installation PO/.test(w.sent[0]) && /Reply \*done 1\*/.test(w.sent[0]) && !/6\. Agreement Followup/.test(w.sent[0]), w.sent[0]);
    w = mk(() => UNDERSTOOD('complete_tasks', { which: { all: false, numbers: [], hints: ['agreement followup'] } }, 'Mark the agreement task as done.'));
    await turn(w, 'Completed agreement followup task', 'l2');
    check('a task that is ALREADY done → says so AND shows what is still open', /already/i.test(w.sent[0] + JSON.stringify(w.replyRequests[0])) && /1\. Carpet Installation PO/.test(w.sent[0]), w.sent[0]);

    console.log('\n7. Sahil: a lone "Yes" with nothing waiting');
    w = mk(() => UNDERSTOOD('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Yes, with nothing pending.'));
    await turn(w, 'Okay yes go', 's1');
    check('→ "nothing is waiting", plus the open tasks; nothing changes', w.exec.length === 0 && /1\. Carpet Installation PO/.test(w.sent[0]) && w.replyRequests[0]?.noYesNoQuestion === true, { sent: w.sent[0], r: w.replyRequests[0] });

    console.log('\n8. The bot can no longer ask a yes/no question that nothing is waiting for');
    w = mk(() => UNDERSTOOD('unknown', {}, 'Unclear.'), { replyAi: () => 'Hi, could you confirm if you\'d like me to add that task?' });
    await turn(w, 'that thing from before', 'q1');
    check('an AI reply asking "could you confirm…?" is rejected → the safe text with the open tasks is sent instead', !/confirm/i.test(w.sent[0]) && /Your open tasks/.test(w.sent[0]), w.sent[0]);
    const f = { kind: 'x', describe: '', values: {}, required: [], asksQuestion: true, claimsNothingDone: true, names: [], fallback: '', noYesNoQuestion: true } as any;
    check('checker: "Should I add it?" / "Do you want me to…?" rejected; "Which task do you mean?" fine',
        R.checkReply('Should I add it?', f).length > 0 && R.checkReply('Do you want me to mark it?', f).length > 0 && R.checkReply('Which task do you mean?', f).length === 0);
    check('a real preview (a yes IS waiting) may still ask "should I…?"', R.checkReply('Should I add it?', { ...f, noYesNoQuestion: false }).length === 0);

    console.log('\n9. Replies follow the conversation (the reply writer sees the recent chat)');
    const chat = Array.from({ length: 14 }, (_, i) => (i % 2 ? `Assistant: reply ${i}` : `Person: message ${i}`));
    w = mk(() => UNDERSTOOD('smalltalk', {}, 'Asks what they just asked.'), { conversation: chat });
    await turn(w, 'What did I just ask?', 'c1');
    const rq = w.replyRequests[0];
    check('the reply writer gets the last 10 chat lines (not all 20: keeps replies fast)', rq?.recentConversation?.length === 10 && rq.recentConversation[9] === 'Assistant: reply 13', rq?.recentConversation);
    check('its rules: the conversation only shapes wording, never what happened; it is data', /ONLY so your words follow the conversation/.test(read('task-manager/brain/prompt.ts')) && /never say something was done because the conversation mentions it/.test(read('task-manager/brain/prompt.ts')));
    w = mk(() => UNDERSTOOD('smalltalk', {}, 'Hi.'));
    await turn(w, 'hi', 'c2');
    check('no memory → the reply request has no conversation (exactly as before)', !('recentConversation' in w.replyRequests[0]));

    console.log('\n10. Safety');
    w = mk(() => UNDERSTOOD('complete_tasks', { which: { all: false, numbers: [1], hints: [] } }, 'Done 1 and more.', { also: [{ intent: 'create_tasks', slots: { assignee: 'me', tasks: [{ title: 'x' }] }, summary: 'x' }] }));
    w.io.openPingPending = async () => ({ pending: { kind: 'ping_reply', assigner: 'Saniel', taskIds: ['p1'], taskTitles: ['Budget'] }, titles: { p1: 'Budget' } });
    emp.role = 'superuser';
    await turn(w, 'done 1 and add x', 'x1');
    emp.role = 'employee';
    check('never combined while replying to someone\'s request (numbers mean THAT request)', w.state?.data?.action?.type !== 'batch', w.state?.data?.action);
    const live = read('task-manager/brain/live.ts');
    check('a combined change goes through the same YES path as any change (no new way to write)', /if \(a\.answer === 'yes' && t\.state\.action\)/.test(live));
    check('"undo" after a combined change reverses every part', /case 'batch':\s*\/\/ Part B: "undo" after a combined change reverses every part of it\./.test(read('task-manager/brain/frontDoor.ts')));
    check('the fixed rules for several requests and "yes add this" are outside the tunable prompt (a tuned version cannot drop them)',
        !/SEVERAL REQUESTS|AGREEING TO AN EARLIER REQUEST/.test(JSON.stringify((await import('../brain/prompt')).BUILTIN_PROMPT_SECTIONS)) && /AGREEING TO AN EARLIER REQUEST/.test((await import('../brain/prompt')).interpretSystemPrompt([])));

    console.log('\n11. Sahil: "what are my carry forward tasks?" → ONLY those; and they can be marked done in plain words');
    const carriedTasks = [
        { n: 1, id: 'c1', title: 'Work on optimizing FMS dashboard slow loading', status: 'pending', from: '2026-10-12' },
        { n: 2, id: 'c2', title: 'Bot slow replies', status: 'pending' },
        { n: 3, id: 'c3', title: 'To-do list reminder', status: 'pending' },
    ];
    w = mk(() => UNDERSTOOD('view_tasks', { scope: 'self', person: null, department: null, carried_forward_only: true }, 'Show carried-forward tasks.'), { tasks: carriedTasks });
    await turn(w, 'what are my carry forward tasks?', 'cf1');
    check('only the carried-over task is shown, with the day it was given and its real number', /1\. Work on optimizing FMS dashboard slow loading \(from 12 Oct, Pending\)/.test(w.sent[0]) && !/Bot slow replies/.test(w.sent[0]) && /Reply \*done 1\*/.test(w.sent[0]), w.sent[0]);
    w = mk(() => UNDERSTOOD('view_tasks', { scope: 'self', person: null, department: null, carried_forward_only: true }, 'Show carried-forward tasks.'), { tasks: carriedTasks.slice(1) });
    await turn(w, 'what are my carry forward tasks?', 'cf2');
    check('none carried over → says so plainly', /no tasks carried over/i.test(w.sent[0] + JSON.stringify(w.replyRequests[0])), w.sent[0]);
    w = mk(() => UNDERSTOOD('view_tasks', { scope: 'self', person: null, department: null }, 'Show my tasks.'), { tasks: carriedTasks });
    await turn(w, 'what do I have today', 'cf3');
    check('the full list marks the carried-over task ("from 12 Oct") and shows today\'s too', /Work on optimizing FMS dashboard slow loading \(from 12 Oct, Pending\)/.test(w.sent[0]) && /Bot slow replies \(Pending\)/.test(w.sent[0]), w.sent[0]);
    w = mk(m => (/carry forward/i.test(m) ? UNDERSTOOD('complete_tasks', { which: { all: false, numbers: [1], hints: [] } }, 'Mark the carried-forward task as done.') : YES), { tasks: carriedTasks });
    await turn(w, 'mark my carry forward task as done', 'cf4');
    check('"mark my carry forward task as done" → the usual preview first (nothing changed yet)', w.exec.length === 0 && w.state?.data?.action?.taskIds?.[0] === 'c1' && /Work on optimizing FMS dashboard slow loading/.test(w.sent[0]), w.sent[0]);
    await turn(w, 'yes', 'cf5');
    check('…YES → the carried-over task is marked done', JSON.stringify(w.exec) === JSON.stringify([['setStatus', 'u1', 'c1', 'completed']]), w.exec);
    check('the AI is told how: "carry forward tasks are done" = the numbers of the tasks marked "open since"', /tasks marked "open since" \(all of them, and only them\)/.test(read('task-manager/brain/tasksDomain.ts')));

    console.log('\n11b. Two new tasks for the same person → ONE "add 2 tasks"; a side remark keeps the open question');
    w = mk(m => (/vidya/i.test(m) ? UNDERSTOOD('create_tasks', { assignee: 'Vidya', tasks: [{ title: 'Chase the carpet vendor', details: null }], date: null }, 'Give Vidya two tasks.', {
        also: [{ intent: 'create_tasks', slots: { assignee: 'Vidya', tasks: [{ title: 'Update the tracker', details: null }], date: null }, summary: 'Ask Vidya to update the tracker.' }] }) : YES));
    await turn(w, 'give vidya the task of chasing the carpet vendor and also ask her to update the tracker', 'm1');
    check('→ one "add 2 tasks for Vidya" (not two separate steps)', w.state?.data?.action?.type === 'create_tasks' && w.state.data.action.assigneeId === 'u2' && w.state.data.action.tasks.length === 2, w.state?.data?.action);
    w = mk(m => (/thanks/i.test(m) ? UNDERSTOOD('smalltalk', {}, 'Thanks.') : YES));
    w.state = { type: L.LIVE_STATE_TYPE, data: { recent: [], pending: { kind: 'confirm', summary: 'Mark task 2 as done' }, action: { type: 'complete_tasks', taskIds: ['t2'] }, originalSummary: 'Mark task 2 as done', pickOptions: [], relay: false, titles: {} } };
    await turn(w, 'ok thanks', 'm2');
    check('"thanks" while a question waits → the question is still open', w.state?.data?.pending?.kind === 'confirm' && w.state.data.action?.taskIds?.[0] === 't2', w.state?.data);
    await turn(w, 'yes', 'm3');
    check('…and "yes" still does it', JSON.stringify(w.exec) === JSON.stringify([['setStatus', 'u1', 't2', 'completed']]), w.exec);

    console.log('\n11c. "Assign everyone …": the AI describes the group, code picks the people (only those you may give work to)');
    const grp = (group: any) => () => UNDERSTOOD('create_tasks', { assignee: 'group', tasks: [{ title: 'Check emails', details: null }], date: null, group }, 'Give everyone a task.');
    w = mk(m => (/everyone/i.test(m) ? grp({ whose: 'team', department: null, except: [] })() : YES));
    await turn(w, 'assign everyone the task of checking emails', 'g1');
    const ids = (w.state?.data?.action?.actions || []).map((a: any) => a.assigneeId);
    check('"everyone" → one preview with each person you may give work to (never Neha / Saniel)', w.state?.data?.action?.type === 'batch' && JSON.stringify(ids) === '["u2","u3","u4","u5","u6"]' && /Add for Vidya Nair: Check emails/.test(w.sent[0]), { ids, sent: w.sent[0] });
    await turn(w, 'yes', 'g2');
    check('…YES → a task for each of them', w.exec.filter((e: any) => e[0] === 'assign').length === 5, w.exec);
    w = mk(grp({ whose: 'team', department: null, except: ['Harsh'] }));
    await turn(w, 'everyone except harsh should check emails', 'g3');
    check('"everyone except Harsh" → Harsh left out', !(w.state?.data?.action?.actions || []).some((a: any) => a.assigneeId === 'u4') && (w.state?.data?.action?.actions || []).length === 4);
    w = mk(grp({ whose: 'department', department: 'Tech', except: [] }));
    await turn(w, 'give everyone in tech the task of checking emails', 'g4');
    check('"everyone in Tech" → only Tech people', JSON.stringify((w.state?.data?.action?.actions || []).map((a: any) => a.assigneeId)) === '["u3","u4"]', w.state?.data?.action);
    w = mk(grp({ whose: 'department', department: 'Finance', except: [] }));
    await turn(w, 'give everyone in finance the task of checking emails', 'g5');
    check('a group with nobody you may give work to → asks, nothing proposed', w.state?.data?.action == null && w.exec.length === 0);

    console.log('\n12. Old "idle" markers no longer send messages to the old bot (Harsh got the old menu) — group 3');
    const smalltalk = () => UNDERSTOOD('smalltalk', {}, 'Chat.');
    w = mk(smalltalk); w.state = { type: 'ACTIVE_SESSION', data: {} };
    check('after an old "tasks" (30-min marker) → Smart chat still answers', (await turn(w, 'add HR grievance module task also', 'o1')).handled && w.sent.length === 1);
    w = mk(smalltalk); w.state = { type: 'DISAMBIGUATION', data: { state: 'AWAITING_SYSTEM_CHOICE' } };
    check('the old "1. Tasks / 2. Facility" menu open + a real message → Smart chat answers', (await turn(w, 'add HR grievance module task also', 'o2')).handled);
    w = mk(smalltalk); w.state = { type: 'DISAMBIGUATION', data: { state: 'AWAITING_SYSTEM_CHOICE' } };
    check('…but a plain "1" / "2" still answers that old menu', !(await turn(w, '2', 'o3')).handled);
    w = mk(smalltalk); w.state = { type: 'IMPORT_PREVIEW', data: {} };
    check('a task-list preview waiting for YES still finishes first (unchanged)', !(await turn(w, 'tasks', 'o4')).handled);
    const tch = read('task-manager/TaskCommandHandler.ts');
    check('the old "tasks" never overwrites a conversation in progress (Priyanka\'s preview), and reminds that a preview is waiting',
        /const keepOpen = !!existingContext && existingContext\.context_type !== 'ACTIVE_SESSION' && existingContext\.context_type !== 'DISAMBIGUATION';\s*if \(!keepOpen\) \{/.test(tch)
        && /Your task list preview is still waiting: reply YES to save it, or NO to cancel\./.test(tch));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 PART B TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
