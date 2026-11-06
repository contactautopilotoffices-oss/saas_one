/**
 * A superuser's own notifications (OFFLINE: stubbed database, no network, no WhatsApp).
 * Covers: who may manage them, that department screens never see them, and that a personal rule can only reach its owner.
 * Run: npx tsx task-manager/tests/test_personal_notifications.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { PersonalRulesService } = await import('../PersonalRulesService');
    const { DepartmentRulesService, RulesError } = await import('../DepartmentRulesService');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskAccessService } = await import('../TaskAccessService');

    const db: any = TaskDatabaseService;
    const access: any = TaskAccessService;

    const emp = (id: string, name: string, role: string, dept: string) => ({ id, name, phone_number: '9876543210', department_id: dept, department_name: dept, role, active: true });
    const people: Record<string, any> = {
        saniel: emp('saniel', 'Saniel Golechha', 'superuser', 'mgmt'),
        boss2: emp('boss2', 'Other Superuser', 'superuser', 'mgmt'),
        a: emp('a', 'Vidya Pawar', 'employee', 'proc'),
        b: emp('b', 'Satej Sadhye', 'employee', 'proc'),
    };

    let rules: any[] = [
        { id: 'dept1', name: 'Team morning', enabled: true, targetTimeIST: '09:00', daysOfWeek: [1], ruleType: 'morning_digest', departmentId: 'proc', taskFilters: {}, conditions: {}, recipients: { target: 'department' } },
    ];
    let audits: any[] = [];
    db.getEmployeeById = async (id: string) => people[id] || null;
    db.getAllEmployees = async () => Object.values(people);
    db.getEmployeesByDepartment = async (d: string) => Object.values(people).filter((p: any) => p.department_id === d);
    db.getDepartmentByName = async () => ({ id: 'proc', name: 'Procurement' });
    db.getTestingConfig = async () => ({ enabled: false, whatsappPretendMode: true, rules });
    db.updateNotificationRule = async (id: string, u: any) => { rules = rules.some(r => r.id === id) ? rules.map(r => (r.id === id ? { ...r, ...u } : r)) : [...rules, u]; };
    db.deleteNotificationRule = async (id: string) => { rules = rules.filter(r => r.id !== id); };
    db.logAudit = async (e: any) => { audits.push(e); };
    db.getFilteredAssignments = async () => [{ id: 't', title: 'A task', status: 'pending', assigned_date: '', isCarriedForward: false }];
    access.partition = async (list: any[]) => ({ allowed: list, locked: [] });
    access.check = async () => ({ allowed: true });
    access.isNotificationsDelegated = async () => false;

    const input = { name: 'My morning list', ruleType: 'morning_digest', targetTimeIST: '08:30', daysOfWeek: [1, 2, 3, 4, 5] };

    console.log('\n1. Who may manage them');
    let code = '';
    try { await PersonalRulesService.save('a', input); } catch (e: any) { code = e instanceof RulesError ? e.code || '' : 'other'; }
    check('a non-superuser is refused', code === 'NOT_SUPERUSER', code);

    const saved = await PersonalRulesService.save('saniel', { ...input, departmentId: 'proc', ownerUserId: 'a' } as any);
    check('a superuser can create one; it is always theirs and never a department rule', saved.ownerUserId === 'saniel' && saved.departmentId === null && saved.recipients.employeeIds?.join() === 'saniel', saved);
    check('creating it is audited', audits.some(a => a.eventType === 'notification_rule_saved' && a.details.personal === true));

    let list = await PersonalRulesService.list('saniel');
    check('they see their own rule', list.rules.length === 1 && list.rules[0].id === saved.id, list.rules);
    list = await PersonalRulesService.list('boss2');
    check('another superuser does not see it', list.rules.length === 0);

    code = '';
    try { await PersonalRulesService.save('boss2', { ...input, id: saved.id }); } catch (e: any) { code = e instanceof RulesError ? e.code || '' : 'other'; }
    check('another superuser cannot change it', code === 'NOT_FOUND', code);
    code = '';
    try { await PersonalRulesService.remove('boss2', saved.id); } catch (e: any) { code = e instanceof RulesError ? e.code || '' : 'other'; }
    check('...or delete it', code === 'NOT_FOUND' && rules.some(r => r.id === saved.id), code);
    code = '';
    try { await PersonalRulesService.save('saniel', { ...input, id: 'dept1' }); } catch (e: any) { code = e instanceof RulesError ? e.code || '' : 'other'; }
    check('a department rule can not be edited through the personal screen', code === 'NOT_FOUND', code);

    console.log('\n2. Department screens never see it');
    const dept = await DepartmentRulesService.list('saniel', 'Procurement');
    check('the department list holds only the department rule', dept.rules.map((r: any) => r.id).join() === 'dept1', dept.rules);
    code = '';
    try { await DepartmentRulesService.remove('saniel', saved.id, 'Procurement'); } catch (e: any) { code = e instanceof RulesError ? e.code || '' : 'other'; }
    check('the department screen can not delete it', code === 'NOT_FOUND' && rules.some(r => r.id === saved.id), code);

    console.log('\n3. It can only ever reach its owner');
    const run1 = await TaskNotificationService.sendMorningNotifications({ departmentId: 'proc', dryRun: true, skipAudit: true, rule: saved });
    check('even when a whole department is named, only the owner is in the audience', run1.details.length === 1 && run1.details[0].employeeId === 'saniel', run1.details.map((d: any) => d.employeeId));
    const run2 = await TaskNotificationService.sendMorningNotifications({ dryRun: true, skipAudit: true, rule: saved });
    check('and with no department at all', run2.details.length === 1 && run2.details[0].employeeId === 'saniel', run2.details.map((d: any) => d.employeeId));
    const run3 = await TaskNotificationService.sendMorningNotifications({ departmentId: 'proc', dryRun: true, skipAudit: true, rule: rules[0] });
    check('a normal department rule still reaches the department', run3.details.map((d: any) => d.employeeId).sort().join() === 'a,b', run3.details.map((d: any) => d.employeeId));

    const pv = await PersonalRulesService.preview('saniel', input);
    check('preview shows only them and writes nothing', pv.audience.length === 1 && pv.audience[0].name === 'Saniel Golechha' && pv.pretendMode === true, pv);

    console.log('\n4. Removing');
    await PersonalRulesService.remove('saniel', saved.id);
    check('they can delete their own rule', !rules.some(r => r.id === saved.id) && rules.length === 1);

    console.log(failures ? `\n❌ ${failures} FAILED` : '\n🎉 PERSONAL NOTIFICATION TESTS PASSED');
    process.exit(failures ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
