/**
 * Step 1 — Pretend Mode & fail-closed WhatsApp gate (100% OFFLINE).
 *
 * SAFETY: this test never loads real credentials, never touches the real database and never reaches
 * AiSensy. It runs with fake env values and replaces every I/O function with a recorder. If a code path
 * ever tried to bypass the stubs it would fail to connect (127.0.0.1:1) instead of reaching a real service.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
process.env.AISENSY_PROJECT_ID = 'fake-project';
process.env.AISENSY_PROJECT_API_KEY = 'fake-password';
process.env.AISENSY_API_KEY = 'fake-campaign-key';
delete process.env.WHATSAPP_LLM_INTERPRETER_ENABLED;

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
    if (ok) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.error(`  ✗ ${name}`, extra ?? '');
    }
}

async function run() {
    // ── Recorders ────────────────────────────────────────────────────────────
    let networkCalls: string[] = [];
    (globalThis as any).fetch = async (url: any) => {
        networkCalls.push(`fetch:${String(url)}`);
        return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    };

    const { TaskMessagingService } = await import('../TaskMessagingService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const { AiSensyService } = await import('@/backend/services/AiSensyService');
    const { TaskAccessService } = await import('../TaskAccessService');

    const db: any = TaskDatabaseService;
    const sensy: any = AiSensyService;

    let auditLogs: any[] = [];
    // Step 3 lock check: treat department 'd1' as ON and employee 'e1' as onboarded (this test is about the send gate).
    (TaskAccessService as any).getSnapshot = async () => ({
        provisioned: true, readable: true,
        departmentEnabled: new Map([['d1', true]]),
        onboarded: new Map([['e1', { userId: 'e1', departmentId: 'd1', kickoffType: 'employee', source: 'manual', kickoffSentAt: '', recordedBy: null }]]),
    });
    db.logAudit = async (p: any) => { auditLogs.push(p); };
    sensy.sendTemplate = async (o: any) => { networkCalls.push(`template:${o.campaignName}`); return { success: true, messageIds: [] }; };

    const baseSwitches = () => db.getDefaultKillSwitches();
    const setControls = (over: { pretendMode?: boolean; halt?: boolean; deptHalt?: string; typeHalt?: string }) => {
        db.getSendControls = async () => {
            const ks = baseSwitches();
            if (over.halt) { ks.globalHalt = true; ks.haltReason = 'test halt'; }
            if (over.deptHalt) ks.departmentHalt = { [over.deptHalt]: true };
            if (over.typeHalt) ks.messageTypeHalt = { ...ks.messageTypeHalt, [over.typeHalt]: true };
            return { killSwitches: ks, pretendMode: over.pretendMode !== false };
        };
    };
    const reset = () => { networkCalls = []; auditLogs = []; };

    // ── 1. Pure decision rules ───────────────────────────────────────────────
    console.log('\n1. Decision rules (no I/O)');
    const ctl = (over: any = {}) => ({ killSwitches: { ...baseSwitches(), ...(over.ks || {}) }, pretendMode: over.pretendMode !== false });
    check('default → pretend', TaskMessagingService.decideSendMode(ctl()).mode === 'pretend');
    check('pretend OFF, no halts → send', TaskMessagingService.decideSendMode(ctl({ pretendMode: false })).mode === 'send');
    check('global halt wins over pretend → blocked', TaskMessagingService.decideSendMode(ctl({ ks: { globalHalt: true } })).mode === 'blocked');
    check('department halt → blocked', TaskMessagingService.decideSendMode(ctl({ pretendMode: false, ks: { departmentHalt: { d1: true } } }), { departmentId: 'd1' }).mode === 'blocked');
    check('other department not affected', TaskMessagingService.decideSendMode(ctl({ pretendMode: false, ks: { departmentHalt: { d1: true } } }), { departmentId: 'd2' }).mode === 'send');
    check('message-type halt → blocked', TaskMessagingService.decideSendMode(ctl({ pretendMode: false, ks: { messageTypeHalt: { morning_digest: true } } }), { ruleType: 'morning_digest' }).mode === 'blocked');
    check('bypassKillSwitch can NOT bypass pretend', TaskMessagingService.decideSendMode(ctl(), { bypassKillSwitch: true }).mode === 'pretend');
    check('bypassKillSwitch passes kill switch only when pretend is OFF', TaskMessagingService.decideSendMode(ctl({ pretendMode: false, ks: { globalHalt: true } }), { bypassKillSwitch: true }).mode === 'send');

    // ── 2. Pretend Mode: nothing leaves the system ───────────────────────────
    console.log('\n2. Pretend Mode ON: zero network calls');
    setControls({ pretendMode: true });
    reset();
    const r1 = await TaskMessagingService.sendMessage('9876543210', 'Hello tasks', {});
    check('sendMessage returns true (callers continue)', r1 === true);
    check('sendMessage made NO network call', networkCalls.length === 0, networkCalls);
    check('one history entry saved', auditLogs.length === 1 && auditLogs[0].eventType === 'whatsapp_sent' && auditLogs[0].details.pretend === true);
    check('history keeps the message text', auditLogs[0]?.details?.preview === 'Hello tasks');
    check('history masks the phone number', !String(auditLogs[0]?.details?.phone).includes('98765432') && String(auditLogs[0]?.details?.phone).endsWith('3210'));

    reset();
    await TaskMessagingService.sendFreeformReply('9876543210', 'x');
    await TaskMessagingService.sendFreeformMessage('9876543210', 'y');
    await TaskMessagingService.sendTemplateNotification({ phone: '9876543210', templateParams: ['a', 'b'] });
    check('sendFreeformReply / sendFreeformMessage / sendTemplateNotification: NO network call', networkCalls.length === 0, networkCalls);

    reset();
    const k = await TaskMessagingService.sendKickoffTemplate({ phone: '9876543210', campaignName: 'tm_manager_kickoff_v1', templateParams: ['A', 'B', 'C'], departmentId: 'd1', messageType: 'manager_kickoff' });
    check('kickoff in pretend returns pretend:true', k.success === true && k.pretend === true);
    check('kickoff in pretend made NO network call', networkCalls.length === 0, networkCalls);
    check('kickoff in pretend is NOT recorded as a *_kickoff_sent event', !auditLogs.some(l => String(l.eventType || l.event_type).endsWith('_kickoff_sent')));

    // ── 3. Kill switches block everything ────────────────────────────────────
    console.log('\n3. Kill switch ON: blocked, zero network calls');
    setControls({ pretendMode: false, halt: true });
    reset();
    const r2 = await TaskMessagingService.sendMessage('9876543210', 'blocked?', {});
    check('sendMessage returns false', r2 === false);
    check('no network call', networkCalls.length === 0, networkCalls);
    check('blocked event saved', auditLogs.some(l => l.event_type === 'whatsapp_blocked_by_kill_switch'));
    const k2 = await TaskMessagingService.sendKickoffTemplate({ phone: '9876543210', campaignName: 'c', templateParams: [], messageType: 'employee_kickoff' });
    check('kickoff returns blocked, no network call', k2.success === false && k2.blocked === true && networkCalls.length === 0, networkCalls);

    // ── 4. Fail-closed ───────────────────────────────────────────────────────
    console.log('\n4. Safety settings unreadable → fail closed');
    db.getSendControls = async () => { throw new Error('db down'); };
    reset();
    const r3 = await TaskMessagingService.sendMessage('9876543210', 'db down', {});
    check('sendMessage returns false', r3 === false);
    check('no network call', networkCalls.length === 0, networkCalls);
    const allowed = await TaskMessagingService.isMessagingAllowed({});
    check('isMessagingAllowed → not allowed', allowed.allowed === false);

    // ── 5. Pretend OFF + no halts: gate lets it through (proves the test is meaningful) ──
    console.log('\n5. Pretend OFF, no kill switch: message is handed to the (stubbed) provider');
    setControls({ pretendMode: false });
    reset();
    const r4 = await TaskMessagingService.sendMessage('9876543210', 'real path', {});
    check('sendMessage reaches the (stubbed) provider exactly once', r4 === true && networkCalls.length === 1 && networkCalls[0].startsWith('fetch:'), networkCalls);

    // ── 6. Notification service (cron path) ──────────────────────────────────
    console.log('\n6. Notification service / cron path');
    const emp = { id: 'e1', name: 'Test Person', phone_number: '9876543210', department_id: 'd1', active: true };
    db.getEmployeesByDepartment = async () => [emp];
    db.getAllEmployees = async () => [emp];
    db.getTestingConfig = async () => ({ enabled: false });
    db.getFilteredAssignments = async () => [{ id: 't1', title: 'Check servers', status: 'pending', assigned_date: '2026-10-06' }];
    db.getDailyAssignments = async () => [{ id: 't1', title: 'Check servers', status: 'pending', assigned_date: '2026-10-06' }];

    setControls({ pretendMode: true });
    reset();
    const n1 = await TaskNotificationService.sendMorningNotifications({ date: '2026-10-06', departmentId: 'd1', dryRun: false });
    check('pretend: result flagged pretend, 1 simulated', n1.pretend === true && n1.notificationsSent === 1 && !n1.blockedReason);
    check('pretend: NO network call', networkCalls.length === 0, networkCalls);
    check('pretend: history entry marked simulated + pretend', auditLogs.some(l => l.details?.pretend === true && l.details?.status === 'simulated'));

    setControls({ pretendMode: false, halt: true });
    reset();
    const n2 = await TaskNotificationService.sendMorningNotifications({ date: '2026-10-06', departmentId: 'd1', dryRun: false });
    check('kill switch: result has blockedReason and 0 sent', !!n2.blockedReason && n2.notificationsSent === 0);
    check('kill switch: NO network call', networkCalls.length === 0, networkCalls);

    db.getSendControls = async () => { throw new Error('db down'); };
    reset();
    const n3 = await TaskNotificationService.sendMorningNotifications({ date: '2026-10-06', departmentId: 'd1', dryRun: false });
    check('unreadable settings: blocked, NO network call', !!n3.blockedReason && networkCalls.length === 0, networkCalls);

    console.log(failures === 0
        ? '\n🎉 STEP 1 OFFLINE SAFETY TESTS PASSED (no real database or WhatsApp was contacted)\n'
        : `\n❌ ${failures} check(s) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => {
    console.error('❌ Test crashed:', err);
    process.exit(1);
});
