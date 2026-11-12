/**
 * Per-department carry-forward setting + "Carry forward tasks" / "Today's tasks" headings (owner 2026-10-14).
 * OFFLINE: fake database URL, every database read stubbed, network blocked, no WhatsApp.
 * Run: npx tsx task-manager/tests/test_carry_forward_setting.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- stubs replace services and DTOs on purpose */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const D = await import('../TaskDatabaseService');
    const T = await import('../brain/text');
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    const db = D.TaskDatabaseService as any;

    console.log('\n1. The setting');
    check('missing or odd values → on, 7 days', JSON.stringify(D.normalizeCarryForward(undefined)) === '{"enabled":true,"days":7}' && D.normalizeCarryForward({ enabled: true, days: 31 }).days === 7 && D.normalizeCarryForward({ enabled: true, days: 2.5 }).days === 7);
    // Owner 2026-10-20: any whole number of days up to 30 is allowed (not only 1–7).
    check('up to 30 days is kept', D.normalizeCarryForward({ enabled: true, days: 9 }).days === 9 && D.normalizeCarryForward({ enabled: true, days: 30 }).days === 30 && D.MAX_CARRY_DAYS === 30);
    check('a valid setting is kept', JSON.stringify(D.normalizeCarryForward({ enabled: false, days: 3 })) === '{"enabled":false,"days":3}');
    check('off → look back 0 days; on → the chosen days', D.carryDaysOf({ enabled: false, days: 5 }) === 0 && D.carryDaysOf({ enabled: true, days: 3 }) === 3);

    console.log('\n2. The numbered list follows the department setting');
    let config: any = { carryForward: {} };
    db.getTestingConfig = async () => config;
    const queries: Array<{ table: string; gte?: string; lt?: string }> = [];
    const realFrom = (supabaseAdmin as any).from.bind(supabaseAdmin);
    const today = '2026-10-14';
    const rowsToday = [{ id: 't1', title: 'Today task', status: 'pending', assigned_date: today, created_at: '2026-10-14T05:00:00Z' }];
    const rowsEarlier = [{ id: 'e1', title: 'Old task', status: 'pending', assigned_date: '2026-10-12', created_at: '2026-10-12T05:00:00Z' }];
    (supabaseAdmin as any).from = (table: string) => {
        if (table !== 'task_assignments') return realFrom(table);
        const rec: any = { table }; queries.push(rec);
        const q: any = { select: () => q, eq: () => q, neq: () => q, gte: (_c: string, v: string) => { rec.gte = v; return q; }, lt: (_c: string, v: string) => { rec.lt = v; return q; },
            then: (ok: any) => ok({ data: rec.lt ? rowsEarlier : rowsToday, error: null }) };
        return q;
    };
    D.resetCarryForwardCache();
    let list = await db.getNumberedList({ employeeId: 'u1', date: today, departmentId: 'dept-a' });
    check('no saved setting → 7 days back, carried task first', queries.some(q => q.gte === '2026-10-07') && list[0].title === 'Old task' && list[0].isCarriedForward && list[1].listNumber === 2, { queries, list });

    queries.length = 0; config = { carryForward: { 'dept-a': { enabled: true, days: 3 } } }; D.resetCarryForwardCache();
    list = await db.getNumberedList({ employeeId: 'u1', date: today, departmentId: 'dept-a' });
    check('3 days → only looks back to 11 Oct', queries.some(q => q.gte === '2026-10-11'), queries);

    queries.length = 0; config = { carryForward: { 'dept-a': { enabled: false, days: 3 } } }; D.resetCarryForwardCache();
    list = await db.getNumberedList({ employeeId: 'u1', date: today, departmentId: 'dept-a' });
    check('off → no older tasks are read at all; today\'s list is numbered from 1', queries.length === 1 && !queries[0].lt && list.length === 1 && list[0].title === 'Today task' && list[0].listNumber === 1, { queries, list });

    queries.length = 0; D.resetCarryForwardCache();
    list = await db.getNumberedList({ employeeId: 'u1', date: today, departmentId: 'dept-b' });
    check('another department is not affected (still 7 days)', queries.some(q => q.gte === '2026-10-07'), queries);
    (supabaseAdmin as any).from = realFrom;

    console.log('\n3. Headings');
    const items = [{ carried: true, line: '1. Old task ⏳' }, { carried: false, line: '2. Today task ⏳' }];
    check('carried and today\'s tasks under their own headings, numbers kept', T.headedList(items) === "🔄 *Carry forward tasks*\n1. Old task ⏳\n\n📋 *Today's tasks*\n2. Today task ⏳", T.headedList(items));
    check('nothing carried → the plain list, exactly as before', T.headedList([{ carried: false, line: '1. A' }, { carried: false, line: '2. B' }]) === '1. A\n2. B');
    check('only carried → just the carry-forward heading', T.headedList([{ carried: true, line: '1. A' }]) === '🔄 *Carry forward tasks*\n1. A');
    check('template line: labelled groups on ONE line', T.headedOneLine(items) === 'Carry forward: 1. Old task ⏳ — Today: 2. Today task ⏳' && !/\n/.test(T.headedOneLine(items)));
    check('template line: nothing carried → no labels', T.headedOneLine([{ carried: false, line: '1. A' }, { carried: false, line: '2. B' }]) === '1. A | 2. B');

    const F = await import('../brain/frontDoor');
    const ctx: any = { tasks: [{ n: 1, id: 'e1', title: 'Old task', status: 'pending', from: '2026-10-12' }, { n: 2, id: 't1', title: 'Today task', status: 'pending' }] };
    const view = F.planExact({ kind: 'view' } as any, ctx) as any;
    check('the bot\'s "tasks" reply shows both headings', view?.kind === 'reply' && view.text.includes('🔄 *Carry forward tasks*\n1. Old task (from 12 Oct) ⏳\n\n📋 *Today\'s tasks*\n2. Today task ⏳'), view);

    console.log('\n4. Who can change it (Notifications tab)');
    const R = await import('../DepartmentRulesService');
    const A = await import('../TaskAccessService');
    (A.TaskAccessService as any).check = async () => ({ allowed: true, message: '' });
    let delegated = false;
    (A.TaskAccessService as any).isNotificationsDelegated = async () => delegated;
    let actor: any = { id: 'u1', active: true, role: 'employee', department_id: 'dept-a', department_name: 'Procurement' };
    db.getEmployeeById = async () => actor;
    const saved: any[] = []; const audits: any[] = [];
    db.saveCarryForward = async (dept: string, v: any) => { saved.push({ dept, v }); return D.normalizeCarryForward(v); };
    db.logAudit = async (a: any) => { audits.push(a); };
    let err: any = null;
    try { await R.DepartmentRulesService.saveCarryForward('u1', { enabled: true, days: 3 }); } catch (e) { err = e; }
    check('a team member whose notifications are NOT handed over cannot change it', err?.status === 403 && saved.length === 0, err?.message);
    delegated = true; err = null;
    try { await R.DepartmentRulesService.saveCarryForward('u1', { enabled: true, days: 31 }); } catch (e) { err = e; }
    check('days outside 1–30 are refused', err?.status === 400 && saved.length === 0, err?.message);
    await R.DepartmentRulesService.saveCarryForward('u1', { enabled: true, days: 3, departmentId: 'dept-z' });
    check('saved for THEIR department only, whatever the request says, and recorded', saved.length === 1 && saved[0].dept === 'dept-a' && saved[0].v.days === 3 && audits.some(a => a.eventType === 'carry_forward_setting_saved'), { saved, audits });
    actor = { ...actor, role: 'superuser' }; delegated = false; saved.length = 0;
    await R.DepartmentRulesService.saveCarryForward('u1', { enabled: false, days: 2 });
    check('a superuser can change it', saved.length === 1 && saved[0].v.enabled === false);

    const fs = await import('node:fs'); const path = await import('node:path');
    const ui = fs.readFileSync(path.resolve(__dirname, '../../frontend/components/procurement/tasks/NotificationsView.tsx'), 'utf8');
    const route = fs.readFileSync(path.resolve(__dirname, '../../app/api/task-manager/department-rules/route.ts'), 'utf8');
    check('Notifications tab has the switch, the 1–7 day buttons and a number box up to 30; the API uses the signed-in person', /Include carry-forward tasks/.test(ui) && /\[1, 2, 3, 4, 5, 6, 7\]/.test(ui) && /type="number"/.test(ui) && /const MAX_CARRY_DAYS = 30/.test(ui) && /action === 'save_carry_forward'/.test(route) && /saveCarryForward\(userId,/.test(route));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 CARRY-FORWARD SETTING TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
