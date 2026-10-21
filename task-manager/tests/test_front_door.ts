/**
 * Phase 3 — "One front door" (OFFLINE: fake data, a scripted AI, recorders in place of WhatsApp and the task functions;
 * no network, no database, no message can be sent from this file).
 * Run: npx tsx task-manager/tests/test_front_door.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
delete process.env.WHATSAPP_FRONT_DOOR_ENABLED;

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const F = await import('../brain/frontDoor');
    const L = await import('../brain/live');
    const { world } = await import('../brain/eval/worlds');

    console.log('\n1. What counts as an EXACT command (everything else goes to the AI as before)');
    const p = (s: string) => JSON.stringify(F.parseExactCommand(s));
    check('"done 2", "Done 2.", "finished 2" → done [2]', p('done 2') === '{"kind":"done","numbers":[2]}' && p('Done 2.') === p('done 2') && p('finished 2') === p('done 2'));
    check('"done 1 and 3", "done 1,3", "done 1 & 3" → done [1,3]', [p('done 1 and 3'), p('done 1,3'), p('done 1 & 3')].every(x => x === '{"kind":"done","numbers":[1,3]}'), [p('done 1 and 3'), p('done 1,3')]);
    check('"done all", "all done", "done-all" → done_all', ['done all', 'all done', 'done-all', 'complete all'].every(s => F.parseExactCommand(s)?.kind === 'done_all'));
    check('"tasks", "my tasks", "status" → view', ['tasks', 'my tasks', 'status', "today's tasks"].every(s => F.parseExactCommand(s)?.kind === 'view'));
    check('"undo", "undo that", "wapas karo", "galti se" → undo', ['undo', 'undo that', 'wapas karo', 'galti se', 'Undo!'].every(s => F.parseExactCommand(s)?.kind === 'undo'));
    check('NOT exact: sentences, extra words, bare "done", zero, typos', ['done 2 and call the vendor', 'i am done', 'done', 'done 0', 'show my tasks please', 'undo the carpet one', 'dne 2', 'done two']
        .every(s => F.parseExactCommand(s) === null), ['done 0', 'dne 2'].map(p));

    console.log('\n2. Turning an exact command into an action');
    const ctx: any = { ...world('default'), pending: null, recent: [] };
    const plan = (s: string) => F.planExact(F.parseExactCommand(s)!, ctx);
    check('"done 1" → complete task t1 (no YES)', JSON.stringify(plan('done 1')) === '{"kind":"act","action":{"type":"complete_tasks","taskIds":["t1"]}}', plan('done 1'));
    check('"done 1 and 6" → only the open one (6 is already done)', JSON.stringify((plan('done 1 and 6') as any).action.taskIds) === '["t1"]');
    check('"done 6" (already done) → a plain reply, nothing changed', (plan('done 6') as any).kind === 'reply' && /already done/.test((plan('done 6') as any).text));
    check('"done 9" (not on the list) → NOT handled here, the AI explains', plan('done 9') === null);
    check('"done all" → every open task (not the finished one)', JSON.stringify((plan('done all') as any).action.taskIds) === '["t1","t2","t3","t4","t5"]');
    check('"done all" with nothing open → the AI handles it', F.planExact({ kind: 'done_all' }, { ...ctx, tasks: [ctx.tasks[5]] }) === null);
    check('"tasks" → the numbered list, with status marks', (plan('tasks') as any).kind === 'reply' && /1\. Carpet Installation PO ⏳/.test((plan('tasks') as any).text) && /6\. Agreement Followup ✅/.test((plan('tasks') as any).text));
    check('"tasks" with no tasks → says so', /no tasks today/.test((F.planExact({ kind: 'view' }, { ...ctx, tasks: [] }) as any).text));

    console.log('\n3. Remembering a change for "undo"');
    const now = new Date('2026-10-11T10:00:00.000Z');
    const c1 = F.changeFromAction({ type: 'complete_tasks', taskIds: ['t1', 't2', 't6'] }, ctx, now)!;
    check('completion: remembers each task\'s status BEFORE (to do / in progress); an already-done one is skipped',
        JSON.stringify(c1.items) === JSON.stringify([
            { kind: 'status', taskId: 't1', title: 'Carpet Installation PO', before: 'pending', after: 'completed' },
            { kind: 'status', taskId: 't2', title: 'Kone Lift AMC Renewal', before: 'in_progress', after: 'completed' }]), c1.items);
    const c2 = F.changeFromAction({ type: 'create_tasks', assigneeId: 'u2', date: '2026-10-11', tasks: [{ title: 'Call vendor', details: null }] }, ctx, now)!;
    check('new tasks: remembered by who / title / date', c2.items[0].kind === 'created' && (c2.items[0] as any).assigneeId === 'u2');
    const c3 = F.changeFromAction({ type: 'hand_over_task', taskId: 't1', toId: 'u2' }, ctx, now)!;
    check('hand-over: remembered only to explain who to ask', c3.items[0].kind === 'handover' && (c3.items[0] as any).toName === 'Vidya Nair');
    check('a progress note ("working on it") → back to the old status', F.changeFromAction({ type: 'progress_update', state: 'working', taskIds: ['t1'], note: null }, ctx, now)!.items[0].kind === 'status');
    check('"stuck" changes no status → nothing to undo', F.changeFromAction({ type: 'progress_update', state: 'blocked', taskIds: ['t1'], note: null }, ctx, now) === null);
    check('a read → nothing to undo', F.changeFromAction({ type: 'view_tasks', scope: 'self', personId: null, department: null }, ctx, now) === null);
    check('stored JSON is validated when read back; junk is dropped', F.normalizeChange({ at: 'x', items: [{ kind: 'status', taskId: 't1', title: 'a', before: 'pending', after: 'completed' }, { kind: 'evil' }] })!.items.length === 1 && F.normalizeChange('nope') === null);

    console.log('\n4. Undo');
    const db: Record<string, string> = { t1: 'completed', t2: 'pending' };
    const calls: any[] = [];
    const uio: any = {
        currentStatus: async (id: string) => db[id] ?? null,
        setStatus: async (a: string, id: string, s: string) => { calls.push(['setStatus', a, id, s]); db[id] = s; },
        findCreated: async (_a: string, _who: string, title: string) => (title === 'Call vendor' ? 'n1' : null),
        deleteTask: async (a: string, id: string) => { calls.push(['delete', a, id]); },
    };
    let r = await F.runUndo(c1, 'u1', uio, new Date('2026-10-11T10:05:00.000Z'));
    check('within 10 min: a task still as we left it goes back; one changed since is left alone', JSON.stringify(calls) === '[["setStatus","u1","t1","pending"]]' && r.undone === 1 && /Carpet Installation PO → back to to do/.test(r.text) && /Kone Lift AMC Renewal \(changed since\)/.test(r.text), { calls, r });
    calls.length = 0;
    r = await F.runUndo(c2, 'u1', uio, new Date('2026-10-11T10:05:00.000Z'));
    check('a new task, still untouched, is removed (through the permission-checked delete)', JSON.stringify(calls) === '[["delete","u1","n1"]]' && /Call vendor → removed/.test(r.text));
    r = await F.runUndo(c3, 'u1', uio, new Date('2026-10-11T10:05:00.000Z'));
    check('a hand-over is not undone; the bot says who to ask', r.undone === 0 && /ask Vidya Nair to give it back/.test(r.text));
    calls.length = 0;
    r = await F.runUndo(c1, 'u1', uio, new Date('2026-10-11T10:11:00.000Z'));
    check('after 10 minutes → refused, nothing touched', calls.length === 0 && /more than 10 minutes ago/.test(r.text));
    check('nothing remembered → "nothing to undo"', /nothing to undo/.test((await F.runUndo(null, 'u1', uio)).text));
    r = await F.runUndo(c1, 'u1', { ...uio, currentStatus: async () => 'completed', setStatus: async () => { throw new Error('not allowed'); } }, new Date('2026-10-11T10:05:00.000Z'));
    check('a permission refusal → reported per task, no crash', r.undone === 0 && /not allowed or failed/.test(r.text));

    console.log('\n5. Through the real Smart chat code');
    const PHONE = '918433649199';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });
    const mk = (over: any = {}) => {
        const w: any = { frontDoor: false, aiDown: false, state: null, sent: [] as string[], exec: [] as any[], understand: 0, tasks: JSON.parse(JSON.stringify(world('default').tasks)), ...over };
        const llm = { complete: async (req: any) => {
            if (w.aiDown) throw new Error('HTTP 503');
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) {
                const need = (u.placeholders || []).filter((x: any) => x.required).map((x: any) => x.name).join(' ');
                return { text: JSON.stringify({ text: `Okay: ${need}` }), tokensIn: 1, tokensOut: 1 };
            }
            w.understand++;
            const spec = /done 2/.test(u.message) ? { intent: 'complete_tasks', slots: { which: { all: false, numbers: [2], hints: [] } }, summary: 'Mark task 2 as done' }
                : u.message === 'yes' ? { intent: 'answer_pending', slots: { answer: 'yes', pick: null, instruction: null }, summary: 'Yes' }
                : { intent: 'smalltalk', slots: {}, summary: 'Chat' };
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...spec }), tokensIn: 1, tokensOut: 1 };
        } };
        w.io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp,
            checkAccess: async () => ({ allowed: true }), facilityActive: async () => false,
            getState: async () => w.state, setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { w.state = null; }, openPingPending: async () => null,
            buildContext: async (_e: any, _p: string, opts: any) => ({ ...world('default'), tasks: JSON.parse(JSON.stringify(w.tasks)), pending: opts.pending, recent: opts.recent }),
            frontDoorOn: async () => w.frontDoor,
            brain: { llm },
            exec: {
                setStatus: async (a: string, id: string, s: string) => { w.exec.push(['setStatus', a, id, s]); const t = w.tasks.find((x: any) => x.id === id); if (t) t.status = s; },
                assign: async () => {}, handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '',
            },
            undo: {
                currentStatus: async (id: string) => w.tasks.find((x: any) => x.id === id)?.status ?? null,
                setStatus: async (a: string, id: string, s: string) => { w.exec.push(['undo', a, id, s]); const t = w.tasks.find((x: any) => x.id === id); if (t) t.status = s; },
                findCreated: async () => null, deleteTask: async () => {},
            },
            reply: async (_p: string, t: string) => { w.sent.push(t); },
            audit: async () => {}, seenBefore: () => false, markSeen: () => {},
        };
        return w;
    };
    const turn = async (w: any, text: string, id: string) => { const c = await L.claimSmartChat(body(text, id), w.io); if (c.background) await c.background(); return c; };

    let w = mk();
    await turn(w, 'done 2', 'a1');
    check('switch OFF → "done 2" goes to the AI and asks YES, exactly as before', w.understand === 1 && w.exec.length === 0 && w.state?.data?.pending?.kind === 'confirm' && !('lastChange' in (w.state?.data || {})), { u: w.understand, st: w.state?.data });

    w = mk({ frontDoor: true });
    await turn(w, 'done 2', 'b1');
    check('switch ON → "done 2" happens at once: no AI call, no YES', w.understand === 0 && JSON.stringify(w.exec) === '[["setStatus","u1","t2","completed"]]', w.exec);
    check('…the reply says what was done and offers undo', /undo/.test(w.sent[0]) && /Kone Lift AMC Renewal/.test(w.sent[0]), w.sent[0]);
    check('…and remembers it for undo (status before = in progress)', w.state.data.lastChange?.items?.[0]?.before === 'in_progress');
    await turn(w, 'undo', 'b2');
    check('"undo" → back to in progress, through the checked function', JSON.stringify(w.exec[1]) === '["undo","u1","t2","in_progress"]' && /Undone/.test(w.sent[1]) && w.understand === 0, { exec: w.exec, sent: w.sent[1] });
    check('…an undo is used up (a second "undo" has nothing to reverse)', (await turn(w, 'undo', 'b3'), /nothing to undo/.test(w.sent[2])));
    await turn(w, 'tasks', 'b4');
    check('"tasks" → the list, no AI call', w.understand === 0 && /Your tasks today/.test(w.sent[3]));
    await turn(w, 'done 9', 'b5');
    check('"done 9" (not on the list) → the AI handles it as before', w.understand === 1);

    w = mk({ frontDoor: true });
    await turn(w, 'please mark the lift one done', 'c0');   // the AI path: not exact → AI → (scripted) smalltalk
    w.state = { type: L.LIVE_STATE_TYPE, data: { recent: [], pending: { kind: 'confirm', summary: 'Mark task 2 as done' }, action: { type: 'complete_tasks', taskIds: ['t2'] }, originalSummary: 'Mark task 2 as done', pickOptions: [], relay: false, titles: {} } };
    await turn(w, 'yes', 'c1');
    check('a change confirmed with YES through the AI path is ALSO remembered for undo', JSON.stringify(w.exec) === '[["setStatus","u1","t2","completed"]]' && w.state.data.lastChange?.items?.[0]?.taskId === 't2', w.state.data);
    w.state.data.pending = { kind: 'confirm', summary: 'x' }; w.state.data.action = { type: 'complete_tasks', taskIds: ['t1'] };
    await turn(w, 'done 1', 'c2');
    check('while a question is open, even "done 1" is NOT run by the shortcut (the open question is answered first)', !w.exec.some((e: any) => e[2] === 't1'), w.exec);

    w = mk({ frontDoor: true, aiDown: true });
    let c = await turn(w, 'can you help me with the lift thing', 'd1');
    check('AI down, switch ON → a short help line, no 1/2 menu', c.handled === true && w.sent[0] === F.AI_DOWN_HELP, w.sent);
    c = await L.claimSmartChat(body('team', 'd2'), w.io);
    check('AI down, switch ON → an old exact command ("team") still goes to the old bot', c.handled === false);
    await turn(w, 'done 1', 'd3');
    check('AI down, switch ON → "done 1" still works (no AI needed)', w.exec.some((e: any) => e[2] === 't1' && e[3] === 'completed'));
    w = mk({ aiDown: true });
    c = await L.claimSmartChat(body('can you help me', 'e1'), w.io);
    check('AI down, switch OFF → exactly as before (the old bot answers)', c.handled === false && w.sent.length === 0);

    console.log('\n6. Wiring');
    const sw = read('task-manager/BotSwitches.ts');
    check('"One front door" is a Task Access panel switch, OFF by default', /'frontDoor'/.test(sw) && /frontDoor: c\.frontDoorEnabled === true/.test(sw));
    check('the panel and the admin API know it', /key: 'frontDoor'/.test(read('frontend/components/task-manager/TaskAccessPanel.tsx')) && /'frontDoor'[^\]]*\]\.includes\(body\.feature\)/.test(read('app/api/task-manager/access/route.ts')));
    check('the real undo uses the Tasks-tab functions (permissions re-checked)', /WorkspaceService\.setStatus\(actorId, \{ taskId, status \}\)/.test(read('task-manager/brain/live.ts')) && /WorkspaceService\.deleteTask\(actorId, \{ taskId \}\)/.test(read('task-manager/brain/live.ts')));
    // 2026-10-14: tasksDomain may now SAY "Reply undo…" after a completion; what must not change is the AI's intent list.
    check('the AI\'s instructions are unchanged (no new intent was added)', !/undo/i.test(read('task-manager/brain/prompt.ts')) && !/name: 'undo'/.test(read('task-manager/brain/tasksDomain.ts')) && !/'undo'/.test(read('task-manager/brain/types.ts').split('FACILITY_INTENTS')[0]));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 FRONT DOOR TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
