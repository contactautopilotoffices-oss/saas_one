/**
 * Step 3 — Task Manager access control (100% OFFLINE).
 *
 * SAFETY: fake credentials, every database/network function replaced by a recorder. Nothing real is read,
 * written or sent. A stray real call would fail to connect to 127.0.0.1:1.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
process.env.AISENSY_PROJECT_ID = 'fake-project';
process.env.AISENSY_PROJECT_API_KEY = 'fake-password';
process.env.AISENSY_API_KEY = 'fake-campaign-key';
delete process.env.WHATSAPP_LLM_INTERPRETER_ENABLED;

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
    if (ok) console.log(`  ✓ ${name}`);
    else { failures++; console.error(`  ✗ ${name}`, extra ?? ''); }
}

async function run() {
    let networkCalls: string[] = [];
    (globalThis as any).fetch = async (url: any) => { networkCalls.push(`fetch:${String(url)}`); return { ok: true, status: 200, text: async () => '', json: async () => ({}) }; };

    const { TaskAccessService, TECH_DEPARTMENT_ID } = await import('../TaskAccessService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskMessagingService } = await import('../TaskMessagingService');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const { TaskCommandHandler } = await import('../TaskCommandHandler');
    const { TaskMessageRouter } = await import('../TaskMessageRouter');
    const { AiSensyService } = await import('@/backend/services/AiSensyService');
    const { HierarchyService } = await import('../HierarchyService');
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');

    const db: any = TaskDatabaseService;
    const msg: any = TaskMessagingService;
    const access: any = TaskAccessService;
    (AiSensyService as any).sendTemplate = async () => { networkCalls.push('template'); return { success: true }; };

    (HierarchyService as any).load = async () => ({ hierarchy: { allReports: () => [{ userId: 'u2' }] } }); // u1 manages u2
    let audits: any[] = [];
    let replies: string[] = [];
    let contextsSet = 0;
    db.logAudit = async (p: any) => { audits.push(p); };
    db.setConversationContext = async () => { contextsSet++; return {}; };
    db.getConversationContext = async () => null;
    msg.sendMessage = async (_phone: string, text: string) => { replies.push(text); return true; };
    const reset = () => { networkCalls = []; audits = []; replies = []; contextsSet = 0; };

    const onboardedRec = (userId: string, departmentId: string) => ({ userId, departmentId, kickoffType: 'employee', source: 'manual', kickoffSentAt: '2026-10-07T00:00:00Z', recordedBy: 'test' });
    const snap = (over: any = {}) => ({
        provisioned: true,
        readable: true,
        departmentEnabled: new Map<string, boolean>([['dA', true], ['dB', false]]),
        onboarded: new Map<string, any>([['u1', onboardedRec('u1', 'dA')], ['u3', onboardedRec('u3', 'dB')]]),
        ...over,
    });

    // ── 1. Pure rules ────────────────────────────────────────────────────────
    console.log('\n1. Access rules (no I/O)');
    check('department ON + kickoff sent → allowed', TaskAccessService.decide(snap(), { userId: 'u1', departmentId: 'dA' }).allowed === true);
    check('department ON + NO kickoff → locked (not_onboarded)', TaskAccessService.decide(snap(), { userId: 'u2', departmentId: 'dA' }).reason === 'not_onboarded');
    check('department OFF even with kickoff → locked (department_off)', TaskAccessService.decide(snap(), { userId: 'u3', departmentId: 'dB' }).reason === 'department_off');
    check('department with no setting row → OFF', TaskAccessService.decide(snap(), { userId: 'u1', departmentId: 'dZ' }).reason === 'department_off');
    check('no department → locked', TaskAccessService.decide(snap(), { userId: 'u1', departmentId: null }).reason === 'no_department');
    check('unreadable settings → locked (fail closed)', TaskAccessService.decide(snap({ readable: false }), { userId: 'u1', departmentId: 'dA' }).reason === 'settings_unreadable');
    const notProv = snap({ provisioned: false, departmentEnabled: new Map(), onboarded: new Map() });
    check('not provisioned: Tech allowed', TaskAccessService.decide(notProv, { userId: 'x', departmentId: TECH_DEPARTMENT_ID }).allowed === true);
    check('not provisioned: Procurement-style department locked', TaskAccessService.decide(notProv, { userId: 'x', departmentId: 'dA' }).allowed === false);

    // ── 2. Reading the tables (stubbed client) ───────────────────────────────
    console.log('\n2. Reading the two tables');
    const realFrom = (supabaseAdmin as any).from;
    const fakeFrom = (tables: Record<string, { data?: any; error?: any }>) => (t: string) => ({ select: async () => tables[t] || { data: [], error: null } });

    (supabaseAdmin as any).from = fakeFrom({
        task_manager_department_settings: { data: [{ department_id: 'dA', enabled: true }], error: null },
        task_manager_onboarding: { data: [{ user_id: 'u1', department_id: 'dA', kickoff_type: 'employee', source: 'manual', kickoff_sent_at: 'x', recorded_by: 'me' }], error: null },
    });
    const s1 = await TaskAccessService.getSnapshot();
    check('tables present → provisioned + readable, rows mapped', s1.provisioned && s1.readable && s1.departmentEnabled.get('dA') === true && s1.onboarded.has('u1'));

    (supabaseAdmin as any).from = fakeFrom({
        task_manager_department_settings: { data: null, error: { code: '42P01', message: 'relation does not exist' } },
        task_manager_onboarding: { data: null, error: { code: '42P01', message: 'relation does not exist' } },
    });
    const s2 = await TaskAccessService.getSnapshot();
    check('tables missing (SQL not run yet) → not provisioned, still readable', !s2.provisioned && s2.readable);

    (supabaseAdmin as any).from = fakeFrom({
        task_manager_department_settings: { data: null, error: { code: '57014', message: 'timeout' } },
        task_manager_onboarding: { data: [], error: null },
    });
    const s3 = await TaskAccessService.getSnapshot();
    check('genuine read error → provisioned but UNREADABLE (fail closed)', s3.provisioned && !s3.readable);
    (supabaseAdmin as any).from = realFrom;

    // ── 3. Digest recipients ─────────────────────────────────────────────────
    console.log('\n3. Cron digest only reaches unlocked people');
    const mk = (id: string, dept: string) => ({ id, name: `Person ${id}`, phone_number: '9876543210', department_id: dept, active: true });
    const emps = [mk('u1', 'dA'), mk('u2', 'dA'), mk('u3', 'dB')];
    db.getEmployeesByDepartment = async () => emps;
    db.getAllEmployees = async () => emps;
    db.getTestingConfig = async () => ({ enabled: false });
    db.getSendControls = async () => ({ killSwitches: db.getDefaultKillSwitches(), pretendMode: true });
    db.getDailyAssignments = async () => [{ id: 't', title: 'Task', status: 'pending', assigned_date: '2026-10-07' }];
    db.getFilteredAssignments = db.getDailyAssignments;
    access.getSnapshot = async () => snap();
    access.isPeerAssignEnabled = async () => false; // Step 5 team sharing is not what this test is about

    reset();
    const n = await TaskNotificationService.sendMorningNotifications({ date: '2026-10-07', departmentId: 'dA', dryRun: false });
    check('only u1 (unlocked) is notified', n.notificationsSent === 1 && n.details.filter(d => d.status === 'sent').map(d => d.employeeId).join() === 'u1', n.details);
    check('u2 (no kickoff) and u3 (dept OFF) are skipped_locked', n.skippedLocked === 2 && n.details.filter(d => d.status === 'skipped_locked').length === 2);
    check('no network call at all', networkCalls.length === 0, networkCalls);

    reset();
    const nd = await TaskNotificationService.sendMorningNotifications({ date: '2026-10-07', departmentId: 'dA', dryRun: true });
    check('dry-run also shows only the unlocked audience', nd.notificationsSent === 1 && nd.skippedLocked === 2);

    access.getSnapshot = async () => snap({ readable: false });
    const nf = await TaskNotificationService.sendMorningNotifications({ date: '2026-10-07', departmentId: 'dA', dryRun: false });
    check('unreadable settings → nobody notified', nf.notificationsSent === 0 && nf.skippedLocked === 3);
    access.getSnapshot = async () => snap();

    // ── 4. WhatsApp commands ─────────────────────────────────────────────────
    console.log('\n4. WhatsApp commands');
    const FIRST: Record<string, string> = { u1: 'Alice', u2: 'Bob', u3: 'Carol' };
    const person = (id: string, dept: string, role = 'employee') => ({ id, name: `${FIRST[id] || 'Dave'} Test`, phone_number: '9876543210', department_id: dept, department_name: dept, role, active: true });
    db.getEmployeeByPhone = async () => person('u2', 'dA'); // department ON but kickoff NOT recorded
    reset();
    const c1 = await TaskCommandHandler.handleCommand({ phone: '9876543210', text: 'tasks', date: '2026-10-07' });
    check('locked person typing "tasks" gets the locked reply', c1.command === 'locked' && c1.success === false && replies[0]?.includes('🔒'), c1);
    check('locked person gets NO Task Manager session', contextsSet === 0);
    check('the blocked attempt is audited', audits.some(a => a.eventType === 'task_access_blocked'));

    db.getEmployeeByPhone = async () => person('u1', 'dA'); // unlocked
    reset();
    const c2 = await TaskCommandHandler.handleCommand({ phone: '9876543210', text: 'tasks', date: '2026-10-07' });
    check('unlocked person typing "tasks" works as before', c2.command === 'tasks' && c2.success === true, c2);

    // manager assigning to a locked colleague
    db.getEmployeeByPhone = async () => person('u1', 'dA', 'reporting_manager');
    db.getEmployeesByDepartment = async () => [person('u1', 'dA', 'reporting_manager'), person('u2', 'dA')];
    db.getAllEmployees = async () => [person('u1', 'dA', 'reporting_manager'), person('u2', 'dA')];
    let created = 0;
    db.createTaskAssignment = async () => { created++; return { id: 'new' }; };
    reset();
    const c3 = await TaskCommandHandler.handleCommand({ phone: '9876543210', text: 'assign Bob Check servers', date: '2026-10-07' });
    check('assigning to a locked person is refused', c3.command === 'assign_task' && c3.success === false && /Cannot assign/.test(c3.replyText), c3);
    check('no task was created for the locked person', created === 0);

    // ── 5. Greeting menu ─────────────────────────────────────────────────────
    console.log('\n5. "hi" menu');
    db.getEmployeeByPhone = async () => person('u2', 'dA'); // locked
    const r1 = await TaskMessageRouter.classifyMessage('9876543210', 'hi');
    check('locked person is NOT offered the Task Manager option (goes to Facility)', r1.system === 'FACILITY', r1);
    db.getEmployeeByPhone = async () => person('u1', 'dA'); // unlocked
    const r2 = await TaskMessageRouter.classifyMessage('9876543210', 'hi');
    check('unlocked person still gets the 1/2 menu', r2.system === 'AMBIGUOUS', r2);

    check('whole test made zero real network calls', networkCalls.length === 0, networkCalls);

    console.log(failures === 0
        ? '\n🎉 STEP 3 OFFLINE ACCESS TESTS PASSED (no real database or WhatsApp was contacted)\n'
        : `\n❌ ${failures} check(s) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => { console.error('❌ Test crashed:', err); process.exit(1); });
