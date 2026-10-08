/**
 * Step 6 — team-managed notifications (OFFLINE: stubbed database, no network, no WhatsApp).
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
Object.assign(process.env, { NODE_ENV: 'development' }); // lets the cron route run without its secret in this offline test

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { evaluateRuleSchedule } = await import('../NotificationSchedule');
    const { validateRuleInput, DepartmentRulesService, RulesError } = await import('../DepartmentRulesService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { TaskMessagingService } = await import('../TaskMessagingService');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const { TaskDailyGeneratorService } = await import('../TaskDailyGeneratorService');

    const at = (hhmm: string, day = 2, last: string | null = null) => ({ now: { dayOfWeek: day, minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), todayIST: '2026-10-07' }, last });
    const status = (rule: any, hhmm: string, day = 2, force = false) => evaluateRuleSchedule({ lastRunDate: null, ...rule }, at(hhmm, day).now, force);

    console.log('\n1. When is a rule due (Tech behaviour unchanged)');
    check('before the time: waiting', status({ targetTimeIST: '09:00', daysOfWeek: [1, 2, 3, 4, 5, 6] }, '08:45') === 'waiting');
    check('at the time: due', status({ targetTimeIST: '09:00', daysOfWeek: [1, 2, 3, 4, 5, 6] }, '09:00') === 'due');
    check('09:00 rule at 21:00 is still skipped as too late (as before)', status({ targetTimeIST: '09:00', daysOfWeek: [2] }, '21:00') === 'outside_operational_window');
    check('18:30 rule at 20:15 still fires (as before)', status({ targetTimeIST: '18:30', daysOfWeek: [2] }, '20:15') === 'due');
    check('a day not selected: not scheduled', status({ targetTimeIST: '09:00', daysOfWeek: [1] }, '10:00', 2) === 'not_scheduled_today');
    check('already ran today: not again', status({ targetTimeIST: '09:00', daysOfWeek: [2], lastRunDate: '2026-10-07' }, '10:00') === 'already_executed_today');
    check('disabled: disabled', status({ targetTimeIST: '09:00', daysOfWeek: [2], enabled: false }, '10:00') === 'disabled');
    check('NO LIMIT: a 22:00 rule now fires at 22:10 (the old 20:30 cutoff would have killed it)', status({ targetTimeIST: '22:00', daysOfWeek: [2] }, '22:10') === 'due');
    check('...but a rule that is hours stale is still skipped (21:00 rule seen at 23:30)', status({ targetTimeIST: '21:00', daysOfWeek: [2] }, '23:30') === 'outside_operational_window');

    console.log('\n2. Wording and time checks (sanity only, no business limits)');
    const good = { ruleType: 'morning_digest', targetTimeIST: '07:15', daysOfWeek: [1, 2, 3], customTemplate: { headerGreeting: 'Hi {{firstName}}!' } };
    check('a valid rule passes', validateRuleInput(good).ok === true);
    check('any hour is allowed (even 03:00)', validateRuleInput({ ...good, targetTimeIST: '03:00' }).ok === true);
    check('a bad time is refused', validateRuleInput({ ...good, targetTimeIST: '25:99' }).ok === false);
    check('no days is refused', validateRuleInput({ ...good, daysOfWeek: [] }).ok === false);
    check('an unknown placeholder is refused', validateRuleInput({ ...good, customTemplate: { customMessage: 'Hello {{secretData}}' } }).ok === false);
    check('overdue alerts are not on offer', validateRuleInput({ ...good, ruleType: 'overdue_alert' }).ok === false);
    check('empty wording means the standard message (no custom template)', (validateRuleInput({ ...good, customTemplate: { headerGreeting: '', customMessage: '' } }) as any).value.customTemplate === undefined);

    // ── stubbed world ────────────────────────────────────────────────────────
    const db: any = TaskDatabaseService;
    const access: any = TaskAccessService;
    const PROC = 'proc-dept', OPS = 'ops-dept';
    const people: Record<string, any> = {
        a: { id: 'a', name: 'Asha Rao', phone_number: '9876543210', department_id: PROC, department_name: 'Procurement', role: 'employee', active: true },
        b: { id: 'b', name: 'Dev Menon', phone_number: '9876543211', department_id: PROC, department_name: 'Procurement', role: 'employee', active: true },
        o: { id: 'o', name: 'Ops Person', phone_number: '9876543212', department_id: OPS, department_name: 'Operations', role: 'employee', active: true },
        s: { id: 's', name: 'Founder', phone_number: '9876543213', department_id: 'mgmt', department_name: 'Management', role: 'superuser', active: true },
    };
    let rules: any[] = [
        { id: 'rule_morning_digest', name: 'Tech morning', enabled: true, targetTimeIST: '09:00', daysOfWeek: [1, 2, 3, 4, 5, 6], ruleType: 'morning_digest', taskFilters: {}, conditions: {}, recipients: { target: 'tech_all' } },
        { id: 'rule_ops_1', name: 'Ops reminder', enabled: true, targetTimeIST: '14:00', daysOfWeek: [1], ruleType: 'pending_reminder', departmentId: OPS, taskFilters: {}, conditions: {}, recipients: { target: 'department' } },
    ];
    let delegated = false;
    let locked = new Set<string>();
    let audits: any[] = [];
    let sent: string[] = [];

    db.getEmployeeById = async (id: string) => people[id] || null;
    db.getDepartmentByName = async (n: string) => ({ id: n === 'Procurement' ? PROC : 'x', name: n });
    db.getTestingConfig = async () => ({ enabled: false, cronEnabled: true, whatsappPretendMode: true, rules });
    db.updateNotificationRule = async (id: string, up: any) => { const i = rules.findIndex(r => r.id === id); if (i >= 0) rules[i] = { ...rules[i], ...up }; else rules.push(up); };
    db.deleteNotificationRule = async (id: string) => { rules = rules.filter(r => r.id !== id); };
    db.saveTestingConfig = async () => ({});
    db.logAudit = async (p: any) => { audits.push(p); };
    db.getEmployeesByDepartment = async (d: string) => Object.values(people).filter((p: any) => p.department_id === d);
    db.getFilteredAssignments = async () => [{ id: 't', title: 'Call vendor', status: 'pending', assigned_date: '2026-10-07' }];
    db.getDailyAssignments = db.getFilteredAssignments;
    db.getSendControls = async () => ({ killSwitches: db.getDefaultKillSwitches(), pretendMode: true });
    access.isNotificationsDelegated = async () => delegated;
    access.getSnapshot = async () => ({
        provisioned: true, readable: true,
        departmentEnabled: new Map([[PROC, true], [OPS, true], ['mgmt', true]]),
        onboarded: new Map(['a', 'b', 'o', 's'].filter(i => !locked.has(i)).map(i => [i, { userId: i }])),
    });
    access.check = async (p: any) => TaskAccessService.decide(await access.getSnapshot(), p);
    (TaskMessagingService as any).sendMessage = async (_p: string, t: string) => { sent.push(t); return true; };
    const reset = () => { audits = []; sent = []; };
    const denied = async (fn: () => Promise<unknown>, code: string) => { try { await fn(); return false; } catch (e: any) { return e instanceof RulesError && e.code === code; } };

    console.log('\n3. Team management and who may do what');
    delegated = false;
    let l: any = await DepartmentRulesService.list('a');
    check('not delegated: the team sees only its own rules, read-only', l.canEdit === false && l.rules.length === 0);
    check('not delegated: saving is refused', await denied(() => DepartmentRulesService.save('a', good), 'NOT_DELEGATED'));

    delegated = true;
    const created: any = await DepartmentRulesService.save('a', { ...good, name: 'Morning list' });
    check('delegated: a member creates a rule for THEIR department', created.departmentId === PROC && created.recipients.target === 'department');
    check('the save is recorded in the history', audits.some(a => a.eventType === 'notification_rule_saved' && a.actorId === 'a'));
    for (let i = 0; i < 5; i++) await DepartmentRulesService.save('b', { ...good, targetTimeIST: `0${i + 1}:00` });
    l = await DepartmentRulesService.list('b');
    check('NO LIMIT: six rules exist and any teammate sees them all', l.rules.length === 6, l.rules.length);

    const edited: any = await DepartmentRulesService.save('b', { id: created.id, ...good, targetTimeIST: '10:30' });
    check('any teammate can edit a teammate\'s rule', edited.targetTimeIST === '10:30' && edited.id === created.id);

    check('cannot touch another department\'s rule (not found)', await denied(() => DepartmentRulesService.save('a', { id: 'rule_ops_1', ...good }), 'NOT_FOUND'));
    check('cannot touch the original Tech rules (not found)', await denied(() => DepartmentRulesService.save('a', { id: 'rule_morning_digest', ...good }), 'NOT_FOUND'));
    check('cannot delete another department\'s rule', await denied(() => DepartmentRulesService.remove('a', 'rule_ops_1'), 'NOT_FOUND'));
    check('other departments\' rules are never listed', !(await DepartmentRulesService.list('a') as any).rules.some((r: any) => r.departmentId === OPS));

    reset();
    await DepartmentRulesService.remove('a', created.id);
    check('delete works for their own rule and is recorded', !rules.some(r => r.id === created.id) && audits.some(a => a.eventType === 'notification_rule_deleted'));

    locked = new Set(['a']);
    check('a person who is not unlocked cannot use any of it', await denied(() => DepartmentRulesService.list('a'), 'LOCKED'));
    locked = new Set();

    delegated = false;
    check('the founder can edit even when the team is not delegated', (await DepartmentRulesService.save('s', good, 'Procurement') as any).departmentId === PROC);

    console.log('\n4. Preview sends nothing and writes nothing');
    delegated = true; reset();
    const p: any = await DepartmentRulesService.preview('a', good);
    check('preview returns an example message and the audience', /Asha|Hi|tasks/i.test(p.sample) && p.audience.length === 2, p);
    check('...nothing was sent', sent.length === 0);
    check('...nothing was written to the history', audits.length === 0, audits);
    check('...it reports that messages are simulated (Pretend Mode)', p.pretendMode === true);

    console.log('\n5. The cron runs each rule for ITS OWN department');
    const calls: Array<{ dept?: string; rule?: string }> = [];
    (TaskDailyGeneratorService as any).generateDailyFixedTasks = async () => ({ success: true, date: 'x', templatesProcessed: 0, employeesTargeted: 0, tasksGenerated: 0, tasksAlreadyExisting: 0, assignments: [] });
    (TaskNotificationService as any).sendMorningNotifications = async (o: any) => { calls.push({ dept: o.departmentId, rule: o.rule?.id }); return { success: true, date: 'x', totalEmployeesChecked: 0, notificationsSent: 0, skippedNoTasks: 0, skippedNoPhone: 0, failed: 0, pretend: true, details: [] }; };
    (TaskMessagingService as any).resolveSendMode = async () => ({ mode: 'pretend' });
    rules = [
        { id: 'rule_morning_digest', name: 'Tech morning', enabled: true, targetTimeIST: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], ruleType: 'morning_digest', taskFilters: {}, conditions: {}, recipients: {} },
        { id: 'rule_proc_x', name: 'Proc morning', enabled: true, targetTimeIST: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], ruleType: 'morning_digest', departmentId: PROC, taskFilters: {}, conditions: {}, recipients: {} },
    ];
    const { GET } = await import('../../app/api/cron/task-manager/route');
    const { NextRequest } = await import('next/server');
    await GET(new NextRequest('http://localhost/api/cron/task-manager?action=auto&force=true'));
    check('the original Tech rule still runs for the default (Tech) department', calls.some(c => c.rule === 'rule_morning_digest' && c.dept === '94a74961-2dd8-453d-9728-f6f2b9ade99b'), calls);
    check('the Procurement rule runs for Procurement', calls.some(c => c.rule === 'rule_proc_x' && c.dept === PROC), calls);
    check('nothing was sent during the run', sent.length === 0);

    console.log(failures === 0 ? '\n🎉 STEP 6 TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
