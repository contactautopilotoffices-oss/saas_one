/* eslint-disable @typescript-eslint/no-explicit-any -- stubs replace services and DTOs on purpose (same as the other tests) */
/**
 * Due dates (owner 2026-10-27) — OFFLINE: fixed clocks, no network, no database, no WhatsApp.
 *   1. Countdown on open cards        2. On time / late on finished cards     3. Checking a deadline
 *   4. When the reminder goes out     5. The server and the Control Center keep the rules
 * Run: npx tsx task-manager/tests/test_due_dates_2026_10_27.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const ist = (s: string) => Date.parse(`${s}+05:30`);

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };
    const D = await import('../dueDates');

    console.log('\n1. Countdown on open cards');
    let s = D.openDueStatus({ date: '2026-10-27', time: '16:00' }, '2026-10-27', ist('2026-10-27T16:40:00'));
    check('40 min past a set time → red "Overdue by 40 min"', s.tone === 'late' && s.label === 'Overdue by 40 min', s);
    s = D.openDueStatus({ date: '2026-10-27', time: '20:00' }, '2026-10-27', ist('2026-10-27T16:40:00'));
    check('due later today → amber "Due in 3 h 20 min"', s.tone === 'soon' && s.label === 'Due in 3 h 20 min', s);
    s = D.openDueStatus({ date: '2026-10-27', time: null }, '2026-10-27', ist('2026-10-27T10:00:00'));
    check('date only, today → "Due today"', s.tone === 'soon' && s.label === 'Due today', s);
    s = D.openDueStatus({ date: '2026-11-03', time: '17:00' }, '2026-10-27', ist('2026-10-27T10:00:00'));
    check('a week away → "Due in 7 days" and "Day 1 of 8"', s.tone === 'ok' && s.label === 'Due in 7 days' && s.dayOf?.n === 1 && s.dayOf?.total === 8, s);
    s = D.openDueStatus({ date: '2026-10-30', time: null }, '2026-10-25', ist('2026-10-27T10:00:00'));
    check('started 25 Oct, due 30 Oct, today 27 → "Day 3 of 6"', s.dayOf?.n === 3 && s.dayOf?.total === 6, s);
    s = D.openDueStatus({ date: '2026-10-28', time: null }, '2026-10-27', ist('2026-10-27T10:00:00'));
    check('tomorrow → "Due tomorrow"', s.label === 'Due tomorrow', s);
    s = D.openDueStatus({ date: '2026-10-25', time: null }, '2026-10-25', ist('2026-10-27T10:00:00'));
    check('date only, two days past → "Overdue by 2 days" (days, not hours)', s.tone === 'late' && s.label === 'Overdue by 2 days', s);
    s = D.openDueStatus({ date: '2026-10-27', time: null }, '2026-10-27', ist('2026-10-27T23:30:00'));
    check('date only is due at the END of the day (11:30 pm is not late)', s.tone === 'soon', s);

    console.log('\n2. On time / late on finished cards');
    const iso = (s2: string) => new Date(ist(s2)).toISOString();
    let d = D.doneDueStatus({ date: '2026-10-27', time: '20:00' }, iso('2026-10-27T18:25:00'));
    check('done 1 h 35 min before → "Done on time · 1 h 35 min early"', d.onTime && d.label === 'Done on time · 1 h 35 min early', d);
    d = D.doneDueStatus({ date: '2026-10-27', time: '16:00' }, iso('2026-10-27T18:15:00'));
    check('done 2 h 15 min after → "Done 2 h 15 min late"', !d.onTime && d.label === 'Done 2 h 15 min late', d);
    d = D.doneDueStatus({ date: '2026-10-30', time: null }, iso('2026-10-31T09:00:00'));
    check('date only, done the next day → "Done 1 day late" (days)', !d.onTime && d.label === 'Done 1 day late', d);
    d = D.doneDueStatus({ date: '2026-10-30', time: null }, iso('2026-10-30T23:00:00'));
    check('date only, done late on the due day → on time', d.onTime && d.label === 'Done on time', d);

    console.log('\n3. Checking a deadline');
    check('no date → no deadline', (D.checkDue('2026-10-27', undefined, undefined) as any).due === null);
    check('a time without a date is refused', !D.checkDue('2026-10-27', '', '17:00').ok);
    check('before the start date is refused', !D.checkDue('2026-10-27', '2026-10-26', null).ok);
    check('an impossible date is refused', !D.checkDue('2026-10-27', '2026-02-30', null).ok);
    check('month 13 is refused, not a crash', !D.checkDue('2026-10-27', '2026-13-45', null).ok);
    check('a deadline is announced only when it was saved, and refused before saving when not set up', /dueSaved \? ` \(due \$\{dueLabel\(dueSaved\)\}\)`/.test(read('task-manager/WorkspaceService.ts')) && /'NOT_READY'/.test(read('task-manager/WorkspaceService.ts')));
    check('reminder batch only reads people in ON departments, oldest first, within a time budget', /on\.departments\.has\(e\.department_id\)/.test(read('task-manager/TaskDueService.ts')) && /order\('due_date'/.test(read('task-manager/TaskDueService.ts')) && /TIME_BUDGET_MS/.test(read('task-manager/TaskDueService.ts')));
    check('a bad time is refused', !D.checkDue('2026-10-27', '2026-10-28', '25:00').ok && !D.checkDue('2026-10-27', '2026-10-28', '5pm').ok);
    check('more than a year ahead is refused', !D.checkDue('2026-10-27', '2027-12-01', null).ok);
    const good = D.checkDue('2026-10-27', '2026-11-03', '17:00') as any;
    check('a good deadline is kept as sent', good.ok && good.due.date === '2026-11-03' && good.due.time === '17:00');

    console.log('\n4. When the reminder goes out');
    check('with a time: 2 hours before', D.reminderAt({ date: '2026-10-27', time: '20:00' }) === ist('2026-10-27T18:00:00'));
    check('date only: 5 pm the day before', D.reminderAt({ date: '2026-10-30', time: null }) === ist('2026-10-29T17:00:00'));
    check('labels read naturally', D.dueLabel({ date: '2026-11-03', time: '17:00' }) === 'Tue 3 Nov, 5:00 pm' && D.dueLabel({ date: '2026-10-30', time: null }) === 'Fri 30 Oct');
    check('"17:00:00" from the database → "17:00"', D.shortTime('17:00:00') === '17:00' && D.shortTime(null) === null);

    console.log('\n5. The server and the Control Center keep the rules');
    const sql = read('supabase/migrations/20261027100001_task_manager_due_dates.sql');
    check('migration is additive only (no DROP / DELETE / UPDATE / TRUNCATE outside comments)', !/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im.test(sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')));
    check('migration: switch is OFF by default', /due_dates BOOLEAN NOT NULL DEFAULT false/.test(sql));
    const access = read('task-manager/TaskAccessService.ts');
    check('the three older switches are still read on their own (a missing due_dates column cannot switch them off)', /\.select\('department_id, pending_on, protect_given, assigned_tab'\)/.test(access) && /\.select\('department_id, due_dates'\)/.test(access));
    check('"due_dates" is a team feature the access route accepts', /TEAM_FEATURES = \[[^\]]*'due_dates'/.test(access));
    const ws = read('task-manager/WorkspaceService.ts');
    check('setting a deadline needs the switch (or a superuser)', /Due dates are switched off for your team/.test(ws) && /actor\.role === 'superuser' \|\| await TaskAccessService\.isDueDatesEnabled/.test(ws));
    check('a task within its deadline is not "carried forward"', /isCarriedForward: \(r\.assigned_date as string\) < date && !\(/.test(ws));
    check('edit: changing the deadline sends a new reminder later', /due_reminded_at: null/.test(ws));
    const due = read('task-manager/TaskDueService.ts');
    check('reminder: claimed before sending, once per task, only while open', /\.is\('due_reminded_at', null\)\.neq\('status', 'completed'\)\.select\('id'\)/.test(due));
    check('reminder: only for departments with the switch ON, and unlocked people', /on\.departments\.has\(holder\.department_id\)/.test(due) && /TaskAccessService\.check/.test(due));
    check('reminder: WhatsApp only as an approved template', /templateOnly: true/.test(read('task-manager/taskAlerts.ts').slice(read('task-manager/taskAlerts.ts').indexOf('sendTaskDueSoon'))));
    check('reminder runs from the 15-minute job, not in a dry run', /if \(!dryRun\) await runDueReminders\(\)/.test(read('app/api/cron/task-manager/route.ts')));
    const panel = read('frontend/components/task-manager/TaskAccessPanel.tsx');
    check('Control Center: switches are real on/off switches', /role="switch" aria-checked=\{checked\}/.test(panel));
    check('Control Center: a "Due dates" switch per department', /label: 'Due dates'/.test(panel) && /toggleTeamFeature\(d, 'due_dates'\)/.test(panel));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 DUE DATE TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
