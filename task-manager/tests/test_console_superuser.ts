/**
 * Superuser console (OFFLINE: stubbed database, no network, no WhatsApp).
 * Covers: the cross-department "My tasks" view (superusers only) and permanent task delete (who may do it).
 * Run: npx tsx task-manager/tests/test_console_superuser.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { WorkspaceService, WorkspaceError, todayIST } = await import('../WorkspaceService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { HierarchyService } = await import('../HierarchyService');
    const { OrgHierarchy } = await import('../OrgHierarchy');
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');

    const db: any = TaskDatabaseService;
    const access: any = TaskAccessService;

    const today = todayIST();
    const longAgo = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);

    const P = (id: string, name: string, mgr: string | null) => ({ userId: id, profileId: 'p' + id, name, departmentId: 'd', departmentName: '', taskRole: 'employee', managerUserId: mgr });
    const hierarchy = new OrgHierarchy([P('saniel', 'Saniel', null), P('a', 'Vidya', 'saniel'), P('b', 'Satej', 'saniel'), P('c', 'Priya', null)]);
    (HierarchyService as any).load = async () => ({ hierarchy, activeProfiles: 4, withoutUserAccount: 0 });

    const emp = (id: string, name: string, role: string, dept: string) => ({ id, name, phone_number: '9876543210', department_id: dept, department_name: dept, role, active: true });
    const people: Record<string, any> = {
        saniel: emp('saniel', 'Saniel Golechha', 'superuser', 'Management'),
        a: emp('a', 'Vidya Pawar', 'employee', 'Accounts'),
        b: emp('b', 'Satej Sadhye', 'employee', 'Procurement'),
        c: emp('c', 'Priya Pal', 'employee', 'HR'),
    };
    db.getEmployeeById = async (id: string) => people[id] || null;
    db.getAllEmployees = async () => Object.values(people);
    db.logAudit = async (e: any) => { audits.push(e); };
    access.check = async () => ({ allowed: true });

    let audits: any[] = [];
    let rows: any[] = [];
    let deleted: string[] = [];
    (supabaseAdmin as any).from = () => {
        const f: any = { rows: [...rows], del: false };
        const api: any = {
            select: () => api,
            delete: () => { f.del = true; return api; },
            eq: (c: string, v: any) => { f.rows = f.rows.filter((r: any) => r[c] === v); return api; },
            neq: (c: string, v: any) => { f.rows = f.rows.filter((r: any) => r[c] !== v); return api; },
            gte: (c: string, v: string) => { f.rows = f.rows.filter((r: any) => r[c] >= v); return api; },
            maybeSingle: async () => ({ data: f.rows[0] || null, error: null }),
            then: (res: any) => {
                if (f.del) { f.rows.forEach((r: any) => deleted.push(r.id)); return res({ error: null }); }
                return res({ data: f.rows, error: null });
            },
        };
        return api;
    };

    const T = (id: string, owner: string, by: string | null, status: string, date = today) => ({ id, title: `Task ${id}`, description: null, employee_id: owner, assigned_by: by, assigned_date: date, status });
    rows = [
        T('m1', 'saniel', 'a', 'pending'),                 // given to Saniel by Vidya (Accounts)
        T('m2', 'saniel', 'b', 'in_progress', longAgo),    // old but open: still shown
        T('m3', 'saniel', 'saniel', 'pending'),            // his own note
        T('m4', 'saniel', 'a', 'completed', longAgo),      // finished long ago: hidden
        T('m5', 'saniel', 'a', 'completed'),               // finished today: shown
        T('g1', 'b', 'saniel', 'pending'),                 // Saniel gave to Satej (Procurement)
        T('g2', 'c', 'saniel', 'completed'),               // Saniel gave to Priya (HR), done today
        T('o1', 'a', 'b', 'pending'),                      // nothing to do with Saniel
    ];

    console.log('\n1. The cross-department view');
    let denied = '';
    try { await WorkspaceService.loadConsole('a'); } catch (e: any) { denied = e instanceof WorkspaceError ? e.code || '' : 'other'; }
    check('a non-superuser is refused', denied === 'NOT_SUPERUSER', denied);

    const c = await WorkspaceService.loadConsole('saniel');
    const ids = (l: any[]) => l.map(t => t.id).sort().join();
    check('"mine": open tasks of any age + finished this week; not old finished ones', ids(c.mine) === 'm1,m2,m3,m5', ids(c.mine));
    check('"mine" shows who gave it and from which department', c.mine.find(t => t.id === 'm1')?.personName === 'Vidya Pawar' && c.mine.find(t => t.id === 'm1')?.department === 'Accounts', c.mine);
    check('a note to himself reads "Yourself"', c.mine.find(t => t.id === 'm3')?.personName === 'Yourself');
    check('"given": tasks he gave to others, across departments, never his own', ids(c.given) === 'g1,g2', ids(c.given));
    check('"given" names the holder and their department', c.given.find(t => t.id === 'g1')?.personName === 'Satej Sadhye' && c.given.find(t => t.id === 'g1')?.department === 'Procurement', c.given);
    check('department list for the dropdown', c.departments.join() === 'Accounts,HR,Management,Procurement', c.departments);

    console.log('\n2. Deleting a task for good');
    deleted = []; audits = [];
    await WorkspaceService.deleteTask('saniel', { taskId: 'm1' });
    check('the holder (a superuser) can delete', deleted.join() === 'm1');
    check('the delete is written to the audit log first', audits.length === 1 && audits[0].eventType === 'task_deleted' && audits[0].taskId === 'm1', audits);

    deleted = [];
    await WorkspaceService.deleteTask('saniel', { taskId: 'g1' });
    check('the person who gave a task can delete it from the other person\'s list', deleted.join() === 'g1');

    deleted = [];
    let err = '';
    try { await WorkspaceService.deleteTask('c', { taskId: 'o1' }); } catch (e: any) { err = e.name; }
    check('someone with no connection to the task is refused and nothing is deleted', err === 'PermissionDeniedError' && deleted.length === 0, { err, deleted });

    err = '';
    try { await WorkspaceService.deleteTask('saniel', { taskId: 'nope' }); } catch (e: any) { err = e instanceof WorkspaceError ? String(e.status) : 'other'; }
    check('an unknown task is a 404', err === '404', err);

    console.log(failures ? `\n❌ ${failures} FAILED` : '\n🎉 CONSOLE SUPERUSER TESTS PASSED');
    process.exit(failures ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
