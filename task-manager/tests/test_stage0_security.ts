/**
 * Stage 0 — API access checks (OFFLINE). Who may call each Task Manager route.
 * Every route is called three ways: not signed in, signed in as an ordinary employee, signed in as an admin.
 * The database address is fake, so nothing real is read or changed; sign-in is replaced by a stub.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
process.env.CRON_SECRET = 'test-secret';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { NextRequest } = await import('next/server');
    const { TaskManagerAuth } = await import('../../app/api/task-manager/_shared/adminGuard');
    const auth: any = TaskManagerAuth;

    let user: { id: string; email: string } | null = null;
    let admin = false;
    auth.currentUser = async () => user;
    auth.isAdmin = async () => admin;
    const as = (who: 'anon' | 'employee' | 'admin') => {
        user = who === 'anon' ? null : { id: who === 'admin' ? 'admin-1' : 'emp-1', email: `${who}@example.com` };
        admin = who === 'admin';
    };

    const req = (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
        new NextRequest(`http://localhost${url}`, { method: init?.method || 'GET', headers: init?.headers, body: init?.body ? JSON.stringify(init.body) : undefined });
    // A route that passes the guard may still fail later (fake database): that is fine. We only look at the guard's answer.
    const status = async (fn: () => Promise<Response>) => { try { return (await fn()).status; } catch { return 599; } };
    const refused = (s: number) => s === 401 || s === 403;

    const routes: Array<[string, () => Promise<Response>]> = [];
    const add = async (label: string, mod: string, method: 'GET' | 'POST', url: string, body?: unknown) => {
        const m: any = await import(mod);
        routes.push([label, () => m[method](req(url, { method, body: body ?? (method === 'POST' ? {} : undefined) }))]);
    };
    const base = '../../app/api/task-manager';
    await add('testing-config GET', `${base}/testing-config/route`, 'GET', '/api/task-manager/testing-config');
    await add('testing-config POST (kill switch)', `${base}/testing-config/route`, 'POST', '/api/task-manager/testing-config', { action: 'toggle_global_kill_switch', halt: false });
    await add('testing-config POST (send now)', `${base}/testing-config/route`, 'POST', '/api/task-manager/testing-config', { action: 'trigger_dispatch', dryRun: false });
    await add('manager-role GET (people + phones)', `${base}/manager-role/route`, 'GET', '/api/task-manager/manager-role');
    await add('manager-role POST (kickoffs, roles)', `${base}/manager-role/route`, 'POST', '/api/task-manager/manager-role', { employeeId: 'x', action: 'send_employee_kickoff' });
    await add('reminders POST (can message a phone)', `${base}/reminders/route`, 'POST', '/api/task-manager/reminders', { action: 'nudge_member', phone: '9876543210' });
    await add('dashboard GET (old)', `${base}/dashboard/route`, 'GET', '/api/task-manager/dashboard');
    await add('dashboard POST (old)', `${base}/dashboard/route`, 'POST', '/api/task-manager/dashboard', { action: 'create_task' });

    console.log('\n1. Admin-only routes');
    for (const [label, call] of routes) {
        as('anon');
        const anon = await status(call);
        as('employee');
        const emp = await status(call);
        as('admin');
        const adm = await status(call);
        check(`${label}: not signed in → 401, employee → 403, admin → let through`, anon === 401 && emp === 403 && !refused(adm), { anon, emp, adm });
    }

    console.log('\n2. Task and progress routes act as the person who is signed in');
    const tasks: any = await import(`${base}/tasks/route`);
    const progress: any = await import(`${base}/progress/route`);
    as('anon');
    check('tasks (read): not signed in → 401', await status(() => tasks.GET(req('/api/task-manager/tasks?actorId=emp-1'))) === 401);
    as('employee');
    check('tasks (read): claiming to be someone else → 403', await status(() => tasks.GET(req('/api/task-manager/tasks?actorId=admin-1'))) === 403);
    check('tasks (write): claiming to be someone else → 403', await status(() => tasks.POST(req('/api/task-manager/tasks', { method: 'POST', body: { actorId: 'admin-1', action: 'assign_task' } }))) === 403);
    check('progress: claiming to be someone else → 403', await status(() => progress.GET(req('/api/task-manager/progress?actorId=admin-1&level=3'))) === 403);
    const own = await tasks.GET(req('/api/task-manager/tasks?actorId=emp-1')).catch(() => null);
    const ownBody = own ? await own.json().catch(() => ({})) : {};
    check('tasks (read): acting as yourself passes the check (no "act as yourself" refusal)', !/only act as yourself/i.test(String(ownBody.error || '')) && own?.status !== 401, ownBody);
    const noClaim = await tasks.GET(req('/api/task-manager/tasks')).catch(() => null);
    check('tasks (read): no actorId at all uses the login (no longer "missing actorId")', noClaim?.status !== 400);

    console.log('\n3. The two trigger endpoints (they can generate tasks and send messages)');
    const daily: any = await import(`${base}/cron/daily-tasks/route`);
    const morning: any = await import(`${base}/cron/morning-notifications/route`);
    for (const [label, mod] of [['daily-tasks', daily], ['morning-notifications', morning]] as const) {
        as('anon');
        check(`${label}: nobody → 401`, await status(() => mod.GET(req(`/api/task-manager/cron/${label}`))) === 401);
        check(`${label}: the old "?confirm=yes" shortcut no longer works`, await status(() => mod.GET(req(`/api/task-manager/cron/${label}?confirm=yes`))) === 401);
        check(`${label}: the old "?actorId=..." shortcut no longer works`, await status(() => mod.GET(req(`/api/task-manager/cron/${label}?actorId=anyone`))) === 401);
        as('employee');
        check(`${label}: an ordinary employee → 401/403`, refused(await status(() => mod.GET(req(`/api/task-manager/cron/${label}`)))));
        as('anon');
        check(`${label}: the scheduler secret is accepted`, !refused(await status(() => mod.GET(req(`/api/task-manager/cron/${label}`, { headers: { authorization: 'Bearer test-secret' } })))));
        check(`${label}: a wrong secret is refused`, await status(() => mod.GET(req(`/api/task-manager/cron/${label}`, { headers: { authorization: 'Bearer nope' } }))) === 401);
        as('admin');
        check(`${label}: a signed-in admin is accepted`, !refused(await status(() => mod.GET(req(`/api/task-manager/cron/${label}`)))));
    }

    console.log(failures === 0 ? '\n🎉 STAGE 0 SECURITY TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
