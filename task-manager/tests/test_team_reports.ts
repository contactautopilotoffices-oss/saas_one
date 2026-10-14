/**
 * Phase 4 — "Team reports" + the Hinglish / team eval sets (OFFLINE: fake data, a scripted AI, recorders; no network,
 * no database, no WhatsApp, no AI provider).
 * Run: npx tsx task-manager/tests/test_team_reports.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
delete process.env.WHATSAPP_TEAM_REPORTS_ENABLED;

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const D = await import('../brain/tasksDomain');
    const { facilityDomain } = await import('../brain/facilityDomain');
    const { DEFAULT_DOMAINS } = await import('../brain/index');
    const P = await import('../brain/prompt');
    const X = await import('../brain/execute');
    const T = await import('../brain/teamReport');
    const L = await import('../brain/live');
    const { world } = await import('../brain/eval/worlds');
    const { DEFAULT_CONFIRM_POLICY } = await import('../brain/types');

    console.log('\n1. Switch OFF = the AI\'s instructions are exactly as before');
    check('the default domains are the original ones', DEFAULT_DOMAINS[0] === D.tasksDomain && DEFAULT_DOMAINS[1] === facilityDomain);
    const off = P.interpretSystemPrompt(DEFAULT_DOMAINS);
    const on = P.interpretSystemPrompt([D.tasksDomainWithTeam, facilityDomain]);
    check('the original instructions do not mention a team scope', !/"team"/.test(off) && !/my team/i.test(off));
    const diff = on.split('\n').filter((l, i) => l !== off.split('\n')[i]);
    // 2026-10-13: the find_tasks form also gains its "team" choice with the switch (it is gated the same way).
    check('with Team reports ON, ONLY the view_tasks lines and the find_tasks "team" choice change', off.split('\n').length === on.split('\n').length && diff.length === 3 && diff.every(l => /view_tasks|"team"/.test(l)), diff);

    console.log('\n2. Reading and deciding');
    const ctx: any = world('default');
    check('the original domain rejects scope "team" (it cannot slip in while OFF)', D.tasksDomain.validateSlots('view_tasks', { scope: 'team' }, ctx) === null);
    const slots = D.tasksDomainWithTeam.validateSlots('view_tasks', { scope: 'team', person: 'x', department: 'y' }, ctx);
    check('the team domain accepts it (and ignores any person / department)', JSON.stringify(slots) === '{"intent":"view_tasks","scope":"team","person":null,"department":null}', slots);
    const interp = (s: any): any => ({ intent: s.intent, slots: s, confidence: 0.95, language: 'en', ambiguities: [], clarifyQuestion: null, summary: 'x', grounded: true });
    check('someone who can give work to others → a team report', JSON.stringify(D.tasksDomainWithTeam.decide(interp(slots), ctx, DEFAULT_CONFIRM_POLICY)) === '{"outcome":"ACT","action":{"type":"view_tasks","scope":"team","personId":null,"department":null}}');
    check('someone with nobody to give work to → refused kindly', D.tasksDomainWithTeam.decide(interp(slots), world('noTeam'), DEFAULT_CONFIRM_POLICY).outcome === 'REFUSE');
    const self = D.tasksDomainWithTeam.validateSlots('view_tasks', { scope: 'self' }, ctx);
    check('everything else decides exactly like the original domain', JSON.stringify(D.tasksDomainWithTeam.decide(interp(self), ctx, DEFAULT_CONFIRM_POLICY)) === JSON.stringify(D.tasksDomain.decide(interp(self), ctx, DEFAULT_CONFIRM_POLICY)));

    console.log('\n3. Carrying it out (read-only)');
    const calls: string[] = [];
    const io: any = { readTeam: async (a: string) => { calls.push(`team:${a}`); return 'Team today: 3/5 tasks done.'; }, readInsight: async () => { calls.push('insight'); return 'COMPANY'; }, readPerson: async () => null };
    let r = await X.executeAction({ type: 'view_tasks', scope: 'team', personId: null, department: null }, { ...ctx }, io);
    check('team → readTeam, for the sender only; never the company overview', JSON.stringify(calls) === '["team:u1"]' && r!.values.data === 'Team today: 3/5 tasks done.', { calls, r });
    r = await X.executeAction({ type: 'view_tasks', scope: 'team', personId: null, department: null }, { ...ctx }, { ...io, readTeam: undefined });
    check('no team reader wired → "not available", nothing else is read', r!.summary === 'Team reports are not available.' && !r!.values.data);

    console.log('\n4. The report text');
    const pend = (n: number, carried = 0) => [...Array(n).fill({ status: 'pending' }), ...Array(carried).fill({ status: 'pending', isCarriedForward: true })];
    const rep = T.buildTeamReport([
        { name: 'Vidya Nair', tasks: [{ status: 'completed' }, { status: 'completed' }] },
        { name: 'Harsh Patel', tasks: [{ status: 'completed' }, { status: 'in_progress' }, ...pend(1, 2)] },
        { name: 'Suraj Verma', tasks: [] },
        { name: 'Dipti Rao', tasks: pend(3) },
    ]);
    const lines = rep.split('\n');
    check('a summary line first: done / total and overdue', lines[0] === 'Team today: 3/10 tasks done, 2 overdue.', lines[0]);
    check('who needs attention first: overdue, then most open work', lines[1].startsWith('• Harsh Patel') && lines[2].startsWith('• Dipti Rao'), lines);
    check('each line: done/total, in progress, overdue', lines[1] === '• Harsh Patel: 1/5 done, 1 in progress, 2 overdue ⚠️', lines[1]);
    check('everything done → ✅; no tasks → said plainly', rep.includes('• Vidya Nair: 2/2 done ✅') && rep.includes('• Suraj Verma: no tasks today'));
    const big = T.buildTeamReport(Array.from({ length: 30 }, (_, i) => ({ name: `P${i}`, tasks: [] })));
    check('a big team is cut at 25 lines with "…and N more"', big.split('\n').length === 1 + 25 + 1 && /…and 5 more$/.test(big));
    check('no team → plain sentence', T.buildTeamReport([]) === 'Nobody in your team yet.');

    console.log('\n5. Through the real Smart chat code');
    const PHONE = '918433649199';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });
    const mk = (on: boolean) => {
        const w: any = { on, systems: [] as string[], sent: [] as string[], reads: [] as string[] };
        const llm = { complete: async (req: any) => {
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) {
                const need = (u.placeholders || []).filter((x: any) => x.required).map((x: any) => x.name).join(' ');
                return { text: JSON.stringify({ text: `Here you go: ${need}` }), tokensIn: 1, tokensOut: 1 };
            }
            w.systems.push(req.system);
            // The scripted AI always answers "team" — a real AI would only do that when the option exists.
            return { text: JSON.stringify({ intent: 'view_tasks', slots: { scope: 'team', person: null, department: null }, confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, summary: 'How is my team doing' }), tokensIn: 1, tokensOut: 1 };
        } };
        w.io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp,
            checkAccess: async () => ({ allowed: true }), facilityActive: async () => false,
            getState: async () => null, setState: async () => {}, clearState: async () => {}, openPingPending: async () => null,
            buildContext: async (_e: any, _p: string, opts: any) => ({ ...world('default'), pending: opts.pending, recent: opts.recent }),
            teamReportsOn: async () => w.on,
            brain: { llm },
            exec: { setStatus: async () => {}, assign: async () => {}, handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => 'COMPANY',
                readTeam: async (a: string) => { w.reads.push(a); return 'Team today: 3/9 tasks done, 2 overdue.'; } },
            reply: async (_p: string, t: string) => { w.sent.push(t); }, audit: async () => {}, seenBefore: () => false, markSeen: () => {},
        };
        return w;
    };
    const turn = async (w: any, text: string, id: string) => { const c = await L.claimSmartChat(body(text, id), w.io); if (c.background) await c.background(); return c; };

    let w = mk(false);
    await turn(w, 'how is my team doing today', 'a1');
    check('switch OFF → the AI gets the ORIGINAL instructions (no team option)', w.systems.length > 0 && !/"team"/.test(w.systems[0]));
    check('switch OFF → even if the AI says "team", it is rejected: no team report is read', w.reads.length === 0, w.reads);
    w = mk(true);
    await turn(w, 'how is my team doing today', 'b1');
    check('switch ON → the AI is offered the team option', /"team"/.test(w.systems[0]));
    check('switch ON → the report is read for the sender and sent back', JSON.stringify(w.reads) === '["u1"]' && /3\/9 tasks done/.test(w.sent[0]), { reads: w.reads, sent: w.sent });

    console.log('\n6. The Phase 4 eval sets (measured later with the paid AI, with the owner\'s OK)');
    const { EVAL_CASES } = await import('../brain/eval/cases');
    const { HINGLISH_CASES, TEAM_CASES } = await import('../brain/eval/cases_phase4');
    const { TASK_INTENTS } = await import('../brain/types');
    const valid = new Set<string>([...TASK_INTENTS, 'facility_request']);
    check('the original English set is untouched (no Hinglish or team cases mixed in)', EVAL_CASES.length >= 130 && !EVAL_CASES.some(c => c.group.startsWith('hi-') || c.group === 'team'));
    check(`at least 35 Hinglish cases (${HINGLISH_CASES.length}) covering every group`, HINGLISH_CASES.length >= 35 && ['hi-view', 'hi-done', 'hi-progress', 'hi-create', 'hi-handover', 'hi-answer', 'hi-facility', 'hi-chat', 'hi-safety'].every(g => HINGLISH_CASES.some(c => c.group === g)));
    const all = [...HINGLISH_CASES, ...TEAM_CASES];
    const ids = all.map(c => c.id);
    check('every id is unique', new Set(ids).size === ids.length);
    check('every expected intent is real', all.every(c => c.expect.intent.length && c.expect.intent.every(i => valid.has(i))));
    const ctxFor = (c: any) => world(c.world || 'default', c.pending ?? null);
    check('every expected task id exists in its world (or its request)', all.every(c => (c.expect.taskIds || []).every(t => [...ctxFor(c).tasks.map(x => x.id), ...(c.pending?.kind === 'ping_reply' ? c.pending.taskIds : [])].includes(t))));
    check('every expected person exists in its world', all.every(c => [c.expect.assignee, c.expect.personId].filter(Boolean).every(p => ctxFor(c).people.some(x => x.id === p))));
    check('the team set expects the team scope, plus person / self / no-team controls', TEAM_CASES.filter(c => c.expect.scope === 'team').length >= 7 && TEAM_CASES.some(c => c.world === 'noTeam'));
    check('the eval runner can run each set; base keeps its old file names', /--set base\|hinglish\|team/.test(read('task-manager/brain/eval/run_eval.ts')) && /set === 'base' \? 'eval_all\.json'/.test(read('task-manager/brain/eval/run_eval.ts')));

    console.log('\n7. Wiring');
    const live = read('task-manager/brain/live.ts');
    check('"my team" = the same permission rule as assigning, re-checked when reading', /PermissionService\.visibleAndAssignable\(actor, pool\)/.test(live) && /buildTeamReport\(members\)/.test(live));
    check('"Team reports" is a Task Access panel switch, OFF by default', /teamReports: c\.teamReportsEnabled === true/.test(read('task-manager/BotSwitches.ts'))
        && /key: 'teamReports'/.test(read('frontend/components/task-manager/TaskAccessPanel.tsx')) && /\[[^\]]*'teamReports'[^\]]*\]\.includes\(body\.feature\)/.test(read('app/api/task-manager/access/route.ts')));
    check('Smart chat still never touches the database directly', !/supabase|\.insert\(|\.update\(|\.upsert\(/.test(live));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 TEAM REPORTS TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
