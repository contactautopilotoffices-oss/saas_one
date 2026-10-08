/**
 * Step 5 — Procurement Tasks tab + team sharing (OFFLINE: stubbed database, no network, no WhatsApp).
 * Scenario: Saniel (founder, superuser) above four Procurement members; peers may share only when the switch is ON.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { PermissionService } = await import('../PermissionService');
    const { WorkspaceService, WorkspaceError } = await import('../WorkspaceService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { TaskMessagingService } = await import('../TaskMessagingService');
    const { HierarchyService } = await import('../HierarchyService');
    const { OrgHierarchy } = await import('../OrgHierarchy');
    const { TaskCommandHandler } = await import('../TaskCommandHandler');
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');

    const db: any = TaskDatabaseService;
    const access: any = TaskAccessService;

    const P = (id: string, name: string, mgr: string | null) => ({ userId: id, profileId: 'p' + id, name, departmentId: id === 'saniel' ? 'mgmt' : 'proc', departmentName: '', taskRole: 'employee', managerUserId: mgr });
    const hierarchy = new OrgHierarchy([P('saniel', 'Saniel', null), P('a', 'Vidya', 'saniel'), P('b', 'Satej', 'saniel'), P('c', 'Priya', 'saniel'), P('d', 'Sahil', 'saniel')]);
    (HierarchyService as any).load = async () => ({ hierarchy, activeProfiles: 5, withoutUserAccount: 0 });

    const emp = (id: string, name: string, role = 'employee', dept = 'proc') => ({ id, name, phone_number: '9876543210', department_id: dept, department_name: dept, role, active: true });
    const people: Record<string, any> = {
        saniel: emp('saniel', 'Saniel Golechha', 'superuser', 'mgmt'),
        a: emp('a', 'Vidya Pawar'), b: emp('b', 'Satej Sadhye'), c: emp('c', 'Priya Pal'), d: emp('d', 'Sahil S'),
        x: emp('x', 'Other Dept', 'employee', 'ops'),
    };
    const all = Object.values(people);

    let sharing = true;
    let lockedIds = new Set<string>();
    let sent: string[] = [];
    let created: any[] = [];
    let updated: any[] = [];
    const taskRows: any[] = [
        { id: 't-a', title: 'Call vendor', description: null, employee_id: 'a', assigned_date: '2026-10-07', status: 'pending', created_at: '1' },
        { id: 't-b', title: 'Prepare PO', description: null, employee_id: 'b', assigned_date: '2026-10-07', status: 'in_progress', created_at: '2' },
        { id: 't-old', title: 'Old follow up', description: null, employee_id: 'a', assigned_date: '2026-10-05', status: 'pending', created_at: '0' },
    ];

    db.getEmployeeById = async (id: string) => people[id] || null;
    db.getAllEmployees = async () => all;
    db.getDepartmentByName = async () => ({ id: 'proc', name: 'Procurement' });
    db.createTaskAssignment = async (p: any) => { const t = { id: 'new', title: p.title, description: p.description || null, assigned_date: p.assignedDate, employee_id: p.employeeId }; created.push(t); return t; };
    db.updateAssignmentStatus = async (p: any) => { updated.push(p); return { id: p.assignmentId, status: p.status }; };
    db.logAudit = async () => {};
    access.isPeerAssignEnabled = async (dept: string) => sharing && dept === 'proc';
    access.getSnapshot = async () => ({
        provisioned: true, readable: true,
        departmentEnabled: new Map([['proc', true], ['mgmt', true], ['ops', false]]),
        onboarded: new Map(['saniel', 'a', 'b', 'c', 'd', 'x'].filter(i => !lockedIds.has(i)).map(i => [i, { userId: i }])),
    });
    access.check = async (person: any) => TaskAccessService.decide(await access.getSnapshot(), person);
    (TaskMessagingService as any).sendMessage = async (_p: string, t: string) => { sent.push(t); return true; };

    // Fake task query: .select().in().eq()/.lt().gte().neq() and .select().eq().maybeSingle()
    (supabaseAdmin as any).from = (_t: string) => {
        const f: any = { rows: taskRows, _in: null as string[] | null };
        const api: any = {
            select: () => api,
            in: (_c: string, ids: string[]) => { f._in = ids; return api; },
            eq: (col: string, v: any) => { if (col === 'assigned_date') f.rows = f.rows.filter((r: any) => r.assigned_date === v); if (col === 'id') f.rows = f.rows.filter((r: any) => r.id === v); return api; },
            lt: (_c: string, v: string) => { f.rows = f.rows.filter((r: any) => r.assigned_date < v); return api; },
            gte: (_c: string, v: string) => { f.rows = f.rows.filter((r: any) => r.assigned_date >= v); return api; },
            neq: (_c: string, v: string) => { f.rows = f.rows.filter((r: any) => r.status !== v); return api; },
            maybeSingle: async () => ({ data: f.rows[0] || null, error: null }),
            then: (res: any) => res({ data: f.rows.filter((r: any) => !f._in || f._in.includes(r.employee_id)), error: null }),
        };
        return api;
    };

    const canAssign = async (actor: string, target: string) => { try { await PermissionService.assertCanAssignTask(actor, target); return true; } catch { return false; } };

    console.log('\n1. The shared rule (team sharing ON for Procurement)');
    sharing = true;
    check('a member can assign to a teammate', await canAssign('a', 'b'));
    check('a member can assign to themselves', await canAssign('a', 'a'));
    check('a member still cannot assign to Saniel', !(await canAssign('a', 'saniel')));
    check('a member cannot assign to another department', !(await canAssign('a', 'x')));
    check('Saniel can assign to everyone', (await Promise.all(['a', 'b', 'c', 'd', 'x'].map(t => canAssign('saniel', t)))).every(Boolean));
    const readOk = async (actor: string, owner: string) => { try { await PermissionService.assertCanReadTask(actor, { id: 't', employee_id: owner } as any); return true; } catch { return false; } };
    check('a member can VIEW a teammate\'s task', await readOk('a', 'b'));
    const completeOk = async (actor: string, owner: string) => { try { await PermissionService.assertCanCompleteTask(actor, { id: 't', employee_id: owner } as any); return true; } catch { return false; } };
    check('a member can NOT complete a teammate\'s task', !(await completeOk('a', 'b')));
    check('a member can complete their own task', await completeOk('a', 'a'));
    check('Saniel can complete any task', await completeOk('saniel', 'a'));

    console.log('\n2. Team sharing OFF (the default)');
    sharing = false;
    check('teammates can NOT assign to each other', !(await canAssign('a', 'b')));
    check('...but can still assign to themselves', await canAssign('a', 'a'));
    check('...and can not view a teammate\'s task', !(await readOk('a', 'b')));
    check('Saniel is unaffected', await canAssign('saniel', 'a'));
    sharing = true;

    console.log('\n3. The Tasks tab (workspace)');
    let w: any = await WorkspaceService.load('a', { date: '2026-10-07' });
    check('a member sees the whole Procurement team (sharing ON)', w.state === 'ok' && w.members.map((m: any) => m.userId).sort().join() === 'a,b,c,d', w.members);
    check('...never another department', !w.members.some((m: any) => m.userId === 'x'));
    check('own task can be changed, a teammate\'s cannot', w.tasks.find((t: any) => t.id === 't-a').canChange === true && w.tasks.find((t: any) => t.id === 't-b').canChange === false);
    check('an unfinished task from earlier days is carried forward', w.tasks.find((t: any) => t.id === 't-old')?.isCarriedForward === true);
    check('the assign list: self + teammates, not Saniel or other departments', w.assignable.map((x: any) => x.userId).sort().join() === 'a,b,c,d', w.assignable);

    sharing = false;
    w = await WorkspaceService.load('a', { date: '2026-10-07' });
    check('sharing OFF: a member sees only themselves', w.members.length === 1 && w.members[0].userId === 'a', w.members);
    sharing = true;

    w = await WorkspaceService.load('saniel', { date: '2026-10-07', departmentName: 'Procurement' });
    check('Saniel sees the Procurement team and can change every card', w.state === 'ok' && w.members.length === 4 && w.tasks.every((t: any) => t.canChange), w);

    lockedIds = new Set(['a']);
    w = await WorkspaceService.load('a', { date: '2026-10-07' });
    check('a locked person only gets the lock screen (no tasks, no team)', w.state === 'locked' && !w.tasks && !w.members, w);
    lockedIds = new Set(['b']);
    w = await WorkspaceService.load('a', { date: '2026-10-07' });
    check('a locked teammate is not offered in the assign list', !w.assignable.some((x: any) => x.userId === 'b'), w.assignable);
    lockedIds = new Set();

    console.log('\n4. Actions from the tab');
    created = []; sent = [];
    await WorkspaceService.assign('a', { targetUserId: 'b', title: 'Send quotation', date: '2026-10-07' });
    check('assign to a teammate works and is created for them', created.length === 1 && created[0].employee_id === 'b');
    await new Promise(r => setTimeout(r, 10));
    check('the teammate is told through the safety gate (message handed to the gate, not to WhatsApp)', sent.length === 1 && /New Task Assigned/.test(sent[0]));
    sent = [];
    await WorkspaceService.assign('a', { targetUserId: 'a', title: 'My own item' });
    await new Promise(r => setTimeout(r, 10));
    check('adding to your own list sends nobody a message', sent.length === 0);

    sharing = false; created = [];
    let denied = false;
    try { await WorkspaceService.assign('a', { targetUserId: 'b', title: 'Nope' }); } catch (e: any) { denied = e.name === 'PermissionDeniedError'; }
    check('sharing OFF: assigning to a teammate is refused', denied && created.length === 0);
    sharing = true;

    lockedIds = new Set(['b']);
    let lockedErr: any = null;
    try { await WorkspaceService.assign('a', { targetUserId: 'b', title: 'x' }); } catch (e) { lockedErr = e; }
    check('assigning to a locked person is refused (409)', lockedErr instanceof WorkspaceError && lockedErr.status === 409, lockedErr);
    lockedIds = new Set();

    updated = [];
    await WorkspaceService.setStatus('a', { taskId: 't-a', status: 'in_progress' });
    check('a member can move their own card', updated.length === 1 && updated[0].status === 'in_progress');
    let moveDenied = false;
    try { await WorkspaceService.setStatus('a', { taskId: 't-b', status: 'completed' }); } catch (e: any) { moveDenied = e.name === 'PermissionDeniedError'; }
    check('a member cannot move a teammate\'s card', moveDenied && updated.length === 1);
    await WorkspaceService.setStatus('saniel', { taskId: 't-b', status: 'completed' });
    check('Saniel can move any card', updated.length === 2);
    let badInput = false;
    try { await WorkspaceService.setStatus('a', { taskId: 't-a', status: 'hacked' }); } catch (e: any) { badInput = e.status === 400; }
    check('an invalid status is rejected', badInput);

    console.log('\n5. WhatsApp agrees with the web');
    const replies: string[] = [];
    (TaskMessagingService as any).sendMessage = async (_p: string, t: string) => { replies.push(t); return true; };
    db.getEmployeeByPhone = async () => people.a;
    db.setConversationContext = async () => ({});
    db.getDailyAssignments = async () => [];
    db.getEmployeesByDepartment = async () => all.filter(e => e.department_id === 'proc');
    created = [];
    sharing = true;
    let r = await TaskCommandHandler.handleCommand({ phone: '9876543210', text: 'assign Satej Send quotation', date: '2026-10-07' });
    check('sharing ON: "assign Satej …" on WhatsApp works for a teammate', r.success === true && created.length === 1, r.replyText);
    sharing = false; created = [];
    r = await TaskCommandHandler.handleCommand({ phone: '9876543210', text: 'assign Satej Send quotation', date: '2026-10-07' });
    check('sharing OFF: the same message is refused on WhatsApp', r.success === false && created.length === 0, r.replyText);
    sharing = true;
    replies.length = 0;
    r = await TaskCommandHandler.handleCommand({ phone: '9876543210', text: 'team', date: '2026-10-07' });
    check('"team" on WhatsApp lists teammates when sharing is ON', /Satej/.test(replies[0] || '') && !/Other Dept/.test(replies[0] || ''), replies[0]);
    sharing = false; replies.length = 0;
    r = await TaskCommandHandler.handleCommand({ phone: '9876543210', text: 'team', date: '2026-10-07' });
    check('"team" shows only yourself when sharing is OFF', !/Satej/.test(replies[0] || '') && /Vidya/.test(replies[0] || ''), replies[0]);

    console.log(failures === 0 ? '\n🎉 STEP 5 TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
