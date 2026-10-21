/**
 * Owner 2026-10-21 — (1) a clear "add task ..." is saved straight away with undo (no "your list or someone?", no yes/no);
 * (2) "what is my team doing?" lists every task of each person, which is different from "how is my team doing?" (counts);
 * (3) a long reply is split into WhatsApp-sized messages. 100% OFFLINE: fake data, a scripted AI, recorders; nothing sent.
 * Sher's real chat: "add task follow up regarding Checklist" → two questions before it was saved (2026-10-21).
 * Run: npx tsx task-manager/tests/test_brain_direct_add.ts
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
    const D = await import('../brain/tasksDomain');
    const X = await import('../brain/execute');
    const R = await import('../brain/teamReport');
    const TX = await import('../brain/text');
    const { world } = await import('../brain/eval/worlds');
    const PHONE = '918433649199';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });
    const mkI = (intent: string, slots: any, summary: string) => ({ intent, slots, summary });
    const create = (assignee: string, title: string, assignees?: string[]) => mkI('create_tasks', { assignee, ...(assignees ? { assignees } : {}), tasks: [{ title, details: null }], date: null }, 'Add a task');

    // The scripted AI. "?" = it could not tell who the task is for (the old rule asked "your list or someone?").
    const interps = (msg: string): any => {
        const m = msg.toLowerCase().trim();
        if (/^add task follow up regarding checklist$/.test(m)) return create('?', 'Follow up regarding Checklist');
        if (/^assign a task about the audit$/.test(m)) return create('?', 'Audit');
        if (/^vidya$/.test(m)) return create('Vidya', 'Audit');
        if (/^assign vidya follow up checklist$/.test(m)) return create('Vidya', 'Follow up checklist');
        if (/^assign neha and vidya to collect id proofs$/.test(m)) return create('Neha', 'Collect ID proofs', ['Neha', 'Vidya']);
        return mkI('unknown', {}, 'Unclear');
    };
    const replyFor = (u: any) => {
        const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join(' ');
        return u.mustEndWithQuestion ? `Quick check: ${need}?` : `Okay: ${need}`;
    };
    const mk = (frontDoor = true) => {
        const w: any = { state: null, sent: [] as string[], exec: [] as any[], frontDoor };
        const llm = { complete: async (req: any) => {
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: replyFor(u) }), tokensIn: 1, tokensOut: 1 };
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...interps(u.message) }), tokensIn: 1, tokensOut: 1 };
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
                findCreated: async (_a: string, who: string) => `new-${who}`,
                deleteTask: async (a: string, id: string) => { w.exec.push(['delete', a, id]); },
            },
            reply: async (_p: string, t: string) => { w.sent.push(t); },
            audit: async () => undefined, seenBefore: () => false, markSeen: () => undefined,
        };
        return w;
    };
    let n = 0;
    const turn = async (w: any, text: string) => { const c = await L.claimSmartChat(body(text, `d${++n}`), w.io); if (c.background) await c.background(); return c; };
    const last = (w: any) => w.sent[w.sent.length - 1] || '';
    const saved = (w: any) => w.exec.filter((e: any[]) => e[0] === 'assign').map((e: any[]) => `${e[3]}→${e[2]}`);

    console.log('\n1. Sher\'s message: "add task follow up regarding Checklist" → saved on his own list, one reply');
    let w = mk();
    await turn(w, 'add task follow up regarding Checklist');
    check('saved for himself straight away (no "your list or someone?", no "is that right?")', JSON.stringify(saved(w)) === JSON.stringify(['Follow up regarding Checklist→u1']) && w.sent.length === 1, { exec: w.exec, sent: w.sent });
    check('nothing left waiting for an answer', !w.state?.data?.pending, w.state?.data);
    check('the reply offers undo', /undo\*? within 10 minutes/i.test(last(w)), last(w));
    await turn(w, 'undo');
    check('"undo" removes it', w.exec.some((e: any[]) => e[0] === 'delete' && e[2] === 'new-u1'), w.exec);

    console.log('\n2. "assign Vidya ..." (clear) → saved for Vidya straight away, with undo');
    w = mk();
    await turn(w, 'assign vidya follow up checklist');
    check('saved for Vidya, no yes/no', JSON.stringify(saved(w)) === JSON.stringify(['Follow up checklist→u2']) && !w.state?.data?.pending, { exec: w.exec, state: w.state?.data });
    check('the reply offers undo', /undo\*? within 10 minutes/i.test(last(w)), last(w));

    console.log('\n3. "assign ..." with nobody named → asks WHO (never guesses "me"); the answer saves it directly');
    w = mk();
    await turn(w, 'assign a task about the audit');
    check('asks who, nothing saved, request kept', saved(w).length === 0 && w.state?.data.pending?.kind === 'draft' && /\?/.test(last(w)), { sent: w.sent, state: w.state?.data });
    await turn(w, 'vidya');
    check('"vidya" → saved for Vidya without a second question', JSON.stringify(saved(w)) === JSON.stringify(['Audit→u2']) && !w.state?.data?.pending, { exec: w.exec, state: w.state?.data });

    console.log('\n4. Someone named who cannot get the work → still asks first (never silently left out)');
    w = mk();
    await turn(w, 'assign neha and vidya to collect id proofs');
    check('a preview naming Neha, nothing saved yet', saved(w).length === 0 && /Neha/.test(last(w)) && w.state?.data.pending?.kind === 'confirm', { sent: last(w), state: w.state?.data });

    console.log('\n5. "One front door" OFF (no undo) → the yes/no stays');
    w = mk(false);
    await turn(w, 'add task follow up regarding Checklist');
    check('a preview for his own list, nothing saved until yes', saved(w).length === 0 && w.state?.data.action?.assigneeId === 'u1' && w.state?.data.pending?.kind === 'confirm', { exec: w.exec, state: w.state?.data });
    await turn(w, 'yes');
    check('yes → saved', JSON.stringify(saved(w)) === JSON.stringify(['Follow up regarding Checklist→u1']), w.exec);

    console.log('\n6. Team: "what is my team doing?" (every task) vs "how is my team doing?" (counts)');
    const ctx: any = { ...world('default'), pending: null };
    const interp = (team_list: boolean): any => ({ intent: 'view_tasks', confidence: 0.95, language: 'en', ambiguities: [], clarifyQuestion: null, summary: 'Team', grounded: true,
        slots: D.tasksDomainWithTeam.validateSlots('view_tasks', { scope: 'team', person: null, department: null, team_list }, ctx) });
    const dList = D.tasksDomainWithTeam.decide(interp(true), ctx, {} as any) as any;
    const dProg = D.tasksDomainWithTeam.decide(interp(false), ctx, {} as any) as any;
    check('team_list true → the list view', dList.outcome === 'ACT' && dList.action.scope === 'team' && dList.action.list === true, dList);
    check('team_list false → the progress view (unchanged)', dProg.outcome === 'ACT' && dProg.action.scope === 'team' && !dProg.action.list, dProg);
    check('the AI is told the difference', D.tasksDomainWithTeam.intents.find(i => i.name === 'view_tasks')!.slots.includes('team_list'));
    const asked: boolean[] = [];
    const io: any = { readTeam: async (_me: string, list?: boolean) => { asked.push(!!list); return list ? 'LIST' : 'COUNTS'; } };
    const eL = await X.executeAction(dList.action, ctx, io, { relay: false, titles: {} });
    const eP = await X.executeAction(dProg.action, ctx, io, { relay: false, titles: {} });
    check('the list view reads the full list, the progress view the counts', JSON.stringify(asked) === JSON.stringify([true, false]) && eL?.values.data === 'LIST' && eP?.values.data === 'COUNTS', { asked, eL, eP });

    const members = [
        { name: 'Srushti Madhani', tasks: [
            { title: 'BGV pending cases', status: 'pending' as const, isCarriedForward: true, assignedDate: '2026-10-19' },
            { title: 'Onboarding', status: 'in_progress' as const, assignedDate: '2026-10-21' },
            { title: 'Offer letter to Priya', status: 'completed' as const, assignedDate: '2026-10-21' },
        ] },
        { name: 'Sanil Parab', tasks: [] },
        { name: 'Neeti Upadhyay', tasks: [{ title: 'Diwali count', status: 'pending' as const, assignedDate: '2026-10-21' }] },
    ];
    const list = R.buildTeamTaskList(members);
    check('every task of each person, with its status', /\*Srushti Madhani\* \(3\)/.test(list) && /• Onboarding: In progress/.test(list) && /• Offer letter to Priya: Done/.test(list) && /• Diwali count: To do/.test(list), list);
    check('carried forward shows where it came from', /• BGV pending cases: To do, from 19 Oct/.test(list), list);
    check('someone with nothing today is still listed', /\*Sanil Parab\*: no tasks today/.test(list), list);
    check('header counts people and tasks; carried-forward work comes first', list.startsWith('Your team today: 3 people, 4 tasks.') && list.indexOf('Srushti') < list.indexOf('Neeti'), list);
    const counts = R.buildTeamReport(members);
    check('the progress view stays counts only (no task names)', /Srushti Madhani: 1\/3 done/.test(counts) && !/Onboarding/.test(counts), counts);

    console.log('\n7. A long reply goes as a few WhatsApp messages, split between lines');
    const big = Array.from({ length: 300 }, (_, i) => `• Task number ${i + 1}: To do, from 19 Oct`).join('\n');
    const parts = TX.splitLongReply(big);
    check('more than one part, each at most 3800 characters', parts.length > 1 && parts.every(p => p.length <= 3800), parts.map(p => p.length));
    check('nothing lost, nothing cut mid-line', parts.join('\n') === big, null);
    check('a short reply is one message, untouched', JSON.stringify(TX.splitLongReply('Added.')) === JSON.stringify(['Added.']));
    const oneLine = 'word '.repeat(1200).trim();
    check('one very long line is split between words', TX.splitLongReply(oneLine).every(p => p.length <= 3800) && TX.splitLongReply(oneLine).join(' ').replace(/\s+/g, ' ') === oneLine);

    check('\nnothing in this test touched the network', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 DIRECT ADD + TEAM LIST TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
