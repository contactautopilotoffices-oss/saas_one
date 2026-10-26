/**
 * Owner 2026-10-15: bulk complete / delete by group or date (bot), date ranges on every task screen, carry-forward in the
 * Operations Hub, delete buttons for review items and prompt versions, Assign window department filter, no intro animation.
 * OFFLINE: fake database URL, network blocked, no WhatsApp, no database writes.
 * Run: npx tsx task-manager/tests/test_ranges_and_bulk.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */
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

    const { tasksDomain } = await import('../brain/tasksDomain');
    const types = await import('../brain/types');

    // Today 15 Oct: two tasks carried from 13 Oct, one from 14 Oct (done), two from today.
    const ctx: any = {
        today: '2026-10-15', sender: { id: 'me', name: 'Sahil Gorde', department: 'Tech', role: 'employee' }, people: [], assignableIds: [], departments: ['Tech'], pending: null, recent: [],
        tasks: [
            { n: 1, id: 'c1', title: 'VRV AC repair', status: 'pending', from: '2026-10-13' },
            { n: 2, id: 'c2', title: 'Inverter repair', status: 'in_progress', from: '2026-10-13' },
            { n: 3, id: 'c3', title: 'Wi-Fi fix', status: 'completed', from: '2026-10-14' },
            { n: 4, id: 't1', title: 'AMC renewal', status: 'pending' },
            { n: 5, id: 't2', title: 'Fire extinguisher check', status: 'pending' },
        ],
    };
    const interp = (intent: string, slots: any) => ({ intent, confidence: 0.95, language: 'en', slots: { intent, ...slots }, ambiguities: [], clarifyQuestion: null, summary: '', grounded: true }) as any;
    const which = (o: any = {}) => ({ all: false, numbers: [], hints: [], ...o });
    const noAsk = { ...types.DEFAULT_CONFIRM_POLICY, confirmCompletions: false };
    const decide = (intent: string, w: any, policy: any = types.DEFAULT_CONFIRM_POLICY) => tasksDomain.decide(interp(intent, { which: w }), ctx, policy) as any;

    console.log('\n1. The AI\'s "group" is read safely');
    const v = (raw: any) => (tasksDomain.validateSlots('delete_tasks' as any, { which: raw }, ctx) as any)?.which;
    check('"overdue" / "carry_forward" → carried; "today"; a real date is kept; nonsense is dropped',
        v({ group: 'overdue' }).group === 'carried' && v({ group: 'carry_forward' }).group === 'carried' && v({ group: 'today' }).group === 'today'
        && v({ group: '2026-10-13' }).group === '2026-10-13' && v({ group: 'last week' }).group === undefined && v({ group: '2026-13-45' }).group === undefined);
    check('delete may now say "all" (it is always previewed, then YES)', v({ all: true }).all === true);

    console.log('\n2. Complete a whole group');
    let d = decide('complete_tasks', which({ group: 'carried' }), noAsk);
    check('"complete all overdue" → the OPEN carried tasks only, straight away (undo available)', d.outcome === 'ACT' && d.action.taskIds.join() === 'c1,c2', d);
    d = decide('complete_tasks', which({ group: '2026-10-13' }));
    check('"complete 13 Oct\'s" → that day\'s open tasks (asked first when undo is off)', d.outcome === 'CONFIRM' && d.action.taskIds.join() === 'c1,c2', d);
    d = decide('complete_tasks', which({ group: 'today' }), noAsk);
    check('"mark all of today\'s done" → today\'s open tasks', d.outcome === 'ACT' && d.action.taskIds.join() === 't1,t2', d);
    d = decide('complete_tasks', which({ group: '2026-10-14' }), noAsk);
    check('a day whose tasks are all done → told so, nothing changed', d.outcome === 'REFUSE' && d.reason === 'task_already_done', d);
    d = decide('complete_tasks', which({ group: '2026-10-01' }), noAsk);
    check('a day with no tasks on the list → "no tasks from that day"', d.outcome === 'REFUSE' && d.reason === 'nothing_in_group' && /1 Oct/.test(d.detail), d);
    d = decide('complete_tasks', which({ numbers: [4] }), noAsk);
    check('naming a task still works exactly as before', d.outcome === 'ACT' && d.action.taskIds.join() === 't1', d);

    console.log('\n3. Delete a whole group (always asked first)');
    d = decide('delete_tasks', which({ group: 'carried' }), noAsk);
    check('"delete all overdue tasks" → every carried task (open or done), with a YES first', d.outcome === 'CONFIRM' && d.action.type === 'delete_tasks' && d.action.taskIds.join() === 'c1,c2,c3', d);
    d = decide('delete_tasks', which({ group: 'today' }), noAsk);
    check('"delete today\'s tasks" → today\'s tasks', d.outcome === 'CONFIRM' && d.action.taskIds.join() === 't1,t2', d);
    d = decide('delete_tasks', which({ group: '2026-10-14' }), noAsk);
    check('"delete yesterday\'s carry-forward" → that day only', d.outcome === 'CONFIRM' && d.action.taskIds.join() === 'c3', d);
    d = decide('delete_tasks', which({ all: true }), noAsk);
    check('"delete all my tasks" → the whole list, with a YES first', d.outcome === 'CONFIRM' && d.action.taskIds.length === 5, d);
    d = decide('delete_tasks', which({ group: '2026-10-01' }), noAsk);
    check('an empty day → "no tasks from that day", nothing deleted', d.outcome === 'REFUSE' && d.reason === 'nothing_in_group', d);
    const r = (tasksDomain.validateSlots('rename_task' as any, { which: { group: 'today' }, new_title: 'X' }, ctx) as any);
    d = tasksDomain.decide(interp('rename_task', r), ctx, noAsk) as any;
    check('rename never takes a whole group (asks which one)', d.outcome === 'CLARIFY', d);
    const facts: any = tasksDomain.replyFacts({ outcome: 'REFUSE', reason: 'nothing_in_group', detail: 'Thu, 1 Oct' } as any, ctx);
    check('the reply names the day', /Thu, 1 Oct/.test(facts.fallback), facts);
    check('the AI is told how to fill a group', /"group":"carried"\|"today"\|"YYYY-MM-DD"\|null/.test(read('task-manager/brain/tasksDomain.ts')) && /"overdue", "carry forward"/.test(read('task-manager/brain/tasksDomain.ts')));

    console.log('\n4. Date ranges');
    const { parseRange, MAX_RANGE_DAYS, spanDays } = await import('../dateRange');
    const q = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    const one = parseRange(q({ date: '2026-10-15' })) as any;
    check('the old single "date" still means one day', one.ok && one.from === '2026-10-15' && one.to === '2026-10-15');
    const week = parseRange(q({ from: '2026-10-09', to: '2026-10-15' })) as any;
    check('from / to → that range', week.ok && week.from === '2026-10-09' && week.to === '2026-10-15' && spanDays(week.from, week.to) === 7);
    check('a 31-day range is fine; 32 days is refused', parseRange(q({ from: '2026-09-15', to: '2026-10-15' })).ok && !parseRange(q({ from: '2026-09-14', to: '2026-10-15' })).ok && MAX_RANGE_DAYS === 31);
    const all = parseRange(q({ from: '2000-01-01', to: '2026-10-15' })) as any;
    check('"All time" is the one range allowed past 31 days', all.ok && all.from === '2000-01-01');
    const P0 = await import('../../frontend/components/task-manager/DateRangePicker');
    check('the picker: "All time" keeps its start (no 31-day trim) and is labelled "All time"', P0.clampRange({ from: P0.ALL_TIME_FROM, to: '2026-10-15' }).from === '2000-01-01' && P0.rangeLabel({ from: P0.ALL_TIME_FROM, to: '2026-10-15' }) === 'All time' && /<option value="all">All time<\/option>/.test(read('frontend/components/task-manager/DateRangePicker.tsx')));
    const pickerSrc = read('frontend/components/task-manager/DateRangePicker.tsx');
    check('"Custom" is not a menu choice; the from / to boxes always sit beside it ("Custom dates" is only shown)', !/<option value="custom">Custom<\/option>/.test(pickerSrc) && /<option value="custom" disabled hidden>Custom dates<\/option>/.test(pickerSrc) && !/compact/.test(pickerSrc));
    check('typing a "from" date from All time → that day plus 30 days (never past today)', JSON.stringify(P0.editRange({ from: P0.ALL_TIME_FROM, to: '2026-10-15' }, 'from', '2026-09-01')) === '{"from":"2026-09-01","to":"2026-10-01"}');
    check('typing a "to" date from All time → 30 days before it', JSON.stringify(P0.editRange({ from: P0.ALL_TIME_FROM, to: '2026-10-15' }, 'to', '2026-10-15')) === '{"from":"2026-09-15","to":"2026-10-15"}');
    check('the typed date wins; the other box moves to keep at most 31 days', JSON.stringify(P0.editRange({ from: '2026-10-01', to: '2026-10-10' }, 'from', '2026-08-01')) === '{"from":"2026-08-01","to":"2026-08-31"}' && JSON.stringify(P0.editRange({ from: '2026-10-01', to: '2026-10-10' }, 'to', '2026-09-20')) === '{"from":"2026-08-21","to":"2026-09-20"}');
    const tadSrc = read('frontend/components/task-manager/TaskAssignmentDashboard.tsx');
    check('status is one dropdown with All / Pending / Done / Carry forward, filtered on screen', /<option value="carried">Carry forward \(\{carriedCount\}\)<\/option>/.test(tadSrc) && /statusFilter === 'carried' && !t\.is_carried_forward/.test(tadSrc) && !/params\.set\('status'/.test(tadSrc));
    check('the left Staff list follows the page department; the Assign window has its own list', /selectedDeptId !== 'all'\) \{\s*list = employees\.filter\(e => e\.department_id === selectedDeptId\)/.test(read('frontend/components/task-manager/TaskAssignmentDashboard.tsx')) && /modalAssignees\.map/.test(read('frontend/components/task-manager/TaskAssignmentDashboard.tsx')));
    check('backwards or broken dates are refused', !parseRange(q({ from: '2026-10-16', to: '2026-10-15' })).ok && !parseRange(q({ from: '15-10-2026', to: '2026-10-15' })).ok);
    const P = await import('../../frontend/components/task-manager/DateRangePicker');
    check('the picker keeps a range valid: swaps a backwards range, trims to 31 days', JSON.stringify(P.clampRange({ from: '2026-10-15', to: '2026-10-10' })) === '{"from":"2026-10-10","to":"2026-10-15"}' && P.clampRange({ from: '2026-08-01', to: '2026-10-15' }).from === '2026-09-15');
    check('labels: one day "15 Oct", a range "9 Oct – 15 Oct"', P.rangeLabel({ from: '2026-10-15', to: '2026-10-15' }) === '15 Oct' && P.rangeLabel({ from: '2026-10-09', to: '2026-10-15' }) === '9 Oct – 15 Oct');

    const tasksRoute = read('app/api/task-manager/tasks/route.ts'), progressRoute = read('app/api/task-manager/progress/route.ts'), wsRoute = read('app/api/task-manager/workspace/route.ts');
    const ws = read('task-manager/WorkspaceService.ts'), prog = read('task-manager/TaskProgressService.ts');
    check('Assign & monitor API: range, plus carry-forward that follows each department\'s setting', /parseRange\(searchParams\)/.test(tasksRoute) && /\.gte\('assigned_date', from\)\.lte\('assigned_date', to\)/.test(tasksRoute) && /is_carried_forward: true/.test(tasksRoute) && /getCarryForward\(dept\)/.test(tasksRoute) && /status === 'completed' \? null/.test(tasksRoute));
    check('progress figures: range + carried-in tasks only when the dashboard asks (carry=1); other callers unchanged', /includeCarried: searchParams\.get\('carry'\) === '1'/.test(progressRoute) && /opts: ProgressOptions = \{\}/.test(prog));
    check('department Tasks tab + My tasks: range, and carry-forward per department (no fixed 14 days)', /to: request\.nextUrl\.searchParams\.get\('to'\)/.test(wsRoute) && /loadConsole\(userId, from && to/.test(wsRoute) && !/CARRY_DAYS = 14/.test(ws) && /carryDaysOf\(await TaskDatabaseService\.getCarryForward\(dept\)\)/.test(ws));

    console.log('\n5. Screens');
    const tad = read('frontend/components/task-manager/TaskAssignmentDashboard.tsx'), ptab = read('frontend/components/procurement/ProcurementTasksTab.tsx'), con = read('frontend/components/task-manager/ConsoleTasks.tsx');
    check('Assign & monitor opens with no intro animation (no timed steps, no replay on refresh)', /const animationStep = 5;/.test(tad) && !/setAnimationStep/.test(tad) && !/setTimeout\(\(\) => setAnimationStep/.test(tad));
    check('the range picker sits beside All / Pending / Done', /date range beside the status dropdown[\s\S]{0,120}<DateRangePicker/.test(tad));
    check('carry-forward tasks show under their own heading with "from <day>"', /Carry forward — unfinished from earlier days/.test(tad) && /`from \$\{rangeLabel/.test(tad));
    check('the Assign window has a Department filter (superuser) and its own date', /id="assign-dept"/.test(tad) && /All departments/.test(tad) && /id="assign-date"/.test(tad) && /assignedDate: assignDate/.test(tad));
    check('department Tasks tab and My tasks have the range picker', /<DateRangePicker value=\{range\}/.test(ptab) && /<DateRangePicker value=\{c\.range\}/.test(con) && /scope=console&from=/.test(con));
    const rev = read('frontend/components/task-manager/BotReviewSection.tsx'), pv = read('frontend/components/task-manager/PromptVersionsSection.tsx'), svc = read('task-manager/BotLearningService.ts'), blr = read('app/api/task-manager/bot-learning/route.ts');
    check('review items: 🗑 Delete with a Yes/No check, removed now (only waiting or ignored)', /action: 'delete_review'/.test(rev) && /Delete\?/.test(rev) && /\.delete\(\)\.eq\('id', id\)\.in\('status', \['waiting', 'ignored'\]\)/.test(svc) && /'delete_review'/.test(blr));
    check('prompt versions: 🗑 Delete on every version except the one in use', /action: 'delete_prompt'/.test(pv) && /p\.status !== 'active' &&/.test(pv) && /\.neq\('status', 'active'\)/.test(svc) && /'delete_prompt'/.test(blr));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 RANGES AND BULK TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
