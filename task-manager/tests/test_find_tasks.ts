/**
 * Flexible "look up tasks" — find_tasks (OFFLINE: fake data, a scripted AI, recorders; no network, no database, no WhatsApp).
 * docs/TASK_LOOKUP_PLAN.md. Checks the form, the dates, the permission rule, the answer, and that nothing can change a task.
 * Run: npx tsx task-manager/tests/test_find_tasks.ts
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
    const F = await import('../brain/findTasks');
    const { tasksDomain } = await import('../brain/tasksDomain');
    const L = await import('../brain/live');
    const { world } = await import('../brain/eval/worlds');
    const POLICY = { confirmProgressUpdates: false };
    const ctx0 = (): any => ({ ...world('default'), pending: null, recent: [] });
    const decide = (raw: any, w = 'default', message = 'question') => {
        const ctx: any = { ...world(w as any), pending: null, recent: [] };
        const slots = tasksDomain.validateSlots('find_tasks', raw, ctx);
        if (!slots) return { invalid: true } as any;
        const interp: any = { intent: 'find_tasks', confidence: 0.95, language: 'en', slots, ambiguities: [], clarifyQuestion: null, summary: 'q', grounded: tasksDomain.checkGrounding(slots, message) };
        return { d: tasksDomain.decide(interp, ctx, POLICY), ctx };
    };

    console.log('\n1. The form: only fixed choices; anything else is rejected');
    const q0 = F.validateQuery({})!;
    check('empty form → safe defaults (me, any period, any status, a list)', q0.whose === 'me' && q0.period === 'any' && q0.status === 'any' && q0.showAs === 'list' && q0.limit === 25);
    check('an unknown value is rejected (the reading is retried, never guessed)', F.validateQuery({ status: 'deleted' }) === null && F.validateQuery({ whose: 'database' }) === null && F.validateQuery({ show_as: 'sql' }) === null);
    check('"last N days" needs N; a range needs a start; N at most 92', F.validateQuery({ period: 'last_n_days' }) === null && F.validateQuery({ period: 'range' }) === null && F.validateQuery({ period: 'last_n_days', n: 500 }) === null);
    check('"people" needs at least one name', F.validateQuery({ whose: 'people', people: [] }) === null);
    const qw = F.validateQuery({ words: ['AMC%', "x'; drop table", 'a', 'lift', 'one', 'two', 'three', 'four'] })!;
    check('search words: plain letters/digits only (no wildcards, no query syntax), at most 5', qw.words.length === 5 && qw.words[0] === 'amc' && qw.words.every(w => /^[a-z0-9 -]+$/.test(w)), qw.words);
    check('a search word must be in the message (the AI cannot invent one)', F.wordsGrounded(F.validateQuery({ words: ['amc'] })!, 'anything about AMC?') && !F.wordsGrounded(F.validateQuery({ words: ['carpet'] })!, 'anything about AMC?'));

    console.log('\n2. Dates (India; a week starts Monday). "Today" = Thu 8 Oct 2026');
    const T = '2026-10-08';
    const r = (period: any, extra: any = {}) => F.periodRange({ period, n: null, from: null, to: null, ...extra }, T);
    check('yesterday / tomorrow / today', r('yesterday').from === '2026-10-07' && r('tomorrow').from === '2026-10-09' && r('today').to === T);
    check('this week = Mon 5 – Sun 11 Oct; last week = 28 Sep – 4 Oct', r('this_week').from === '2026-10-05' && r('this_week').to === '2026-10-11' && r('last_week').from === '2026-09-28' && r('last_week').to === '2026-10-04');
    check('this month / last month', r('this_month').from === '2026-10-01' && r('this_month').to === '2026-10-31' && r('last_month').from === '2026-09-01' && r('last_month').to === '2026-09-30');
    check('last 7 days = 2–8 Oct', r('last_n_days', { n: 7 }).from === '2026-10-02' && r('last_n_days', { n: 7 }).to === T);
    check('one question never covers more than 92 days', (() => { const x = r('range', { from: '2025-01-01', to: '2026-10-08' }); return x.to === T && x.from === '2026-07-09'; })() && r('any').from === '2026-07-09');

    console.log('\n3. Who may be looked up (the same rule as everywhere)');
    let out = decide({ whose: 'people', people: ['Vidya'] });
    check('a teammate you may give work to → allowed', out.d.outcome === 'ACT' && JSON.stringify(out.d.action.query.employeeIds) === '["u2"]', out.d);
    out = decide({ whose: 'people', people: ['Neha'] });
    check('someone outside your permission → politely refused', out.d.outcome === 'REFUSE' && out.d.reason === 'not_allowed_to_view', out.d);
    out = decide({ whose: 'people', people: ['Lohit', 'Zed'] });
    check('a name nobody has → asked, never guessed', out.d.outcome === 'CLARIFY' && out.d.reason === 'person_not_found', out.d);
    check('a department / everyone → only for a superuser', decide({ whose: 'department', department: 'Procurement' }).d.outcome === 'REFUSE' && decide({ whose: 'everyone' }).d.outcome === 'REFUSE');
    out = decide({ whose: 'department', department: 'procurement' }, 'superuser');
    check('superuser: a department → its people', out.d.outcome === 'ACT' && out.d.action.query.employeeIds.includes('u2') && !out.d.action.query.employeeIds.includes('u3'), out.d);
    out = decide({ whose: 'me', given_by: 'person', given_by_name: 'saniel' });
    check('"what did Saniel give me?" → given-by resolved to Saniel', out.d.outcome === 'ACT' && out.d.action.query.givenById === 'u9' && out.d.action.query.givenByLabel === 'Saniel Mehta', out.d);
    out = decide({ whose: 'anyone', given_by: 'me' });
    check('"what have I assigned?" → everyone I may see, given by me', out.d.outcome === 'ACT' && out.d.action.query.givenById === 'u1' && out.d.action.query.employeeIds.includes('u2') && !out.d.action.query.employeeIds.includes('u7'), out.d);
    const D = await import('../brain/tasksDomain');
    check('"my team" only while the Team reports switch is ON (switch OFF: not offered, and rejected if the AI tries)',
        tasksDomain.validateSlots('find_tasks', { whose: 'team' }, ctx0()) === null && D.tasksDomainWithTeam.validateSlots('find_tasks', { whose: 'team' }, ctx0()) !== null
        && !/"team"/.test(tasksDomain.intents.find(i => i.name === 'find_tasks')!.slots) && /"team"/.test(D.tasksDomainWithTeam.intents.find(i => i.name === 'find_tasks')!.slots));
    out = decide({ whose: 'me', words: ['carpet'] }, 'default', 'anything about AMC?');
    check('a search word not in the message → not trusted (asked again)', out.d.outcome === 'CLARIFY' && out.d.reason === 'not_grounded', out.d);
    check('a lookup is never part of a combined change ("done 1 and what did I finish yesterday")', /d\.action\.type !== 'find_tasks'/.test(read('task-manager/brain/tasksDomain.ts')));

    console.log('\n4. The answer is written by code from the real rows');
    const ctx: any = { ...world('default'), pending: null, recent: [] };
    const view = F.viewFor(ctx);
    const base = { whoLabel: '', givenById: null, givenByLabel: null, from: '2026-10-01', to: T, periodLabel: 'this week', dateField: 'assigned', status: 'any', overdueOnly: false, minDaysOld: null, kind: 'any', words: [], showAs: 'list', sort: 'oldest', limit: 25, today: T } as any;
    const row = (id: string, emp: string, title: string, date: string, status: any) => ({ id, title, employee_id: emp, assigned_date: date, status, assigned_by: null, completed_at: null, task_template_id: null });
    const rows = [row('t1', 'u1', 'Carpet Installation PO', '2026-10-08', 'pending'), row('x1', 'u1', 'Old report', '2026-10-06', 'completed'), row('v1', 'u2', 'Chase vendor', '2026-10-07', 'pending')];
    let f = F.formatFound(rows, { ...base, employeeIds: ['u1', 'u2'] }, view, 'u1');
    check('your OWN open task keeps its real number ("done 1" works); others and done ones get bullets', /\n1\. Carpet Installation PO/.test(f.text) && /• Chase vendor \(Vidya Nair/.test(f.text) && /• Old report/.test(f.text) && !/\d\. Chase vendor/.test(f.text), f.text);
    check('oldest first; the filters are NOT shown to the person (only told to the reply writer)', f.text.indexOf('Old report') < f.text.indexOf('Carpet') && /^3 tasks:\n/.test(f.text) && !/this week/.test(f.text) && /this week/.test(f.summary), f);
    f = F.formatFound(rows, { ...base, employeeIds: ['u1', 'u2'], showAs: 'count', status: 'any' }, view, 'u1');
    check('count → "3 tasks: 1 done, 2 open."', /3 tasks: 1 done, 2 open\./.test(f.text), f.text);
    f = F.formatFound(rows, { ...base, employeeIds: ['u1', 'u2'], showAs: 'by_person' }, view, 'u1');
    check('grouped by person', /• Priyanka Shah: 1 done of 2/.test(f.text) && /• Vidya Nair: 0 done of 1/.test(f.text), f.text);
    f = F.formatFound([], { ...base, employeeIds: ['u2'], whoLabel: 'Vidya Nair', status: 'done', periodLabel: 'last week (28 Sep–4 Oct)' }, view, 'u1');
    check('nothing found → says so plainly (no filter list)', f.count === 0 && f.text === 'No matching tasks found.', f.text);
    const many = Array.from({ length: 30 }, (_, i) => row(`m${i}`, 'u2', `Task ${i}`, '2026-10-07', 'pending'));
    f = F.formatFound(many, { ...base, employeeIds: ['u2'] }, view, 'u1');
    check('at most 25 lines, then "…and N more"', (f.text.match(/\n• /g) || []).length === 25 && /…and 5 more/.test(f.text));
    check('rows for anyone not asked about are never shown', F.formatFound([row('n1', 'u7', 'Secret', T, 'pending')], { ...base, employeeIds: ['u2'] }, view, 'u1').count === 0);

    console.log('\n5. Through the real Smart chat code — read-only, nothing changes');
    const PHONE = '919999900003';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const w: any = { sent: [] as string[], exec: [] as any[], asked: [] as any[], state: null };
    const llm = { complete: async (req: any) => {
        const u = JSON.parse(req.user);
        if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: 'Here you go: [[data]]' }), tokensIn: 1, tokensOut: 1 };
        return { text: JSON.stringify({ intent: 'find_tasks', confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, summary: 'Finished yesterday',
            slots: { whose: 'me', period: 'yesterday', date_field: 'finished', status: 'done' } }), tokensIn: 1, tokensOut: 1 };
    } };
    const io: any = {
        getSmartChatDepartments: async () => new Set(['d1']), getEmployee: async () => emp, checkAccess: async () => ({ allowed: true }), getConfig: async () => ({ enabled: false, employees: [] }),
        getState: async () => w.state, facilityActive: async () => false, openPingPending: async () => null,
        buildContext: async (_e: any, _p: string, o: any) => ({ ...world('default'), pending: o.pending, recent: o.recent }),
        setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: s }; }, clearState: async () => { w.state = null; }, brain: { llm },
        exec: {
            setStatus: async (...a: any[]) => { w.exec.push(['setStatus', ...a]); }, assign: async (...a: any[]) => { w.exec.push(['assign', ...a]); }, handOver: async () => { w.exec.push(['handOver']); return { toName: '' }; },
            readPerson: async () => null, readInsight: async () => '',
            findTasks: async (actor: string, q: any) => { w.asked.push({ actor, q }); return [row('x1', 'u1', 'Old report', '2026-10-07', 'completed')]; },
        },
        reply: async (_p: string, t: string) => { w.sent.push(t); }, audit: async () => {}, seenBefore: () => false, markSeen: () => {},
    };
    const c = await L.claimSmartChat({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id: 'f1', message_type: 'text', text: { body: 'what did I finish yesterday?' } }] } }, io);
    await c.background!();
    const asked = w.asked[0]?.q;
    check('"what did I finish yesterday?" → asks the database for: me, done, finished on 7 Oct', asked && JSON.stringify(asked.employeeIds) === '["u1"]' && asked.status === 'done' && asked.dateField === 'finished' && asked.from === '2026-10-07' && asked.to === '2026-10-07', asked);
    check('…the reply carries the real rows (written by code), without a filter list', /Old report/.test(w.sent[0]) && !/7 Oct\)/.test(w.sent[0]), w.sent[0]);
    check('…and nothing was changed, no question left open', w.exec.length === 0 && !w.state?.data?.pending, { exec: w.exec, st: w.state?.data });

    console.log('\n6. The database read and the second permission check');
    const db = read('task-manager/TaskDatabaseService.ts');
    const fn = db.slice(db.indexOf('static async searchAssignments('), db.indexOf('static async getNumberedList('));
    check('one read-only select; no insert / update / delete / raw SQL in it', /\.select\(/.test(fn) && !/\.(insert|update|delete|upsert|rpc)\(/.test(fn));
    check('search words are cleaned again right before the query (plain text only)', /replace\(\/\[\^a-z0-9 -\]\/g, ''\)/.test(fn));
    check('at most 500 rows', /\.limit\(Math\.min\(q\.limit \?\? 500, 500\)\)/.test(fn));
    const live = read('task-manager/brain/live.ts');
    check('when the lookup runs, the permission rule is applied AGAIN (and only active departments)', /async findTasks\(actorId, q\)[\s\S]{0,900}PermissionService\.visibleAndAssignable\(actor, pool\)[\s\S]{0,300}const ids = q\.employeeIds\.filter\(id => allowed\.has\(id\)\);/.test(live) && /TaskAccessService\.activeDepartmentIds\(\)/.test(live));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 FIND TASKS TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
