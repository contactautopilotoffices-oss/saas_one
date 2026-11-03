/**
 * Owner 2026-10-21 — when the bot is unsure but the person seems to be adding a task, it SUGGESTS the task in their own
 * words; a clear answer saves it straight away with undo (100% OFFLINE: fake data, a scripted AI, recorders; nothing sent).
 * Sanil's real messages: "Task. / Add Sailee rest FNF" → "couldn't find anyone named Sailee" (2026-10-21).
 * Run: npx tsx task-manager/tests/test_brain_suggest.ts
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
    const PHONE = '918433649199';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });
    const mkI = (intent: string, slots: any, summary: string) => ({ intent, slots, summary });
    const create = (assignee: string, title: string) => mkI('create_tasks', { assignee, tasks: [{ title, details: null }], date: null }, 'Add a task');

    // A scripted AI that makes Sanil's mistake: it reads "Sailee" as the person to give the task to.
    const interps = (msg: string, pending: string): any => {
        const m = msg.toLowerCase().trim();
        const suggestion = /add task: sailee rest fnf/i.test(pending);
        if (suggestion && /vidya/.test(m)) return create('Vidya', 'Sailee rest FNF');            // "assign it to Vidya"
        if (suggestion && /zorro/.test(m)) return create('Zorro', 'Sailee rest FNF');            // a person who does not exist
        if (/sailee rest fnf/.test(m)) return create('Sailee', 'rest FNF');                     // the original mistake
        if (/what tasks/.test(m)) return mkI('unknown', {}, 'Unclear');
        if (/assign task to zorro/.test(m)) return create('Zorro', 'Conduct induction');
        return mkI('unknown', {}, 'Unclear');
    };
    const replyFor = (u: any) => {
        const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join(' ');
        return u.mustEndWithQuestion ? `Quick check: ${need}` : `Okay: ${need}`;
    };
    const mk = (frontDoor = true) => {
        const w: any = { state: null, sent: [] as string[], exec: [] as any[], frontDoor };
        const llm = { complete: async (req: any) => {
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: replyFor(u) }), tokensIn: 1, tokensOut: 1 };
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...interps(u.message, String(u.context?.pending || '')) }), tokensIn: 1, tokensOut: 1 };
        } };
        w.io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp,
            checkAccess: async () => ({ allowed: true }), facilityActive: async () => false,
            getState: async () => w.state, setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { w.state = null; }, openPingPending: async () => null,
            buildContext: async (_e: any, _p: string, opts: any) => ({ ...world('default'), pending: opts.pending, recent: opts.recent }),
            frontDoorOn: async () => w.frontDoor,
            brain: { llm },
            exec: {
                setStatus: async () => undefined, handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '',
                assign: async (a: string, i: any) => { w.exec.push(['assign', a, i.targetUserId, i.title]); },
            },
            undo: {
                currentStatus: async () => 'pending', setStatus: async () => undefined,
                findCreated: async (_a: string, who: string, title: string) => (title === 'Sailee rest FNF' ? `new-${who}` : null),
                deleteTask: async (a: string, id: string) => { w.exec.push(['delete', a, id]); },
            },
            reply: async (_p: string, t: string) => { w.sent.push(t); },
            audit: async () => undefined, seenBefore: () => false, markSeen: () => undefined,
        };
        return w;
    };
    let n = 0;
    const turn = async (w: any, text: string) => { const c = await L.claimSmartChat(body(text, `s${++n}`), w.io); if (c.background) await c.background(); return c; };
    const last = (w: any) => w.sent[w.sent.length - 1] || '';
    const SANIL = 'Task.\n\nAdd Sailee rest FNF';

    console.log('\n1. Unsure → the bot suggests the task in his own words');
    let w = mk();
    await turn(w, SANIL);
    check('asks "did you want to add this task?" showing "Sailee rest FNF" (no "couldn\'t find Sailee")', /Sailee rest FNF/.test(last(w)) && !/couldn.?t find/i.test(last(w)) && w.exec.length === 0, w.sent);
    check('the suggestion is remembered for the next reply', w.state?.data.pending?.kind === 'draft' && w.state.data.pending.suggested === 'Sailee rest FNF', w.state?.data.pending);

    console.log('\n2. "Add task" → saved on his own list straight away, with undo');
    await turn(w, 'Add task');
    check('saved for himself, no second question', JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'u1', 'Sailee rest FNF']]), w.exec);
    check('the reply offers undo', /undo\*? within 10 minutes/i.test(last(w)), last(w));
    await turn(w, 'undo');
    check('"undo" removes the task that was just added', w.exec.some((e: any[]) => e[0] === 'delete' && e[2] === 'new-u1'), w.exec);

    console.log('\n3. "assign it to Vidya" → saved for Vidya straight away (the intent is clear)');
    w = mk();
    await turn(w, SANIL);
    await turn(w, 'assign it to vidya');
    check('saved for Vidya, no second question', JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'u2', 'Sailee rest FNF']]) && !w.state?.data.pending, { exec: w.exec, state: w.state?.data });
    check('the reply offers undo', /undo\*? within 10 minutes/i.test(last(w)), last(w));
    await turn(w, 'undo');
    check('"undo" removes Vidya\'s task (the server then tells her it was removed)', w.exec.some((e: any[]) => e[0] === 'delete' && e[2] === 'new-u2'), w.exec);

    console.log('\n4. Still unclear → nothing saved, the suggestion stays');
    w = mk();
    await turn(w, SANIL);
    await turn(w, 'give it to zorro');
    check('a person who does not exist → asks again, nothing saved', w.exec.length === 0 && w.state?.data.pending?.suggested === 'Sailee rest FNF', { exec: w.exec, state: w.state?.data });

    console.log('\n5. Only when it looks like adding a task');
    w = mk();
    await turn(w, 'what tasks did i miss?');
    check('a question is never turned into a suggested task', !w.state?.data?.pending?.suggested && w.exec.length === 0, w.state?.data);
    w = mk();
    await turn(w, 'assign task to zorro to conduct induction');
    check('"assign … to <unknown name>" → asks who, never a suggested task', !w.state?.data?.pending?.suggested && w.exec.length === 0, w.state?.data);
    check('the title helper keeps his words and drops the command words', L.suggestedTitle(SANIL) === 'Sailee rest FNF' && L.suggestedTitle('Need to add Task') === null && L.suggestedTitle('add task: call the vendor') === 'call the vendor' && L.suggestedTitle('what is pending?') === null);

    console.log('\n6. Without undo ("One front door" OFF) the normal yes/no preview is kept');
    w = mk(false);
    await turn(w, SANIL);
    await turn(w, 'assign it to vidya');
    check('nothing is saved without a yes when undo is not available', w.exec.length === 0 && w.state?.data.pending?.kind === 'confirm', { exec: w.exec, state: w.state?.data });

    check('\nnothing in this test touched the network', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 SUGGEST-A-TASK TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
