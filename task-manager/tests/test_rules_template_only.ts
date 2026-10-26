/**
 * Scheduled rules → approved template only (OFFLINE: fake database URL, stubbed gate and senders, no network, no WhatsApp).
 * Run: npx tsx task-manager/tests/test_rules_template_only.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- stubs replace services and DTOs on purpose */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const { TaskMessagingService: M } = await import('../TaskMessagingService');
    // The send gate is stubbed below, so fill the bot-switch cache the way the real gate does (both OFF here).
    (await import('../BotSwitches')).primeBotSwitches(null);
    const { TaskNotificationService: N } = await import('../TaskNotificationService');
    const ping = await import('../pingMessage');
    const fs = await import('node:fs');
    const path = await import('node:path');

    // ── sending ──
    const calls: string[] = [];
    const m = M as any;
    m.resolveSendMode = async () => ({ mode: 'send' });
    m.postFreeform = async () => { calls.push('freeform'); return true; };
    m.postTemplate = async (p: any) => { calls.push(`template:${p.campaignName}:${p.templateParams.length}`); return true; };

    await M.sendMessage('+919000000000', 'digest', { ruleType: 'pending_reminder', templateParams: ['x'], templateOnly: true });
    check('templateOnly → no free-text attempt, straight to the midday template', calls.join() === 'template:task_midday_reminder_v1:1', calls);

    calls.length = 0;
    await M.sendMessage('+919000000000', 'digest', { ruleType: 'morning_digest', templateParams: ['x'] });
    check('without templateOnly → unchanged: free text first', calls.join() === 'freeform', calls);

    calls.length = 0;
    m.resolveSendMode = async () => ({ mode: 'blocked', reason: 'kill' });
    m.logBlocked = async () => {};
    const blocked = await M.sendMessage('+919000000000', 'digest', { ruleType: 'eod_summary', templateParams: ['x'], templateOnly: true });
    check('kill switch still blocks a template-only send', blocked === false && calls.length === 0, calls);

    check('each rule type maps to its approved template',
        M.getCampaignForRuleType('morning_digest') === 'task_morning_kickoff_v2'
        && M.getCampaignForRuleType('pending_reminder') === 'task_midday_reminder_v1'
        && M.getCampaignForRuleType('eod_summary') === 'task_eod_summary_v1');

    // ── the {{1}} task list ──
    const t = (title: string, status = 'pending', carried = false) => ({ id: title, title, status, isCarriedForward: carried }) as any;
    const tasks = [t('submit daily report', 'pending', true), t('submit\neod   report'), t('lift AMC', 'completed')];

    const morning = N.buildTemplateTaskParam('morning_digest', tasks);
    const midday = N.buildTemplateTaskParam('pending_reminder', tasks);
    const eod = N.buildTemplateTaskParam('eod_summary', tasks);
    const bad = (s: string) => /[\n\r\t]| {5,}/.test(s);
    check('morning: one line, no tabs, no long space runs', !bad(morning), morning);
    // Owner 2026-10-16: the midday line shows three groups (carry forward → pending today → completed), still on one line.
    check('midday: one line, carry forward / pending today / completed', !bad(midday) && midday === 'Carry forward: 1. submit daily report ⏳ — Pending today: 2. submit eod report ⏳ — Completed: 3. lift AMC ✅', midday);
    check('eod: one line with the completed count', !bad(eod) && eod.startsWith('Completed 1/3 — '), eod);
    check('carried-forward tasks are labelled apart from today\'s', morning === 'Carry forward: 1. submit daily report ⏳ — Today: 2. submit eod report ⏳ | 3. lift AMC ✅', morning);
    check('without carried tasks: no labels, items separated by " | "', N.buildTemplateTaskParam('morning_digest', tasks.slice(1)) === '1. submit eod report ⏳ | 2. lift AMC ✅', N.buildTemplateTaskParam('morning_digest', tasks.slice(1)));

    const many = Array.from({ length: 60 }, (_, i) => t(`task number ${i + 1} with a fairly long title for testing`));
    const long = N.buildTemplateTaskParam('morning_digest', many);
    check('a long list is cut with "…and N more" and stays short', long.length <= 760 && /…and \d+ more$/.test(long), long.length);
    check('no tasks → plain sentence', N.buildTemplateTaskParam('morning_digest', []) === 'No tasks assigned for today.');

    // ── superuser reminder → task_user_mentioned_v1 ──
    const src = fs.readFileSync(path.resolve(__dirname, '../SuperuserPingService.ts'), 'utf8');
    check('superuser reminder uses task_user_mentioned_v1', /'task_user_mentioned_v1'/.test(src) && !/'task_pending_for_you_v1'/.test(src));
    const p = ping.buildPingTemplateParams({ fromLabel: 'Sahil', department: 'Procurement', tasks: ['submit\nreport', 'call vendor'] }, 'Saniel Kumar');
    check('ping blanks: {{1}} first name, {{2}} "Sahil (Procurement)", {{3}} tasks on one line',
        p.length === 3 && p[0] === 'Saniel' && p[1] === 'Sahil (Procurement)' && p[2] === '1. submit report | 2. call vendor', p);

    const pv = ping.buildPingTemplatePreview({ fromLabel: 'Sahil', department: 'Procurement', tasks: ['call vendor'], note: 'SECRET NOTE' }, 'Saniel Kumar');
    check('preview = the approved template filled in, and the note is not in it',
        pv === 'Hi Saniel,\n\nSahil (Procurement) tagged you regarding the following pending task in Autopilot Task Manager:\n\n1. call vendor\n\nReply to update the task status.', pv);

    // ── event alerts: task_assigned_v1 / task_update_v2 ──
    const A = await import('../taskAlerts');
    check('date shown as "11 Oct 2026"', A.formatDate('2026-10-11') === '11 Oct 2026', A.formatDate('2026-10-11'));
    check('one task → just its title', A.taskList(['Carpet Installation PO']) === 'Carpet Installation PO');
    check('several tasks → "1. A | 2. B", one line', A.taskList(['check\nAC', 'call vendor']) === '1. check AC | 2. call vendor', A.taskList(['check\nAC', 'call vendor']));
    const ap = A.assignedParams(['Carpet Installation PO'], A.personLabel('Priyanka', 'Procurement'), '2026-10-11');
    check('task_assigned_v1 blanks: task, "Priyanka (Procurement)", date', JSON.stringify(ap) === JSON.stringify(['Carpet Installation PO', 'Priyanka (Procurement)', '11 Oct 2026']), ap);
    const up = A.updateParams(['submit report'], 'Saniel (Management)', 'Working on it\n— vendor late');
    check('task_update_v2 blanks: task, assignee, update — all one line', up[1] === 'Saniel (Management)' && up[2] === 'Working on it — vendor late' && !up.some(x => /\n/.test(x)), up);

    calls.length = 0;
    const sentOpts: any[] = [];
    m.resolveSendMode = async () => ({ mode: 'send' });
    m.postTemplate = async (p: any) => { sentOpts.push(p); calls.push('template'); return true; };
    await A.sendTaskAssigned('+919000000000', { titles: ['Carpet Installation PO'], fromLabel: 'Priyanka (Procurement)', date: '2026-10-11' });
    await A.sendTaskUpdate('+919000000000', { titles: ['submit report'], assigneeLabel: 'Saniel (Management)', update: 'Finished ✅' });
    check('both alerts go ONLY as their approved templates (no free text)', calls.join() === 'template,template' && sentOpts[0].campaignName === 'task_assigned_v1' && sentOpts[1].campaignName === 'task_update_v2', sentOpts);
    check('no phone → nothing sent, no error', (await A.sendTaskAssigned('', { titles: ['x'], fromLabel: 'y', date: '2026-10-11' })) === false);

    // ── several tasks for one person → ONE alert ──
    const X = await import('../brain/execute');
    const made: any[] = []; const alerts: any[] = [];
    const xio: any = {
        setStatus: async () => {}, handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '',
        assign: async (_a: string, i: any) => { if (i.title === 'broken') throw new Error('no'); made.push(i); },
        alertAssigned: async (_a: string, to: string, titles: string[], date: string) => { alerts.push({ to, titles, date }); },
    };
    const ctx: any = { sender: { id: 'me' }, people: [{ id: 'h', name: 'Harsh' }], tasks: [] };
    await X.executeAction({ type: 'create_tasks', assigneeId: 'h', date: '2026-10-11', tasks: [{ title: 'check AC', details: null }, { title: 'broken', details: null }, { title: 'call vendor', details: null }] }, ctx, xio);
    check('3 tasks asked, 2 created → each created quietly, then ONE alert listing only the 2 that exist',
        made.length === 2 && made.every(i => i.notify === false) && alerts.length === 1 && alerts[0].titles.join() === 'check AC,call vendor', { made, alerts });
    made.length = 0; alerts.length = 0;
    await X.executeAction({ type: 'create_tasks', assigneeId: 'h', date: '2026-10-11', tasks: [{ title: 'single task', details: null }] }, ctx, xio);
    check('one task → the normal per-task alert (no grouping)', made.length === 1 && made[0].notify === undefined && alerts.length === 0, { made, alerts });

    // ── option 1: inside the 24-hour window, a normal message with one task per line ──
    const ct = (title: string, n: number, status = 'pending', from?: string) => ({ id: title, title, status, listNumber: n, isCarriedForward: !!from, assigned_date: from || '2026-10-14' }) as any;
    const day = [ct('dry-run test', 1, 'pending', '2026-10-08'), ct('7th-floor VRV AC repair', 2, 'in_progress', '2026-10-13'), ct('AMC renewal', 3, 'completed')];
    const rule = (ruleType: string) => ({ ruleType }) as any;
    const eodChat = N.buildChatMessage(rule('eod_summary'), 'Sahil Dhuri', day, '2026-10-14');
    check('EOD chat: header, count, carry-forward and today\'s tasks under headings, one per line',
        eodChat === '🌙 End-of-Day Task Summary\n\nCompleted 1/3 today:\n🔄 *Carry forward tasks*\n1. dry-run test (from 8 Oct) ⏳\n2. 7th-floor VRV AC repair (from 13 Oct) 🔄\n\n📋 *Today\'s tasks*\n3. AMC renewal ✅\n\nGreat work today! Any unfinished items will be carried forward to tomorrow.', eodChat);
    const middayChat = N.buildChatMessage(rule('pending_reminder'), 'Sahil Dhuri', day, '2026-10-14');
    // Owner 2026-10-16: three sections, one task per line, completed tasks included, "done 1" hint (first open task).
    check('midday chat: carry forward / pending today / completed sections, one task per line, "done 1" hint',
        middayChat === 'Hi Sahil! ⏳ Midday check-in\n\n🔄 *Carry forward* (2)\n1. dry-run test (from 8 Oct) ⏳\n2. 7th-floor VRV AC repair (from 13 Oct) 🔄\n\n✅ *Completed* (1)\n3. AMC renewal ✅\n\nReply "done 1" when you finish a task, or "tasks" to see your full list.', middayChat);
    const overdueChat = N.buildChatMessage(rule('overdue_alert'), 'Sahil Dhuri', day, '2026-10-14');
    check('overdue chat: open tasks from earlier days, oldest first, with due dates', /1\. dry-run test \(Due: 8 Oct\)\n2\. 7th-floor VRV AC repair \(Due: 13 Oct\)/.test(overdueChat) && overdueChat.startsWith('⚠️ Hello Sahil, you have 2 overdue tasks'), overdueChat);
    const morningChat = N.buildChatMessage(rule('morning_digest'), 'Sahil Dhuri', day, '2026-10-14');
    check('morning chat: greeting, date, list on separate lines, quick guide', morningChat.startsWith('Good morning Sahil! 📋\nYour Task Manager workspace is open for today (14 Oct 2026).\n\nYou have 3 tasks today:\n🔄 *Carry forward tasks*\n1. dry-run test (from 8 Oct) ⏳\n') && morningChat.includes("\n\n📋 *Today's tasks*\n3. AMC renewal ✅") && morningChat.includes('💡 Quick Guide:'), morningChat);
    check('morning chat with no tasks → the standup nudge', N.buildChatMessage(rule('morning_digest'), 'Sahil', [], '2026-10-14').includes(N.MORNING_NO_TASKS));
    const huge = N.buildChatMessage(rule('eod_summary'), 'Sahil', Array.from({ length: 200 }, (_, i) => ct(`task number ${i + 1} with a fairly long title for testing the limit`, i + 1)), '2026-10-14');
    check('a long chat list is cut with "…and N more" and stays under WhatsApp\'s 4,096 limit', huge.length < 3600 && /…and \d+ more/.test(huge), huge.length);
    check('a rule with a custom template keeps its own layout', N.buildChatMessage({ ruleType: 'eod_summary', customTemplate: { headerGreeting: 'Hey {{firstName}}' } } as any, 'Sahil', day, '2026-10-14').startsWith('Hey Sahil'));

    const L = await import('../InboundLedger');
    const before = net.length;
    const closed = await L.openChatWindows(['+91 98765 43210']);
    check('chat-window check fails safe: database unreachable → treated as closed (template)', closed.size === 0);
    net.length = before;   // that read went to the stubbed fetch on purpose
    const nsrc = fs.readFileSync(path.resolve(__dirname, '../TaskNotificationService.ts'), 'utf8');
    check('scheduled send: normal message only inside the window, template otherwise; can be turned off',
        /const asChat = chatOpen\.has\(phoneKey\(phone\)\)/.test(nsrc) && /templateOnly: asChat \? false : process\.env\.TASK_RULES_TEMPLATE_ONLY !== 'false'/.test(nsrc) && /TASK_RULES_CHAT_WHEN_OPEN === 'false'/.test(nsrc));
    // A real run of the scheduled loop (database, access and sending stubbed): inside the window → normal message, else template.
    const { TaskDatabaseService: DB } = await import('../TaskDatabaseService');
    const { TaskAccessService: ACC } = await import('../TaskAccessService');
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    const dbs = DB as any;
    dbs.getEmployeeById = async () => ({ id: 'e1', name: 'Sahil Dhuri', phone_number: '+91 98765 43210', active: true, role: 'employee' });
    dbs.getFilteredAssignments = async () => day;
    dbs.logAudit = async () => {};
    dbs.getAllEmployees = async () => [];   // the evening team digest after the run reads this
    dbs.getAuditLogs = async () => [];
    dbs.getTestingConfig = async () => ({ enabled: false });
    (ACC as any).partition = async (emps: any[]) => ({ allowed: emps, locked: [] });
    m.resolveSendMode = async () => ({ mode: 'send' });
    const sent: Array<{ kind: string; text: string }> = [];
    m.postFreeform = async (_p: string, text: string) => { sent.push({ kind: 'chat', text }); return true; };
    m.postTemplate = async (p: any) => { sent.push({ kind: 'template', text: p.templateParams.join(' | ') }); return true; };
    let ledgerRows: any[] = [];
    const realFrom = (supabaseAdmin as any).from.bind(supabaseAdmin);
    (supabaseAdmin as any).from = (table: string) => {
        if (table !== 'whatsapp_inbound_ledger') return realFrom(table);
        const q: any = { select: () => q, in: () => q, gte: () => q, then: (ok: any) => ok({ data: ledgerRows, error: null }) };
        return q;
    };
    ledgerRows = [{ phone_key: '9876543210' }];
    await N.sendMorningNotifications({ employeeId: 'e1', date: '2026-10-14', rule: { id: 'r', ruleType: 'eod_summary', name: 'Evening' } as any });
    check('messaged in the last 24 h → End-of-Day goes as a normal message, one task per line', sent.length === 1 && sent[0].kind === 'chat' && sent[0].text.includes('\n1. dry-run test (from 8 Oct) ⏳\n2. '), sent);
    sent.length = 0; ledgerRows = [];
    await N.sendMorningNotifications({ employeeId: 'e1', date: '2026-10-14', rule: { id: 'r', ruleType: 'eod_summary', name: 'Evening' } as any });
    check('not messaged in the last 24 h → the approved one-line template, as before', sent.length === 1 && sent[0].kind === 'template' && sent[0].text.startsWith('Completed 1/3 — '), sent);
    sent.length = 0; ledgerRows = [{ phone_key: '9876543210' }];
    m.postFreeform = async () => false;
    await N.sendMorningNotifications({ employeeId: 'e1', date: '2026-10-14', rule: { id: 'r', ruleType: 'eod_summary', name: 'Evening' } as any });
    check('normal message fails → the template is sent instead, so the person still gets it', sent.length === 1 && sent[0].kind === 'template', sent);
    (supabaseAdmin as any).from = realFrom;

    const lsrc = fs.readFileSync(path.resolve(__dirname, '../InboundLedger.ts'), 'utf8');
    check('the window is 23 hours (an hour of margin before WhatsApp\'s 24)', L.CHAT_WINDOW_MS === 23 * 3600_000 && /\.gte\('received_at', since\)/.test(lsrc));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 TEMPLATE-ONLY RULES TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
