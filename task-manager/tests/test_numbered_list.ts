/**
 * One numbered list (OFFLINE: fake rows, the database calls are replaced; no network, no message can be sent from this file).
 * Older open tasks come first, then today's — and "1" means the same task in the morning list, the midday reminder, the
 * overdue alert and the bot's "done 1".
 * Run: npx tsx task-manager/tests/test_numbered_list.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

const row = (id: string, title: string, assigned_date: string, created: string, extra: Record<string, unknown> = {}) =>
    ({ id, title, assigned_date, created_at: `${assigned_date}T${created}:00Z`, status: 'pending', task_template_id: null, employee_id: 'u1', description: null,
        assigned_by: null, completed_at: null, updated_at: '', ...extra }) as any;

async function run() {
    (globalThis as any).fetch = async () => { throw new Error('network must not be used'); };
    const { TaskDatabaseService, buildNumberedList, CARRY_LOOKBACK_DAYS } = await import('../TaskDatabaseService');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const { defaultsFor } = await import('../DepartmentRulesService');
    const F = await import('../brain/frontDoor');

    const today = [
        row('t-fixed', 'Site round', '2026-10-12', '08:00', { task_template_id: 'tpl-1' }),
        row('t-done', 'Send report', '2026-10-12', '09:00', { status: 'completed' }),
        row('t-dg', 'DG Meter Log', '2026-10-12', '07:00', { task_template_id: 'tpl-dg' }),
    ];
    const earlier = [
        row('e-b-old', 'Vendor call', '2026-10-09', '10:00'),
        row('e-b', 'Vendor call', '2026-10-11', '10:00'),
        row('e-a', 'Opex payment', '2026-10-10', '11:00', { status: 'in_progress' }),
        row('e-c', 'Closed earlier', '2026-10-11', '09:00', { status: 'completed' }),
        row('e-dg', 'DG meter log ', '2026-10-11', '07:00', { task_template_id: 'tpl-dg' }),
    ];

    console.log('\n1. The list: older open tasks first (oldest first), then today\'s');
    const list = buildNumberedList(today, earlier);
    check('order is Opex payment, Vendor call, DG Meter Log, Site round, Send report', list.map(t => t.id).join() === 'e-a,e-b,t-dg,t-fixed,t-done', list.map(t => t.id));
    check('numbers are 1..5 with no gaps', list.map(t => t.listNumber).join() === '1,2,3,4,5');
    check('older tasks are marked carried forward, today\'s are not', list.map(t => t.isCarriedForward).join() === 'true,true,false,false,false');
    check('the same title open on two earlier days is shown once (the newest copy)', list.filter(t => t.title === 'Vendor call').length === 1 && list[1].id === 'e-b');
    check('an earlier copy of a task that is also on today\'s list is not repeated', !list.some(t => t.id === 'e-dg'));
    check('a finished earlier task is not carried', !list.some(t => t.id === 'e-c'));
    check('the carry window is 7 days', CARRY_LOOKBACK_DAYS === 7);

    console.log('\n2. Every message shows part of the SAME list, keeping the numbers');
    const db: any = TaskDatabaseService;
    db.getNumberedList = async () => list;
    const pick = async (type: 'morning_digest' | 'pending_reminder' | 'eod_summary' | 'overdue_alert') =>
        db.getFilteredAssignments({ employeeId: 'u1', date: '2026-10-12', filters: defaultsFor(type).taskFilters });
    const morning = await pick('morning_digest');
    const midday = await pick('pending_reminder');
    const evening = await pick('eod_summary');
    const overdue = await pick('overdue_alert');
    check('morning shows all 5', morning.map((t: any) => t.listNumber).join() === '1,2,3,4,5');
    check('midday hides the finished one but keeps the numbers (1,2,3,4)', midday.map((t: any) => t.listNumber).join() === '1,2,3,4', midday.map((t: any) => t.listNumber));
    check('evening shows all 5', evening.map((t: any) => t.listNumber).join() === '1,2,3,4,5');
    check('overdue shows ONLY the older tasks, numbered 1 and 2', overdue.map((t: any) => t.listNumber).join() === '1,2', overdue.map((t: any) => t.listNumber));

    const [, , ov] = TaskNotificationService.buildOverdueTemplateParams('Asha K', overdue, '2026-10-12');
    check('overdue alert text: "1. Opex payment (Due: 10 Oct) | 2. Vendor call (Due: 11 Oct)"', ov === '1. Opex payment (Due: 10 Oct) | 2. Vendor call (Due: 11 Oct)', ov);
    const [, , mv2] = TaskNotificationService.buildMorningV2Params('Asha K', morning, '2026-10-12');
    // 2026-10-14: carry-forward and today's tasks are labelled on the one line; the numbers are unchanged.
    check('morning standup lists 1. Opex payment … 4. Site round', /^You have 5 tasks today: Carry forward: 1\. Opex payment 🔄 \| 2\. Vendor call ⏳ — Today: 3\. DG Meter Log ⏳ \| 4\. Site round ⏳ \| 5\. Send report ✅$/.test(mv2), mv2);
    const mid = TaskNotificationService.buildTemplateTaskParam('pending_reminder', midday);
    check('midday reminder keeps "4. Site round"', mid.includes('4. Site round') && !mid.includes('Send report'), mid);
    const text = TaskNotificationService.buildMiddayReminder('Asha K', [...midday.slice(0, 2), midday[3]]);
    check('plain-text reminder uses list numbers too (1, 2, 4 — not 1, 2, 3)', /\n1\. .*Opex payment/.test(text) && /\n4\. Site round/.test(text) && !/\n3\. /.test(text), text);

    console.log('\n3. The bot uses the same numbers');
    const ctx: any = { tasks: list.map(t => ({ n: t.listNumber, id: t.id, title: t.title, status: t.status, ...(t.isCarriedForward ? { from: t.assigned_date } : {}) })) };
    const done1 = F.planExact({ kind: 'done', numbers: [1] }, ctx) as any;
    check('"done 1" after the overdue alert completes Opex payment (the task shown as 1)', done1?.kind === 'act' && done1.action.taskIds.join() === 'e-a', done1);
    const done4 = F.planExact({ kind: 'done', numbers: [4] }, ctx) as any;
    check('"done 4" after the midday reminder completes Site round', done4?.kind === 'act' && done4.action.taskIds.join() === 't-fixed', done4);
    const view = F.planExact({ kind: 'view' }, ctx) as any;
    check('"tasks" shows older tasks first with their day: "1. Opex payment (from 10 Oct)"', view?.kind === 'reply' && view.text.includes('1. Opex payment (from 10 Oct) 🔄') && view.text.includes('4. Site round ⏳'), view?.text);
    const all = F.planExact({ kind: 'done_all' }, ctx) as any;
    check('"done all" also closes the older open tasks', all?.kind === 'act' && all.action.taskIds.join() === 'e-a,e-b,t-dg,t-fixed', all);

    console.log('\n4. Every path that reads "done N" uses the numbered list');
    check('Smart chat context reads getNumberedList and uses listNumber', /getNumberedList\(/.test(read('task-manager/brain/context.ts')) && /n: t\.listNumber/.test(read('task-manager/brain/context.ts')));
    check('old command handler reads getNumberedList', /const tasks = await TaskDatabaseService\.getNumberedList\(/.test(read('task-manager/TaskCommandHandler.ts')));
    check('old gateway (done + the stale-list check) reads getNumberedList', (read('task-manager/TaskGatewayExecutor.ts').match(/getNumberedList\(/g) || []).length === 2 && !/getDailyAssignments\(/.test(read('task-manager/TaskGatewayExecutor.ts')));

    if (failures) { console.error(`\n❌ ${failures} check(s) failed`); process.exit(1); }
    console.log('\n🎉 NUMBERED LIST TESTS PASSED');
}

run().catch(e => { console.error('❌ Test crashed:', e); process.exit(1); });
