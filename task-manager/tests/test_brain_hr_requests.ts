/**
 * Owner 2026-10-19 — the HR team's requests for the smart chat (100% OFFLINE: fake data, a scripted AI, a RECORDER in place of
 * WhatsApp and of the task functions; no network, no real database, no message can be sent from this file).
 *   - one task for several people ("assign Parab and Neeti to conduct induction")
 *   - a list with a different person on each line
 *   - the bot keeps an unfinished request after its question, so "both" / "assign it to …" finishes it
 *   - a plain piece of work with no "add task" → "your list, or assign it?"
 *   - answers by meaning ("haan kar do", "rehne do"), a side question never drops the request, 30 tasks per message
 * Run: npx tsx task-manager/tests/test_brain_hr_requests.ts
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
    const T = await import('../brain/types');

    const PHONE = '918433649199';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });

    // ── a scripted AI: answers like the real one should, for exactly the messages below ────────────
    const mkI = (intent: string, slots: any, summary: string, extra: any = {}) => ({ intent, slots, summary, ...extra });
    const create = (slots: any, summary = 'Add tasks') => mkI('create_tasks', { date: null, ...slots }, summary);
    const interps = (msg: string, pending: string): any => {
        const m = msg.toLowerCase(), has = (s: string) => m.includes(s);
        const draft = pending.startsWith('UNFINISHED REQUEST');
        // edits replayed by the bot ("<their words>. Change of mind: …")
        if (has('change of mind') && has('remove 2')) return create({ assignee: 'me', tasks: [
            { title: 'Meeting with hampers vendors', details: null, assignees: ['Vidya'] },
            { title: 'Talk to alpine team about govt schemes', details: null, assignees: ['Vidya'] },
        ] });
        // answers to an UNFINISHED request (rule D): the whole request, earlier words + this answer
        if (draft && has('both')) return create({ assignee: '', assignees: ['Vidya', 'Dipti'], tasks: [{ title: 'Conduct induction', details: null }] });
        if (draft && has('assign it to suraj')) return create({ assignee: 'Suraj', tasks: [{ title: 'Event feedback for navratri event', details: null }] });
        if (draft && has('for me')) return create({ assignee: 'me', tasks: [{ title: 'Event feedback for navratri event', details: null }] });
        if (draft && has('rehne do')) return mkI('answer_pending', { answer: 'no', pick: null, instruction: null }, 'Drop it');
        if (has('show my tasks')) return mkI('view_tasks', { scope: 'self', person: null, department: null }, 'Show my tasks');
        if (has('haan kar do')) return mkI('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Yes');
        if (has('remove 2')) return mkI('answer_pending', { answer: 'edit', pick: null, instruction: 'remove 2' }, 'Remove line 2');
        // fresh requests
        if (has('vidya and suraj to conduct induction')) return create({ assignee: '', assignees: ['Vidya', 'Suraj'], tasks: [{ title: 'Conduct induction', details: null }] });
        if (has('vidya and dipti to conduct induction')) return { ...create({ assignee: 'Vidya', tasks: [{ title: 'Conduct induction', details: null }] }), ambiguities: ['both Vidya and Dipti, or one of them?'] };
        if (has('meeting with hampers vendors')) return create({ assignee: 'me', tasks: [
            { title: 'Meeting with hampers vendors', details: null, assignees: ['Vidya'] },
            { title: 'Review quotation of vendors', details: null, assignees: ['Suraj'] },
            { title: 'Talk to alpine team about govt schemes', details: 'check their availability', assignees: ['Vidya'] },
            { title: 'Talk to mehul about alpine meeting', details: null, assignees: ['Dipti'] },
        ] });
        if (has('neha and vidya')) return create({ assignee: '', assignees: ['Neha', 'Vidya'], tasks: [{ title: 'Collect ID proofs', details: null }] });
        if (has('event feedback for navratri event')) return create({ assignee: '?', tasks: [{ title: 'Event feedback for navratri event', details: null }] });
        if (has('thirty tasks')) return create({ assignee: 'me', tasks: Array.from({ length: 30 }, (_, i) => ({ title: `Thirty tasks item ${i + 1}`, details: null })) });
        if (has('thirtyone tasks')) return create({ assignee: 'me', tasks: Array.from({ length: 31 }, (_, i) => ({ title: `Thirtyone tasks item ${i + 1}`, details: null })) });
        return mkI('smalltalk', {}, 'Said hello');
    };
    const replyFor = (u: any) => {
        const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join(' ');
        return u.mustEndWithQuestion ? `Quick check, is this right? ${need}` : `Okay, here you go: ${need}`;
    };

    // ── a fake world (same shape as the Phase 4 test) ───────────────────────────────────────────
    const mk = () => {
        const w: any = { state: null as null | { type: string; data: any }, sent: [] as string[], exec: [] as any[], seen: new Set<string>(), prompts: [] as any[] };
        const llm = { complete: async (req: any) => {
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: replyFor(u) }), tokensIn: 5, tokensOut: 5 };
            w.prompts.push(u);
            const spec = interps(u.message, String(u.context?.pending || ''));
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...spec }), tokensIn: 10, tokensOut: 8 };
        } };
        w.io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp, checkAccess: async () => ({ allowed: true }),
            facilityActive: async () => false,
            getState: async () => w.state,
            setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { w.state = null; },
            buildContext: async (_e: any, _p: string, opts: any) => ({ ...world('default'), pending: opts.pending, recent: opts.recent }),
            brain: { llm },
            exec: {
                setStatus: async () => undefined,
                assign: async (a: string, i: any) => { w.exec.push(['assign', a, i.targetUserId, i.title]); },
                alertAssigned: async (a: string, to: string, titles: string[]) => { w.exec.push(['alert', to, titles.length]); },
                handOver: async () => ({ toName: 'x' }),
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
    const assigned = (w: any) => w.exec.filter((e: any[]) => e[0] === 'assign').map((e: any[]) => `${e[3]}→${e[2]}`).sort();
    const last = (w: any) => w.sent[w.sent.length - 1] || '';

    console.log('\n1. One task for several people');
    let w = mk();
    await turn(w, 'assign task to vidya and suraj to conduct induction');
    check('ONE preview listing the task for BOTH people, nothing saved yet', w.exec.length === 0 && /Conduct induction → Vidya Nair/.test(last(w)) && /Conduct induction → Suraj Verma/.test(last(w)), w.sent);
    check('the preview is waiting for a confirmation (no question about "both")', w.state?.data.pending?.kind === 'confirm' && w.state.data.action?.type === 'batch');
    await turn(w, 'haan kar do');
    check('"haan kar do" → both tasks saved, one per person', JSON.stringify(assigned(w)) === JSON.stringify(['Conduct induction→u2', 'Conduct induction→u5']), w.exec);
    check('nothing left waiting afterwards', !w.state?.data.pending);

    console.log('\n2. A list with a different person on each line');
    w = mk();
    await turn(w, '1. meeting with hampers vendors - vidya\n2. review quotation of vendors - suraj\n3. talk to alpine team about govt schemes - check their availability - vidya\n4. talk to mehul about alpine meeting - dipti');
    check('preview numbers EVERY line with its person', /1\. Meeting with hampers vendors → Vidya Nair/.test(last(w)) && /Review quotation of vendors → Suraj Verma/.test(last(w)) && /Talk to mehul about alpine meeting → Dipti Rao/.test(last(w)), w.sent);
    check('the person\'s own words are kept for edits (the whole list)', /hampers vendors/.test(w.state?.data.originalSummary || '') && /dipti/.test(w.state?.data.originalSummary || ''), w.state?.data.originalSummary);
    await turn(w, 'haan kar do');
    check('yes → all 4 tasks saved for the right people', JSON.stringify(assigned(w)) === JSON.stringify(['Meeting with hampers vendors→u2', 'Review quotation of vendors→u5', 'Talk to alpine team about govt schemes - check their availability→u2', 'Talk to mehul about alpine meeting→u6']), assigned(w));
    check('Vidya\'s two tasks → ONE grouped alert, not two', w.exec.filter((e: any[]) => e[0] === 'alert' && e[1] === 'u2' && e[2] === 2).length === 1, w.exec);

    console.log('\n3. Change on a list preview ("remove 2")');
    w = mk();
    await turn(w, '1. meeting with hampers vendors - vidya\n2. review quotation of vendors - suraj\n3. talk to alpine team about govt schemes - check their availability - vidya\n4. talk to mehul about alpine meeting - dipti');
    await turn(w, 'remove 2');
    const replay = w.prompts[w.prompts.length - 1]?.message || '';
    check('the change is applied to the person\'s FULL list (not a one-line summary)', /hampers vendors/.test(replay) && /review quotation/.test(replay) && /Change of mind: remove 2/.test(replay), replay);
    check('a new preview without line 2', !/Review quotation/.test(last(w)) && /Meeting with hampers vendors/.test(last(w)), last(w));

    console.log('\n4. The bot never forgets its own question (the "both" bug)');
    w = mk();
    await turn(w, 'assign task to vidya and dipti to conduct induction');
    check('the AI was unsure → the bot asks, and KEEPS the request as unfinished', w.state?.data.pending?.kind === 'draft' && /conduct induction/.test(w.state.data.pending.request) && w.exec.length === 0, w.state?.data);
    check('the question the bot asked is remembered (just the question, not the whole reply)', !!w.state?.data.pending?.question && last(w).startsWith(w.state.data.pending.question) && w.state.data.pending.question.endsWith('?'), w.state?.data.pending);
    await turn(w, 'both');
    const p4 = w.prompts[w.prompts.length - 1]?.context?.pending || '';
    check('"both" reaches the AI WITH the unfinished request and the question', /UNFINISHED REQUEST/.test(p4) && /conduct induction/.test(p4), p4);
    check('→ a preview for both people (it did NOT start over or reply with small talk)', /Conduct induction → Vidya Nair/.test(last(w)) && /Conduct induction → Dipti Rao/.test(last(w)), w.sent);
    await turn(w, 'haan kar do');
    check('→ saved for both', JSON.stringify(assigned(w)) === JSON.stringify(['Conduct induction→u2', 'Conduct induction→u6']), assigned(w));

    console.log('\n5. Plain work with no "add task" → your list, or assign it?');
    w = mk();
    await turn(w, 'event feedback for navratri event');
    check('the bot asks own list or assign, nothing saved, request kept', w.exec.length === 0 && w.state?.data.pending?.kind === 'draft' && /\?/.test(last(w)), { sent: w.sent, state: w.state?.data });
    await turn(w, 'show my tasks');
    check('a side question is answered and the unfinished request is KEPT', w.state?.data.pending?.kind === 'draft' && /navratri/.test(w.state.data.pending.request), w.state?.data);
    await turn(w, 'assign it to suraj');
    check('"assign it to suraj" finishes it → preview for Suraj', /Event feedback for navratri event/.test(last(w)) && w.state?.data.action?.assigneeId === 'u5', { sent: last(w), action: w.state?.data.action });
    await turn(w, 'haan kar do');
    check('→ saved for Suraj', JSON.stringify(assigned(w)) === JSON.stringify(['Event feedback for navratri event→u5']), assigned(w));
    w = mk();
    await turn(w, 'event feedback for navratri event');
    await turn(w, 'for me');
    check('"for me" → on their own list', w.state?.data.action?.assigneeId === 'u1', w.state?.data.action);

    console.log('\n6. Dropping an unfinished request');
    w = mk();
    await turn(w, 'event feedback for navratri event');
    await turn(w, 'rehne do');
    check('"rehne do" → nothing waiting, nothing saved', !w.state?.data?.pending && w.exec.length === 0, w.state);

    console.log('\n7. Someone the sender may not give work to');
    w = mk();
    await turn(w, 'assign neha and vidya to collect id proofs');
    check('only Vidya is proposed; the preview says Neha was left out (never silently)', /Collect ID proofs/.test(last(w)) && /Neha Joshi/.test(last(w)) && w.state?.data.action?.type === 'batch' && w.state.data.action.actions.length === 1, { sent: last(w), action: w.state?.data.action });

    console.log('\n8. Up to 30 tasks in one message');
    w = mk();
    await turn(w, `add thirty tasks:\n${Array.from({ length: 30 }, (_, i) => `Thirty tasks item ${i + 1}`).join('\n')}`);
    check('30 tasks → one preview', w.state?.data.action?.type === 'create_tasks' && w.state.data.action.tasks.length === 30, w.state?.data.action?.tasks?.length);
    w = mk();
    await turn(w, `add thirtyone tasks:\n${Array.from({ length: 31 }, (_, i) => `Thirtyone tasks item ${i + 1}`).join('\n')}`);
    check('31 tasks → nothing proposed, asked to send fewer (limit 30)', !w.state?.data.action && w.state?.data.lastOutcome === 'CLARIFY' && w.exec.length === 0, w.state?.data);
    check('the limit is 30', T.MAX_TASKS_PER_MESSAGE === 30);

    console.log('\n9. An unfinished request expires after 30 minutes');
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    check('older than 30 minutes → forgotten', L.normalizeState({ pending: { kind: 'draft', request: 'x', question: 'q', at: old } }).pending === null);
    check('fresh → kept', L.normalizeState({ pending: { kind: 'draft', request: 'x', question: 'q', at: fresh } }).pending?.kind === 'draft');

    check('\nnothing in this test touched the network', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 HR REQUESTS (SMART CHAT) TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
