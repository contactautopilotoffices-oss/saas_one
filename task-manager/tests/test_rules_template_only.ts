/**
 * Scheduled rules → approved template only (OFFLINE: fake database URL, stubbed gate and senders, no network, no WhatsApp).
 * Run: npx tsx task-manager/tests/test_rules_template_only.ts
 */
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
    check('midday: one line, pending only', !bad(midday) && !midday.includes('lift AMC') && midday.includes('2. submit eod report ⏳'), midday);
    check('eod: one line with the completed count', !bad(eod) && eod.startsWith('Completed 1/3 — '), eod);
    check('carried-forward tasks are marked', morning.startsWith('1. 🔄 submit daily report'), morning);
    check('items are separated by " | "', morning.split(' | ').length === 3, morning);

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

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 TEMPLATE-ONLY RULES TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
