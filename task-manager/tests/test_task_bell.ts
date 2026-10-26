/**
 * Owner 2026-10-20 — Task Manager events in the dashboard bell (100% OFFLINE: fake data, recorders; nothing is sent).
 *   - where a bell click opens the Task Manager (HR, Procurement, super admin)
 *   - "a task you gave is done" → a bell for the giver, once per group
 *   - a superuser's reply → a bell for each person who gave the tasks
 *   - every event is wired in the code that sends the matching WhatsApp alert
 * Run: npx tsx task-manager/tests/test_task_bell.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- recorders stand in for services on purpose */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
import fs from 'fs';
import path from 'path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { taskManagerLink, shortList } = await import('../taskBell');
    const { notifyGiversOfCompletion } = await import('../completionNotice');
    const { relayToAssigners } = await import('../brain/relay');

    console.log('\n1. Where a bell click opens the Task Manager');
    check('super admin → the org dashboard Task Manager', taskManagerLink('org1', 'org_super_admin', 'Human Resources') === '/org1/dashboard?tab=tasks');
    check('HR → the HR Task Manager tab', taskManagerLink('org1', 'member', 'Human Resources') === '/org1/hr-tickets?tab=tasks' && taskManagerLink('org1', 'member', 'HR') === '/org1/hr-tickets?tab=tasks');
    check('Procurement → the Procurement Tasks tab', taskManagerLink('org1', 'member', 'Procurement') === '/procurement?tab=tasks');
    check('other teams → no link (the bell still shows)', taskManagerLink('org1', 'member', 'Tech') === null);
    check('long lists are shortened', shortList(['a', 'b', 'c', 'd', 'e']) === 'a, b, c and 2 more');

    console.log('\n2. A task you gave is done → bell for the giver');
    const bells: any[] = [];
    const people: Record<string, any> = {
        g: { id: 'g', name: 'Neeti', phone_number: '919999999999', department_name: 'HR', department_id: 'd', active: true },
        h: { id: 'h', name: 'Srushti', phone_number: '918888888888', department_name: 'HR', department_id: 'd', active: true },
    };
    await notifyGiversOfCompletion([{ id: 't1', title: 'Onboarding', employee_id: 'h', assigned_by: 'g' }, { id: 't2', title: 'Hampers', employee_id: 'h', assigned_by: 'g' }], {
        recentlyNotified: async () => new Set(), person: async id => people[id], audit: async () => undefined, send: async () => true,
        bell: async (giverId, dept, titles, by) => { bells.push({ giverId, dept, titles, by }); },
    });
    check('ONE bell for Neeti listing both tasks, from Srushti', bells.length === 1 && bells[0].giverId === 'g' && bells[0].titles.length === 2 && bells[0].by === 'Srushti', bells);
    bells.length = 0;
    await notifyGiversOfCompletion([{ id: 't3', title: 'Mine', employee_id: 'g', assigned_by: 'g' }], {
        recentlyNotified: async () => new Set(), person: async id => people[id], audit: async () => undefined, send: async () => true,
        bell: async (...a: any[]) => { bells.push(a); },
    });
    check('your own task → no bell', bells.length === 0, bells);

    console.log('\n3. A superuser replies → bell for the people who gave the tasks');
    const relayBells: any[] = [];
    await relayToAssigners({ actor: { id: 'r', name: 'Rushabh', phone_number: '917777777777', department_name: 'Management', active: true }, taskIds: ['p1'], state: 'working', note: null }, {
        tasksByIds: async () => [{ id: 'p1', title: 'Approve budget', assigned_by: 'g' }],
        getPerson: async id => people[id], send: async () => true, audit: async () => undefined,
        bell: async (id, update, from, titles) => { relayBells.push({ id, update, from, titles }); },
    });
    check('Neeti gets a bell: "Working on it" from Rushabh about her task', relayBells.length === 1 && relayBells[0].id === 'g' && relayBells[0].update === 'Working on it' && /Rushabh/.test(relayBells[0].from), relayBells);

    console.log('\n4. Every event is wired next to its WhatsApp alert');
    const src = (f: string) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    const ws = src('WorkspaceService.ts');
    check('assigned (single and grouped), handed over', (ws.match(/kind: 'TASK_ASSIGNED'/g) || []).length === 2 && /kind: 'TASK_HANDOVER'/.test(ws));
    check('edited / renamed / note / deleted by someone else → the holder', (ws.match(/bellHolderOfChange\(actor, row,/g) || []).length === 4 && /if \(row\.employee_id === actor\.id\) return;/.test(ws));
    check('pending on you and remind use the same bell (with the link)', /kind: 'TASK_DEPENDENCY'/.test(ws) && /kind: 'TASK_REMINDER'/.test(ws));
    check('overdue: one summary per person when the overdue alert runs', /kind: 'TASK_OVERDUE'/.test(src('TaskNotificationService.ts')));
    check('older assign paths too (WhatsApp commands, older web route)', /kind: 'TASK_ASSIGNED'/.test(src('TaskCommandHandler.ts')) && /kind: 'TASK_ASSIGNED'/.test(fs.readFileSync(path.resolve(__dirname, '../../app/api/task-manager/tasks/route.ts'), 'utf8')));

    console.log(failures === 0 ? '\n🎉 TASK BELL TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
