/**
 * Owner 2026-10-20 — lock / unlock tasks from the smart chat (100% OFFLINE: fake data, a scripted AI, recorders; nothing is sent).
 *   "lock task 2" → preview → yes → the same lock function as the Tasks tab; "unlock task 1"; "which tasks are locked?";
 *   already locked / not locked / a team fixed task → said so, nothing changed.
 * Run: npx tsx task-manager/tests/test_brain_lock.ts
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
    const lockI = (action: string, numbers: number[] = []) => mkI('lock_task', { which: { all: false, numbers, hints: [] }, action }, 'Lock');
    const interps = (msg: string): any => {
        const m = msg.toLowerCase().trim();
        if (m === 'yes') return mkI('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Yes');
        if (m === 'lock task 2') return lockI('lock', [2]);
        if (m === 'unlock task 1') return lockI('unlock', [1]);
        if (m === 'lock task 1') return lockI('lock', [1]);
        if (m === 'unlock task 3') return lockI('unlock', [3]);
        if (m === 'lock task 5') return lockI('lock', [5]);
        if (m === 'which tasks are locked?') return lockI('list');
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
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...interps(u.message) }), tokensIn: 10, tokensOut: 8 };
        } };
        w.io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp, checkAccess: async () => ({ allowed: true }),
            facilityActive: async () => false,
            getState: async () => w.state,
            setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { w.state = null; },
            buildContext: async (_e: any, _p: string, opts: any) => { const b = world('default'); return { ...b, pending: opts.pending, recent: opts.recent, tasks: b.tasks.map((t: any) => t.id === 't1' ? { ...t, locked: true } : t.id === 't5' ? { ...t, teamFixed: true } : t) }; },
            brain: { llm },
            exec: {
                setStatus: async () => undefined,
                assign: async (a: string, i: any) => { w.exec.push(['assign', a, i.targetUserId, i.title, i.description]); },
                handOver: async () => { w.exec.push(['handover']); return { toName: 'x' }; },
                addNote: async (a: string, taskId: string, text: string) => { w.exec.push(['note', a, taskId, text]); },
                setLocked: async (a: string, id: string, l: boolean) => { w.exec.push(['lock', a, id, l]); },
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

    console.log('\n1. Lock a task');
    let w = mk();
    await turn(w, 'lock task 2');
    check('preview to lock task 2, nothing changed yet', w.state?.data.action?.type === 'lock_tasks' && w.state.data.action.lock === true && JSON.stringify(w.state.data.action.taskIds) === '["t2"]' && w.exec.length === 0, w.state?.data.action);
    await turn(w, 'yes');
    check('yes → locked through the same lock function as the Tasks tab', JSON.stringify(w.exec) === JSON.stringify([['lock', 'u1', 't2', true]]), w.exec);

    console.log('\n2. Unlock a task');
    w = mk();
    await turn(w, 'unlock task 1');
    await turn(w, 'yes');
    check('unlock task 1 (it is locked) → unlocked after yes', JSON.stringify(w.exec) === JSON.stringify([['lock', 'u1', 't1', false]]), w.exec);

    console.log('\n3. Nothing to do / not allowed');
    w = mk(); await turn(w, 'lock task 1');
    check('already locked → said so, nothing changed', !w.state?.data.action && w.exec.length === 0 && w.state?.data.lastOutcome === 'REFUSE', w.state?.data);
    w = mk(); await turn(w, 'unlock task 3');
    check('not locked → said so, nothing changed', !w.state?.data.action && w.exec.length === 0 && w.state?.data.lastOutcome === 'REFUSE', w.state?.data);
    w = mk(); await turn(w, 'lock task 5');
    check('a team fixed task → cannot be changed here', !w.state?.data.action && w.exec.length === 0 && w.state?.data.lastOutcome === 'REFUSE', w.state?.data);

    console.log('\n4. Which tasks are locked?');
    w = mk(); await turn(w, 'which tasks are locked?');
    check('lists the locked task and the team fixed one, changes nothing', /Carpet Installation PO/.test(last(w)) && /Single Disc Machine/.test(last(w)) && w.exec.length === 0, last(w));

    check('\nnothing in this test touched the network', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 LOCK (SMART CHAT) TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
