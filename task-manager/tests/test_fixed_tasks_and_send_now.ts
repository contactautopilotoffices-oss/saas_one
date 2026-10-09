/**
 * Locked (personal fixed) tasks and "Send now" (OFFLINE: in-memory database, no network, no WhatsApp).
 * Run: npx tsx task-manager/tests/test_fixed_tasks_and_send_now.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { WorkspaceService, WorkspaceError } = await import('../WorkspaceService');
    const { TaskDailyGeneratorService } = await import('../TaskDailyGeneratorService');
    const { DepartmentRulesService, RulesError } = await import('../DepartmentRulesService');
    const { PersonalRulesService } = await import('../PersonalRulesService');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { HierarchyService } = await import('../HierarchyService');
    const { OrgHierarchy } = await import('../OrgHierarchy');
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');

    const db: any = TaskDatabaseService;
    const access: any = TaskAccessService;

    // ---- a tiny in-memory database
    const tables: Record<string, any[]> = { task_assignments: [], task_templates: [] };
    let seq = 0;
    (supabaseAdmin as any).from = (name: string) => {
        const f: Array<(r: any) => boolean> = [];
        let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
        let payload: any;
        const exec = () => {
            const t = (tables[name] = tables[name] || []);
            if (op === 'insert') {
                const row = { id: `${name}-${++seq}`, ...payload };
                if (name === 'task_assignments' && row.task_template_id && t.some(r => r.employee_id === row.employee_id && r.task_template_id === row.task_template_id && r.assigned_date === row.assigned_date)) {
                    return { data: null, error: { code: '23505', message: 'duplicate' } };
                }
                t.push(row);
                return { data: [row], error: null };
            }
            const hit = t.filter(r => f.every(fn => fn(r)));
            if (op === 'update') { hit.forEach(r => Object.assign(r, payload)); return { data: hit, error: null }; }
            if (op === 'delete') { tables[name] = t.filter(r => !hit.includes(r)); return { data: null, error: null }; }
            return { data: hit, error: null };
        };
        const api: any = {
            select: () => api,
            insert: (p: any) => { op = 'insert'; payload = p; return api; },
            update: (p: any) => { op = 'update'; payload = p; return api; },
            delete: () => { op = 'delete'; return api; },
            eq: (c: string, v: any) => { f.push(r => r[c] === v); return api; },
            neq: (c: string, v: any) => { f.push(r => r[c] !== v); return api; },
            in: (c: string, vs: any[]) => { f.push(r => vs.includes(r[c])); return api; },
            lt: (c: string, v: any) => { f.push(r => r[c] < v); return api; },
            gte: (c: string, v: any) => { f.push(r => r[c] >= v); return api; },
            is: (c: string, v: any) => { f.push(r => (r[c] ?? null) === v); return api; },
            not: (c: string, _o: string, v: any) => { f.push(r => (r[c] ?? null) !== v); return api; },
            limit: () => api,
            order: () => api,
            // like a real database, hand back a COPY of the row
            single: async () => { const r = exec(); return { data: r.data?.[0] ? { ...r.data[0] } : null, error: r.error }; },
            maybeSingle: async () => { const r = exec(); return { data: r.data?.[0] ? { ...r.data[0] } : null, error: r.error }; },
            then: (res: any) => res(exec()),
        };
        return api;
    };

    const P = (id: string, name: string, mgr: string | null) => ({ userId: id, profileId: 'p' + id, name, departmentId: 'd', departmentName: '', taskRole: 'employee', managerUserId: mgr });
    (HierarchyService as any).load = async () => ({ hierarchy: new OrgHierarchy([P('saniel', 'Saniel', null), P('a', 'Vidya', 'saniel'), P('b', 'Satej', 'saniel')]), activeProfiles: 3, withoutUserAccount: 0 });
    const emp = (id: string, name: string, role: string, dept: string) => ({ id, name, phone_number: '9876543210', department_id: dept, department_name: dept, role, active: true });
    const people: Record<string, any> = { saniel: emp('saniel', 'Saniel', 'superuser', 'mgmt'), a: emp('a', 'Vidya', 'employee', 'proc'), b: emp('b', 'Satej', 'employee', 'proc') };
    let rules: any[] = [];
    db.getEmployeeById = async (id: string) => people[id] || null;
    db.getAllEmployees = async () => Object.values(people);
    db.getDepartmentByName = async () => ({ id: 'proc', name: 'Procurement' });
    db.logAudit = async () => {};
    db.getTestingConfig = async () => ({ enabled: false, whatsappPretendMode: true, rules });
    db.updateNotificationRule = async (id: string, u: any) => { rules = rules.some(r => r.id === id) ? rules.map(r => (r.id === id ? { ...r, ...u } : r)) : [...rules, u]; };
    access.check = async () => ({ allowed: true });
    access.partition = async (list: any[]) => ({ allowed: list, locked: [] });
    access.isNotificationsDelegated = async () => false;

    const task = (id: string, owner: string, extra: any = {}) => ({ id, title: `Task ${id}`, description: null, employee_id: owner, assigned_by: owner, assigned_date: '2026-10-05', status: 'pending', task_template_id: null, ...extra });
    const code = async (fn: () => Promise<unknown>) => { try { await fn(); return ''; } catch (e: any) { return e?.code || e?.name || 'error'; } };

    console.log('\n1. Locking and unlocking');
    tables.task_assignments = [task('t1', 'a', { description: 'Check stock\nGiven by Sahil on 5 Oct' }), task('t2', 'b')];
    check('only the holder can lock a task', (await code(() => WorkspaceService.setLocked('b', { taskId: 't1', locked: true }))) === 'NOT_HOLDER');
    check('a lock must say lock or unlock', (await code(() => WorkspaceService.setLocked('a', { taskId: 't1', locked: 'yes' as any }))) === 'WorkspaceError');
    await WorkspaceService.setLocked('a', { taskId: 't1', locked: true });
    const tpl = tables.task_templates[0];
    check('locking makes a personal fixed template for the holder', tables.task_templates.length === 1 && tpl.owner_id === 'a' && tpl.task_type === 'fixed' && tpl.is_active === true, tpl);
    check('...with the hand-over note left out of its text', tpl.description === 'Check stock', tpl.description);
    check('...and links today\'s task to it', tables.task_assignments.find(r => r.id === 't1')?.task_template_id === tpl.id);

    console.log('\n2. A locked task cannot be deleted until it is unlocked');
    check('delete is refused while locked', (await code(() => WorkspaceService.deleteTask('a', { taskId: 't1' }))) === 'LOCKED' && tables.task_assignments.some(r => r.id === 't1'));
    check('...even by a superuser', (await code(() => WorkspaceService.deleteTask('saniel', { taskId: 't1' }))) === 'LOCKED');
    await WorkspaceService.setLocked('a', { taskId: 't1', locked: false });
    check('unlocking switches the template off (nothing deleted)', tables.task_templates.length === 1 && tables.task_templates[0].is_active === false);
    await WorkspaceService.deleteTask('a', { taskId: 't1' });
    check('after unlocking, delete works', !tables.task_assignments.some(r => r.id === 't1'));

    console.log('\n3. Daily generation (Monday to Saturday)');
    tables.task_templates = [];
    tables.task_assignments = [task('t3', 'a')];
    await WorkspaceService.setLocked('a', { taskId: 't3', locked: true });
    const tplId = tables.task_templates[0].id;
    tables.task_assignments.find(r => r.id === 't3')!.status = 'completed';

    let r = await TaskDailyGeneratorService.generatePersonalFixedTasks({ date: '2026-10-06' }); // Tuesday
    check('the next working day: a fresh to-do for the owner only', r.tasksGenerated === 1 && tables.task_assignments.filter(x => x.assigned_date === '2026-10-06').length === 1
        && tables.task_assignments.find(x => x.assigned_date === '2026-10-06')?.employee_id === 'a' && tables.task_assignments.find(x => x.assigned_date === '2026-10-06')?.status === 'pending', r);
    r = await TaskDailyGeneratorService.generatePersonalFixedTasks({ date: '2026-10-06' });
    check('running it again creates nothing new', r.tasksGenerated === 0 && tables.task_assignments.filter(x => x.assigned_date === '2026-10-06').length === 1, r);
    r = await TaskDailyGeneratorService.generatePersonalFixedTasks({ date: '2026-10-10' }); // Saturday
    check('Saturday is a working day, but Tuesday\'s card is still open (carried forward), so no duplicate', r.tasksGenerated === 0 && r.templatesProcessed === 1, r);
    r = await TaskDailyGeneratorService.generatePersonalFixedTasks({ date: '2026-10-11' }); // Sunday
    check('Sunday: nothing', r.tasksGenerated === 0 && r.templatesProcessed === 0, r);

    tables.task_assignments.find(x => x.assigned_date === '2026-10-06')!.status = 'completed';
    r = await TaskDailyGeneratorService.generatePersonalFixedTasks({ date: '2026-10-07' });
    check('finished yesterday: a new one today', r.tasksGenerated === 1, r);
    r = await TaskDailyGeneratorService.generatePersonalFixedTasks({ date: '2026-10-08' });
    check('NOT finished yesterday: no duplicate card (the old one is carried forward)', r.tasksGenerated === 0 && !tables.task_assignments.some(x => x.assigned_date === '2026-10-08'), r);

    tables.task_templates.find(t => t.id === tplId)!.is_active = false;
    tables.task_assignments.forEach(x => (x.status = 'completed'));
    r = await TaskDailyGeneratorService.generatePersonalFixedTasks({ date: '2026-10-09' });
    check('after unlocking it does not come back', r.tasksGenerated === 0 && r.templatesProcessed === 0, r);

    console.log('\n4. "Send now"');
    let sends: any[] = [];
    (TaskNotificationService as any).sendMorningNotifications = async (o: any) => { sends.push(o); return { notificationsSent: 2, skippedNoTasks: 0, skippedLocked: 0, pretend: true }; };
    const base = { name: 'x', enabled: true, targetTimeIST: '09:00', daysOfWeek: [1], ruleType: 'morning_digest', taskFilters: {}, conditions: {}, recipients: { target: 'department' } };
    rules = [
        { ...base, id: 'dept1', departmentId: 'proc' },
        { ...base, id: 'me1', departmentId: null, ownerUserId: 'saniel', recipients: { target: 'specific_employees', employeeIds: ['saniel'] } },
    ];
    check('a team send needs a confirmation', (await code(() => DepartmentRulesService.sendNow('saniel', { ruleId: 'dept1' }, 'Procurement'))) === 'CONFIRM_REQUIRED' && sends.length === 0);
    const team = await DepartmentRulesService.sendNow('saniel', { ruleId: 'dept1', confirm: true }, 'Procurement');
    check('confirmed: it goes through the normal sender, for real (not a dry run)', sends.length === 1 && sends[0].dryRun === false && sends[0].departmentId === 'proc' && team.sent === 2 && team.pretend === true, sends);
    check('pressing it again straight away is held back (cooldown)', (await code(() => DepartmentRulesService.sendNow('saniel', { ruleId: 'dept1', confirm: true }, 'Procurement'))) === 'COOLDOWN' && sends.length === 1);
    check('it never stamps "ran today", so the scheduled send still happens', !rules.find(x => x.id === 'dept1').lastRunDate);
    check('another person\'s rule is not found', (await code(() => DepartmentRulesService.sendNow('saniel', { ruleId: 'me1', confirm: true }, 'Procurement'))) === 'NOT_FOUND');

    await PersonalRulesService.sendNow('saniel', 'me1');
    check('a personal send needs no confirmation and goes out under the personal rule', sends.length === 2 && sends[1].rule.id === 'me1', sends.length);
    check('...with its own cooldown', (await code(() => PersonalRulesService.sendNow('saniel', 'me1'))) === 'COOLDOWN');
    check('a non-superuser cannot use personal send', (await code(() => PersonalRulesService.sendNow('a', 'me1'))) === 'NOT_SUPERUSER');

    console.log('\n5. Telling the person who gave a superuser a task that it is done');
    const { TaskMessagingService } = await import('../TaskMessagingService');
    let notes: Array<{ phone: string; text: string; opts: any }> = [];
    (TaskMessagingService as any).sendMessage = async (phone: string, text: string, opts: any) => { notes.push({ phone, text, opts }); return true; };
    db.logAudit = async (e: any) => { (tables.task_audit_logs = tables.task_audit_logs || []).push({ event_type: e.eventType, task_id: e.taskId, created_at: new Date().toISOString() }); };
    db.updateAssignmentStatus = async (p: any) => { const t = tables.task_assignments.find(x => x.id === p.assignmentId)!; t.status = p.status; return t; };
    tables.task_assignments = [
        task('s1', 'saniel', { assigned_by: 'a', title: 'Carpet Installation PO' }),
        task('s2', 'saniel', { assigned_by: 'saniel' }),
        task('s3', 'b', { assigned_by: 'a' }),
    ];
    const settle = () => new Promise(r => setTimeout(r, 10));
    await WorkspaceService.setStatus('saniel', { taskId: 's1', status: 'completed' }); await settle();
    check('he finishes a task someone gave him: that person is told, by name, with the task', notes.length === 1 && /Saniel has finished/.test(notes[0].text) && /Carpet Installation PO/.test(notes[0].text) && notes[0].phone === people.a.phone_number, notes);
    check('...as plain text that only reaches people inside the 24-hour window', notes[0].opts.freeformOnly === true);
    await WorkspaceService.setStatus('saniel', { taskId: 's1', status: 'pending' });
    await WorkspaceService.setStatus('saniel', { taskId: 's1', status: 'completed' }); await settle();
    check('dragged out of Done and back within the hour: not told twice', notes.length === 1, notes.length);
    await WorkspaceService.setStatus('saniel', { taskId: 's2', status: 'completed' }); await settle();
    check('a task he gave himself: nobody is told', notes.length === 1);
    await WorkspaceService.setStatus('b', { taskId: 's3', status: 'completed' }); await settle();
    check('an ordinary employee finishing a task: nobody is told', notes.length === 1);

    console.log(failures ? `\n❌ ${failures} FAILED` : '\n🎉 FIXED TASKS AND SEND NOW TESTS PASSED');
    process.exit(failures ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
