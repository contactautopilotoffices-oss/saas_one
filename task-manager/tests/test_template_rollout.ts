/**
 * Approved templates rollout (2026-10-12) + the Phase 5 cost-cap fix (OFFLINE: fake database URL, a network trap,
 * stubs for every database / WhatsApp call; nothing is sent, nothing is written).
 * Run: npx tsx task-manager/tests/test_template_rollout.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const oneLine = (a: string[]) => !a.some(p => /[\n\r\t]| {5,}/.test(p));

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const A = await import('../taskAlerts');
    const { TaskMessagingService: M } = await import('../TaskMessagingService');
    const { TaskNotificationService: N } = await import('../TaskNotificationService');
    const { TaskDatabaseService: DB } = await import('../TaskDatabaseService');
    const { TaskProgressService: P } = await import('../TaskProgressService');
    const C = await import('../completionNotice');
    const X = await import('../brain/execute');
    const R = await import('../DepartmentRulesService');
    (await import('../BotSwitches')).primeBotSwitches(null);

    console.log('\n1. Which template each message uses');
    check('overdue alert → task_overdue_alert_v1 (no longer the midday one)', M.getCampaignForRuleType('overdue_alert') === 'task_overdue_alert_v1');
    check('team digest → task_manager_team_digest_v1', M.getCampaignForRuleType('team_digest') === 'task_manager_team_digest_v1');
    check('morning → task_morning_kickoff_v2; midday / evening unchanged', M.getCampaignForRuleType('morning_digest') === 'task_morning_kickoff_v2' && M.getCampaignForRuleType('pending_reminder') === 'task_midday_reminder_v1' && M.getCampaignForRuleType('eod_summary') === 'task_eod_summary_v1');
    check('hand-over / completed / digest names', A.HANDOVER_CAMPAIGN === 'task_handover_v1' && A.COMPLETED_CAMPAIGN === 'task_completed_notice_v1' && A.TEAM_DIGEST_CAMPAIGN === 'task_manager_team_digest_v1');
    check('admin alert template can be renamed by env, default whatsapp_bot_admin_alert_v2', (await import('../BotHealthRuntime')).ADMIN_ALERT_CAMPAIGN === 'whatsapp_bot_admin_alert_v2' && /AISENSY_BOT_ADMIN_ALERT_CAMPAIGN/.test(read('task-manager/BotHealthRuntime.ts')));

    console.log('\n2. Filling the blanks (one line each — Meta rejects line breaks)');
    const h = A.handoverParams('Vidya Nair', 'Priyanka (Procurement)', ['Single Disc\nMachine PO'], '2026-10-12');
    check('hand-over: [first name, giver (dept), task, date]', JSON.stringify(h) === JSON.stringify(['Vidya', 'Priyanka (Procurement)', 'Single Disc Machine PO', '12 Oct 2026']), h);
    const c = A.completedParams('Priyanka Shah', ['Carpet Installation PO'], 'Vidya Nair', 'Procurement', new Date('2026-10-11T11:00:00.000Z'));
    check('completed: [first name, task, who, dept, India time]', JSON.stringify(c) === JSON.stringify(['Priyanka', 'Carpet Installation PO', 'Vidya Nair', 'Procurement', '11 Oct 2026, 04:30 PM']), c);
    const d = A.teamDigestParams({ recipientName: 'Lohitaksha R', scope: 'Tech Department', date: '2026-10-11', members: 5, completed: 12, pending: 3, rows: [{ label: 'Tech', done: 12, total: 12 }, { label: 'Ops', done: 18, total: 20 }, { label: 'New', done: 0, total: 0 }] });
    check('team digest: 7 blanks, status list like the approved sample', d.length === 7 && d[0] === 'Lohitaksha' && d[2] === '11 Oct 2026' && d[6] === 'Today: • Tech: 12/12 Done (100% ✅) | • Ops: 18/20 Done (2 Pending ⏳) | • New: 0/0 Done (no tasks)', d);   // "Today:" added 2026-10-16
    check('a huge team list is cut with "…and N more"', /…and \d+ more$/.test(A.digestStatusList(Array.from({ length: 60 }, (_, i) => ({ label: `Person number ${i}`, done: 1, total: 2 })))));
    const t = (title: string, date: string, status = 'pending') => ({ id: title, title, assigned_date: date, status }) as any;
    const o = N.buildOverdueTemplateParams('Rahul Mehta', [t('Chiller Filter Check', '2026-10-09'), t('DG Meter\nLog', '2026-10-10'), t('Today task', '2026-10-12'), t('Done one', '2026-10-08', 'completed')], '2026-10-12');
    check('overdue: [first name, count, oldest-first list with due dates] — today and done tasks are not overdue',
        JSON.stringify(o) === JSON.stringify(['Rahul', '2', '1. Chiller Filter Check (Due: 9 Oct) | 2. DG Meter Log (Due: 10 Oct)']), o);
    check('all of the above are single lines', oneLine([...h, ...c, ...d, ...o]));

    console.log('\n3. "Task completed" to the giver — every completion');
    const people: Record<string, any> = {
        giver: { id: 'giver', name: 'Priyanka Shah', phone_number: '9000000001', department_name: 'Procurement', department_id: 'd1', active: true },
        vidya: { id: 'vidya', name: 'Vidya Nair', phone_number: '9000000002', department_name: 'Procurement', department_id: 'd1', active: true },
        harsh: { id: 'harsh', name: 'Harsh Patel', phone_number: '9000000003', department_name: 'Tech', department_id: 'd2', active: true },
        gone: { id: 'gone', name: 'Old Boss', phone_number: '9000000009', department_name: null, department_id: null, active: false },
        nophone: { id: 'nophone', name: 'No Phone', phone_number: '', department_name: null, department_id: null, active: true },
    };
    const mkIO = (recent: string[] = []) => {
        const w: any = { sent: [] as any[], audits: [] as string[] };
        w.io = { recentlyNotified: async () => new Set(recent), person: async (id: string) => people[id] ?? null, audit: async (r: any) => { w.audits.push(r.id); }, send: async (phone: string, input: any) => { w.sent.push({ phone, input }); return true; } };
        return w;
    };
    const row = (id: string, holder: string, giver: string | null) => ({ id, title: `Task ${id}`, employee_id: holder, assigned_by: giver });
    let w = mkIO();
    await C.notifyGiversOfCompletion([row('1', 'vidya', 'giver'), row('2', 'vidya', 'giver'), row('3', 'harsh', 'giver'), row('4', 'vidya', 'vidya'), row('5', 'vidya', null)], w.io);
    check('two tasks Vidya finished for Priyanka → ONE message listing both; Harsh\'s → its own; own / unassigned tasks → nothing',
        w.sent.length === 2 && w.sent[0].phone === '9000000001' && JSON.stringify(w.sent[0].input.titles) === '["Task 1","Task 2"]' && w.sent[0].input.completedByName === 'Vidya Nair' && w.sent[1].input.completedByName === 'Harsh Patel', w.sent);
    check('each notified task is audited (so it is not repeated within the hour)', JSON.stringify(w.audits) === '["1","2","3"]', w.audits);
    w = mkIO(['1']);
    await C.notifyGiversOfCompletion([row('1', 'vidya', 'giver'), row('2', 'vidya', 'giver')], w.io);
    check('a task already notified in the last hour is not repeated', w.sent.length === 1 && JSON.stringify(w.sent[0].input.titles) === '["Task 2"]');
    w = mkIO();
    await C.notifyGiversOfCompletion([row('1', 'vidya', 'gone'), row('2', 'vidya', 'nophone')], w.io);
    check('inactive giver or no phone → nothing', w.sent.length === 0);
    check('never throws', (await C.notifyGiversOfCompletion([row('1', 'vidya', 'giver')], { ...mkIO().io, person: async () => { throw new Error('db down'); } })) === 0);

    console.log('\n4. The AI path: one grouped notice, and no double message after a relayed superuser reply');
    const calls: any[] = [];
    const xio: any = { setStatus: async (_a: string, id: string, s: string, opts?: any) => { calls.push(['set', id, s, opts?.notifyGiver]); }, notifyCompleted: async (_a: string, ids: string[]) => { calls.push(['notify', ids]); },
        assign: async () => {}, handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '', relay: async () => ({ told: ['Priyanka Shah'], couldNot: [] }) };
    const ctx: any = { sender: { id: 'me' }, people: [], tasks: [{ n: 1, id: 't1', title: 'A', status: 'pending' }, { n: 2, id: 't2', title: 'B', status: 'pending' }] };
    await X.executeAction({ type: 'complete_tasks', taskIds: ['t1', 't2'] }, ctx, xio);
    check('"done 1 and 2" → both completed quietly, then ONE grouped notice', JSON.stringify(calls) === JSON.stringify([['set', 't1', 'completed', false], ['set', 't2', 'completed', false], ['notify', ['t1', 't2']]]), calls);
    calls.length = 0;
    await X.executeAction({ type: 'progress_update', state: 'done_all', taskIds: ['t1'], note: null }, ctx, xio, { relay: true });
    check('a superuser\'s "done" reply is relayed (with the note) → NO separate completion notice', JSON.stringify(calls) === JSON.stringify([['set', 't1', 'completed', false]]), calls);
    calls.length = 0;
    await X.executeAction({ type: 'complete_tasks', taskIds: ['t1'] }, ctx, { ...xio, notifyCompleted: undefined });
    check('without a grouped notifier, each completion notifies on its own (old behaviour kept)', JSON.stringify(calls) === JSON.stringify([['set', 't1', 'completed', undefined]]), calls);
    check('every place a task is marked done tells the giver', /notifyGiversOfCompletion\(\[targetTask\]\)/.test(read('task-manager/TaskCommandHandler.ts')) && /notifyGiversOfCompletion\(pendingTasks\)/.test(read('task-manager/TaskCommandHandler.ts'))
        && /notifyGiversOfCompletion\(\[taskRow as TaskAssignment\]\)/.test(read('app/api/task-manager/tasks/route.ts')) && /notifyGiversOfCompletion\(\[row\]\)/.test(read('task-manager/WorkspaceService.ts')));
    check('hand-over uses task_handover_v1 (not the old "…, handed over" workaround)', /sendTaskHandover\(target\.phone_number/.test(read('task-manager/WorkspaceService.ts')) && !/, handed over/.test(read('task-manager/WorkspaceService.ts')));

    console.log('\n5. Team digest with the Evening summary — managers and superusers only, once a day');
    const sent: any[] = []; const logged: any[] = [];
    (M as any).sendMessage = async (phone: string, _t: string, opts: any) => { sent.push({ phone, campaign: opts.campaignName, params: opts.templateParams, templateOnly: opts.templateOnly }); return true; };
    (DB as any).getAuditLogs = async () => [{ event_type: 'team_digest_sent', target_employee_id: 'mgr2', details: { date: '2026-10-11' } }];
    (DB as any).logAudit = async (e: any) => { logged.push(e); };
    (P as any).getDepartmentProgress = async (id: string) => ({ departmentName: id === 'd1' ? 'Tech' : 'Ops', activeEmployeeCount: 2, total: 5, completed: 3,
        employeeProgress: [{ employeeName: 'Vidya Nair', completed: 2, total: 2 }, { employeeName: 'Harsh Patel', completed: 1, total: 3 }] });
    (P as any).getOrganisationProgress = async () => ({ totalEmployees: 90, total: 40, completed: 31, departmentProgress: [{ departmentId: 'd1', departmentName: 'Tech', activeEmployeeCount: 10, completed: 12, total: 12 }, { departmentId: 'd2', departmentName: 'Ops', activeEmployeeCount: 18, completed: 19, total: 22 }, { departmentId: 'dOff', departmentName: 'Sales', activeEmployeeCount: 62, completed: 0, total: 6 }] });
    const { TaskAccessService: TA0 } = await import('../TaskAccessService');
    const realActiveIds = TA0.activeDepartmentIds.bind(TA0);
    (TA0 as any).activeDepartmentIds = async () => new Set(['d1', 'd2']);
    const emp = (id: string, role: string, dept: string | null, phone = `90000000${id.length}${id.length}`) => ({ id, name: `${id} Person`, role, department_id: dept, phone_number: phone }) as any;
    const n = await N.sendTeamDigests([emp('staff', 'employee', 'd1'), emp('mgr1', 'reporting_manager', 'd1'), emp('mgr2', 'reporting_manager', 'd2'), emp('boss', 'superuser', 'd9')], '2026-10-11');
    check('only managers / superusers get it; someone already sent today is skipped', n === 2 && sent.length === 2, sent);
    check('a manager gets their department, one line per person', sent[0].campaign === 'task_manager_team_digest_v1' && sent[0].templateOnly === true && sent[0].params[1] === 'Tech Department' && sent[0].params[6] === '• Vidya Nair: 2/2 Done (100% ✅) | • Harsh Patel: 1/3 Done (2 Pending ⏳)', sent[0]);
    check('a superuser gets all departments', sent[1].params[1] === 'All Active Departments' && sent[1].params[3] === '28' && sent[1].params[4] === '31' && sent[1].params[5] === '3', sent[1]);
    check('…but ONLY departments where the Task Manager is ON (Sales is OFF → not listed, not counted)', !/Sales/.test(sent[1].params[6]) && /Tech/.test(sent[1].params[6]) && /Ops/.test(sent[1].params[6]), sent[1].params[6]);
    check('each digest is recorded so a second evening rule does not repeat it', logged.filter(e => e.eventType === 'team_digest_sent').length === 2);
    check('it rides on the Evening summary rule (no new rule) and never fails it; superusers added from any team / company evening rule, never a personal one',
        /ruleType === 'eod_summary' && !options\.dryRun\) \{\s*try \{\s*const extra = options\.rule\.ownerUserId \? \[\] : await this\.eligibleSuperusers\(\);\s*await this\.sendTeamDigests\(\[\.\.\.employees, \.\.\.extra\.filter/.test(read('task-manager/TaskNotificationService.ts')));

    console.log('\n6. The "Overdue alert" rule');
    const def = R.defaultsFor('overdue_alert' as any);
    check('it can be created, and only looks at OPEN tasks from earlier days (last 7)', R.ALLOWED_RULE_TYPES.includes('overdue_alert' as any) && def.taskFilters?.includeTodayAssigned === false && def.taskFilters?.includeTodayFixed === false && def.taskFilters?.lookbackDays === 7 && def.taskFilters?.onlyPending === true);
    check('people with nothing overdue are skipped (no "you have no overdue tasks" message)', /ruleType === 'overdue_alert' && !this\.overdueTasks\(tasks, targetDate\)\.length/.test(read('task-manager/TaskNotificationService.ts')));
    check('the Notifications screen offers it', /id: 'overdue_alert', label: 'Overdue alert'/.test(read('frontend/components/procurement/tasks/NotificationsView.tsx')));

    console.log('\n7. Phase 5 fix: a safety test is charged what it really costs');
    const H = await import('../BotLearningHousekeeping');
    const fake = (tokensIn: number, tokensOut: number) => ({ complete: async () => ({ text: '{}', tokensIn, tokensOut }) });
    const state = { costUsd: 0 };
    await H.budgeted(fake(2000, 100), state).complete({ model: 'glm-5.3-flash', system: 'x'.repeat(7000), user: 'y'.repeat(700), json: true, maxTokens: 1500 });
    check('charged the real usage (2000 in / 100 out), not the worst case', Math.abs(state.costUsd - (2000 * 0.135 + 100 * 0.45) / 1e6) < 1e-12, state.costUsd);
    const s2 = { costUsd: 0 };
    await H.budgeted(fake(0, 0), s2).complete({ model: 'glm-5.3-flash', system: 'x', user: 'y', json: true, maxTokens: 100 });
    check('no usage reported → the worst case is charged (safe side)', s2.costUsd > 0);
    let threw = false; try { await H.budgeted(fake(1, 1), { costUsd: 0.4999 }).complete({ model: 'glm-5.3-flash', system: 'x'.repeat(9000), user: '', json: true, maxTokens: 1500 }); } catch { threw = true; }
    check('a call that could cross the cap is still refused before it is made', threw);
    const est = (190 * 2) * ((2100 * 0.135 + 120 * 0.45) / 1e6);
    check(`a full test (~190 cases × 2 versions) now fits the cap (≈ $${est.toFixed(2)} of $0.50)`, est < 0.5);
    const hs = read('task-manager/BotLearningHousekeeping.ts');
    check('the safety test skips writing replies, and a technical stop frees the labelled cases for the next night', /skipReply: true/.test(hs) && /status: 'rejected', rejection_reason: message, source_label_at: null/.test(hs));

    console.log('\n8. Morning standup (task_morning_kickoff_v2) and the "done N" hint');
    check('morning rule → v2 (three blanks)', N.usesMorningV2('morning_digest') && !N.usesMorningV2('pending_reminder') && !N.usesMorningV2('eod_summary'));
    const mt = [t('Submit EOD report', '2026-10-12'), { ...t('Call vendor', '2026-10-12'), status: 'in_progress' }, { ...t('Old one', '2026-10-11'), isCarriedForward: true }];
    const mv = N.buildMorningV2Params('Harsh Patel', mt, '2026-10-12');
    // 2026-10-14: carry-forward and today's tasks are labelled on the one line; each task keeps its own number.
    check('with tasks: [first name, date, one-line summary]', JSON.stringify(mv) === JSON.stringify(['Harsh', '12 Oct 2026', 'You have 3 tasks today: Carry forward: 3. Old one ⏳ — Today: 1. Submit EOD report ⏳ | 2. Call vendor 🔄']), mv);
    const me = N.buildMorningV2Params('Harsh Patel', [], '2026-10-12');
    check('no tasks: the approved nudge sentence', me[2] === 'You have no tasks logged yet. Speak or type your priorities for today to add them to your board.' && oneLine(me));
    check('the preview is the approved template text', /^Daily Task Standup 📋\n\nGood morning Harsh!\nYour Task Manager workspace is open for today \(12 Oct 2026\)\./.test(N.morningV2Preview(me)));
    check('people with no tasks are greeted only by the morning standup on a "don\'t skip" rule', /const greetEmpty = this\.usesMorningV2\(options\.rule\?\.ruleType\) && options\.rule\?\.conditions\?\.skipIfZeroTasks === false;\s*if \(tasks\.length === 0 && !greetEmpty\)/.test(read('task-manager/TaskNotificationService.ts')));
    process.env.AISENSY_TASK_MORNING_CAMPAIGN = 'task_morning_kickoff_v1';
    check('if the env still says v1, the old one-blank format is used (no mismatched sends)', !N.usesMorningV2('morning_digest'));
    delete process.env.AISENSY_TASK_MORNING_CAMPAIGN;
    const F = await import('../brain/frontDoor');
    const view = (tasks: any[]) => (F.planExact({ kind: 'view' }, { tasks } as any) as any).text as string;
    check('one task → "Reply done 1" (not done 2)', /Reply \*done 1\* when you finish task 1\./.test(view([{ n: 1, id: 'a', title: 'Submit EOD report', status: 'pending' }])));
    check('task 1 already done → the hint points at the first OPEN task', /Reply \*done 2\* when you finish task 2\./.test(view([{ n: 1, id: 'a', title: 'A', status: 'completed' }, { n: 2, id: 'b', title: 'B', status: 'pending' }])));
    check('everything done → no done-hint at all', /All done for today ✅$/.test(view([{ n: 1, id: 'a', title: 'A', status: 'completed' }])));
    check('the AI-down help no longer names a fixed task number', !/done 2/.test(F.AI_DOWN_HELP));

    console.log('\n9. Midday team progress — only when something is pending');
    sent.length = 0; logged.length = 0;
    (DB as any).getAuditLogs = async () => [{ event_type: 'team_digest_sent', target_employee_id: 'mgr1', details: { date: '2026-10-12', kind: 'evening' } }];
    const deptPending: Record<string, number> = { d1: 2, d2: 0 };
    (P as any).getDepartmentProgress = async (id: string) => ({ departmentName: id, activeEmployeeCount: 2, total: 5, completed: 5 - deptPending[id], employeeProgress: [{ employeeName: 'A', completed: 5 - deptPending[id], total: 5 }] });
    (P as any).getOrganisationProgress = async () => ({ totalEmployees: 10, total: 20, completed: 20, departmentProgress: [{ departmentId: 'd1', departmentName: 'Tech', activeEmployeeCount: 10, completed: 10, total: 10 }, { departmentId: 'dOff', departmentName: 'Sales', activeEmployeeCount: 5, completed: 0, total: 4 }] });
    const mid = await N.sendTeamDigests([emp('mgr1', 'reporting_manager', 'd1'), emp('mgr2', 'reporting_manager', 'd2'), emp('boss', 'superuser', 'd9')], '2026-10-12', 'midday');
    check('manager with pending work in their department → gets it (an EVENING record does not block midday)', mid === 1 && sent.length === 1 && sent[0].params[1] === 'd1 Department' && sent[0].params[5] === '2', sent);
    check('manager whose department has nothing pending → nothing sent', !sent.some((s: any) => s.params[1] === 'd2 Department'));
    check('superuser when the ACTIVE departments have nothing pending → nothing sent (pending work in an OFF department does not count)', !sent.some((s: any) => s.params[1] === 'All Active Departments'));
    check('recorded as a MIDDAY digest (so it never blocks the evening one)', logged.some(e => e.eventType === 'team_digest_sent' && e.details.kind === 'midday'));
    (DB as any).getAuditLogs = async () => [{ event_type: 'team_digest_sent', target_employee_id: 'mgr1', details: { date: '2026-10-12', kind: 'midday' } }];
    sent.length = 0;
    await N.sendTeamDigests([emp('mgr1', 'reporting_manager', 'd1')], '2026-10-12', 'midday');
    check('a second midday rule the same day does not repeat it', sent.length === 0);
    check('it is wired to the Midday reminder rule', /ruleType === 'pending_reminder' && !options\.dryRun\) \{[\s\S]{0,400}await this\.sendTeamDigests\(audience, targetDate, 'midday'\)/.test(read('task-manager/TaskNotificationService.ts')));

    console.log('\n10. Learning loop drafts with Gemini first (different family), then falls back');
    const { BUILTIN_PROMPT_SECTIONS } = await import('../brain/prompt');
    const good = JSON.stringify({ steps: BUILTIN_PROMPT_SECTIONS.steps, examples: BUILTIN_PROMPT_SECTIONS.examples, change_summary: 'Clarify Hinglish done messages.' });
    const st = () => ({ index: 0, before: [], after: [], attempts: {}, costUsd: 0, baselineSections: BUILTIN_PROMPT_SECTIONS } as any);
    const tried: string[] = [];
    const gem = (failing: string[]) => ({ complete: async (req: any) => { tried.push(req.model); if (failing.includes(req.model)) throw new Error('503 high demand'); return { text: good, tokensIn: 100, tokensOut: 50 }; } });
    const glm = { complete: async (req: any) => { tried.push(req.model); return { text: good, tokensIn: 100, tokensOut: 50 }; } };
    const { validatePromptSections } = await import('../brain/prompt');
    const base = BUILTIN_PROMPT_SECTIONS.steps.concat(BUILTIN_PROMPT_SECTIONS.examples).join('\n').length;
    check('the built-in instructions pass their OWN validator (blank separator lines allowed) — this used to fail, so every draft was rejected',
        validatePromptSections(BUILTIN_PROMPT_SECTIONS, { maxChars: 12000, maxBaseChars: base }).ok && !validatePromptSections({ steps: ['', ' '], examples: ['x'] }, { maxChars: 12000, maxBaseChars: base }).ok);
    let dr = await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], st(), glm, gem([]));
    check('Gemini answers → it drafts (newest Flash first)', dr.model === 'gemini-3.8-flash' && tried.join() === 'gemini-3.8-flash', tried);
    tried.length = 0;
    dr = await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], st(), glm, gem(['gemini-3.8-flash']));
    check('newest Flash busy → the stable Flash drafts', dr.model === 'gemini-2.5-flash' && tried.join() === 'gemini-3.8-flash,gemini-2.5-flash', tried);
    tried.length = 0;
    dr = await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], st(), glm, gem(['gemini-3.8-flash', 'gemini-2.5-flash']));
    check('Gemini down (or credits depleted) → the existing glm-5.3-flash drafts, nothing stops', dr.model === 'glm-5.3-flash', tried);
    tried.length = 0;
    dr = await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], st(), glm, null);
    check('no Gemini key → straight to glm-5.3-flash', dr.model === 'glm-5.3-flash' && tried.join() === 'glm-5.3-flash');
    const s3 = st(); s3.costUsd = 0.4999;
    let stopped = ''; try { await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], s3, glm, gem([])); } catch (e) { stopped = String(e); }
    check('at the spending cap it stops — it does not keep trying other models', /cost cap/.test(stopped) && !/glm-5\.3-flash:/.test(stopped), stopped);
    check('the drafting model is recorded on the version (visible on the Prompt versions card)', /\[drafted by \$\{draft\.model\}\]/.test(read('task-manager/BotLearningHousekeeping.ts')));
    const G = await import('../brain/geminiLlm');
    check('a dedicated GEMINI_AUTOTUNE_API_KEY is preferred; models overridable', /GEMINI_AUTOTUNE_API_KEY \|\| process\.env\.GEMINI_API_KEY/.test(read('task-manager/brain/geminiLlm.ts')) && G.geminiDraftModels().join() === 'gemini-3.8-flash,gemini-2.5-flash');

    console.log('\n11. Superusers get company progress at midday from ANY team rule; manager switch moved to Task Access');
    const { TaskAccessService: TA } = await import('../TaskAccessService');
    const people2 = [
        { id: 's1', name: 'Saniel M', role: 'superuser', active: true, phone_number: '9000000001', department_id: 'mgmt' },
        { id: 's2', name: 'Other S', role: 'superuser', active: true, phone_number: '9000000002', department_id: 'mgmt' },
        { id: 's3', name: 'Gone S', role: 'superuser', active: false, phone_number: '9000000003', department_id: 'mgmt' },
        { id: 'e1', name: 'Emp', role: 'employee', active: true, phone_number: '9000000004', department_id: 'd1' },
    ] as any[];
    (DB as any).getAllEmployees = async () => people2;
    let sandbox: any = { enabled: true, employees: [{ name: 'Saniel', phone: '+91 90000 00001' }] };
    (DB as any).getTestingConfig = async () => sandbox;
    let partitioned: string[] = [];
    (TA as any).partition = async (list: any[]) => { partitioned = list.map(x => x.id); return { allowed: list.filter(x => x.id !== 's2' || !sandbox.lockS2), locked: [] }; };
    let su = await N.eligibleSuperusers();
    check('sandbox ON → only superusers on the sandbox list (never a stranger), and only active ones', JSON.stringify(su.map(x => x.id)) === '["s1"]', su.map(x => x.id));
    sandbox = { enabled: false, lockS2: true };
    su = await N.eligibleSuperusers();
    check('the normal Task Manager access check still applies (a locked superuser is left out)', JSON.stringify(partitioned) === '["s1","s2"]' && JSON.stringify(su.map(x => x.id)) === '["s1"]', { partitioned, su: su.map(x => x.id) });
    const ns = read('task-manager/TaskNotificationService.ts');
    check('wired: any team / company midday rule adds the superusers; a personal reminder never does', /const extra = options\.rule\.ownerUserId \? \[\] : await this\.eligibleSuperusers\(\);/.test(ns) && /sendTeamDigests\(audience, targetDate, 'midday'\)/.test(ns));
    const tas = read('task-manager/TaskAccessService.ts');
    check('"Make manager" uses the same database change and audit events as the old card, and never downgrades a superuser',
        /static async setReportingManager\(/.test(tas) && /task_role: enabled \? 'reporting_manager' : 'employee'/.test(tas) && /enabled \? 'manager_role_assigned' : 'manager_role_removed'/.test(tas) && /Remove the superuser role first/.test(tas));
    check('the switch is in the Task Access panel (admin-guarded API), hidden for superusers',
        /action === 'set_manager'/.test(read('app/api/task-manager/access/route.ts')) && /toggleManager\(m\)/.test(read('frontend/components/task-manager/TaskAccessPanel.tsx')) && /m\.taskRole !== 'superuser' && \(/.test(read('frontend/components/task-manager/TaskAccessPanel.tsx')));
    const dash = read('frontend/components/task-manager/TaskManagerTestingDashboard.tsx');
    check('the old "Manager Role Assignment & WhatsApp Kickoff" card is gone; the API the page still loads from is kept',
        !/Manager Role Assignment/.test(dash) && !/handleRoleAction/.test(dash) && /fetch\('\/api\/task-manager\/manager-role'\)/.test(dash) && fs.existsSync(path.resolve(__dirname, '../../app/api/task-manager/manager-role/route.ts')));
    check('custom wording is gone from Notifications, and saving clears any old custom text',
        !/Customize the wording/.test(read('frontend/components/procurement/tasks/NotificationsView.tsx')) && /customTemplate: \{ headerGreeting: '', customMessage: '', footerInstruction: '', includeQuickReplies: true \}/.test(read('frontend/components/procurement/tasks/NotificationsView.tsx')));

    console.log('\n12. Voice notes: a Task Access switch for everyone (no redeploy)');
    const BS = await import('../BotSwitches');
    BS.resetBotSwitchCache(); (DB as any).getTestingConfig = async () => ({ voiceNotesEnabled: true });
    check('switch ON in the settings → voice notes on', (await BS.botSwitchOn('voiceNotes')) === true);
    BS.resetBotSwitchCache(); (DB as any).getTestingConfig = async () => ({});
    check('default → OFF', (await BS.botSwitchOn('voiceNotes')) === false);
    check('the old env VOICE_NOTES_ENABLED still forces it ON; no allow-list needed (empty = everyone recognised)', /voiceNotes: 'VOICE_NOTES_ENABLED'/.test(read('task-manager/BotSwitches.ts')) && /Unset \/ empty → no limit/.test(read('task-manager/voice/VoiceIntake.ts')));
    check('voice intake reads the switch (not only the env)', /botSwitchOn\('voiceNotes'\)/.test(read('task-manager/voice/VoiceIntake.ts')) && !/process\.env\.VOICE_NOTES_ENABLED !== 'true'/.test(read('task-manager/voice/VoiceIntake.ts')));
    check('the panel and the admin API know it', /key: 'voiceNotes', title: 'Voice notes'/.test(read('frontend/components/task-manager/TaskAccessPanel.tsx')) && /'voiceNotes'\]\.includes\(body\.feature\)/.test(read('app/api/task-manager/access/route.ts')));

    console.log('\n13. Active departments only: the helper and "how is my team doing"');
    const snap = (provisioned: boolean, readable: boolean, on: Array<[string, boolean]>) => ({ provisioned, readable, departmentEnabled: new Map(on), onboarded: new Map() }) as any;
    const ids = async (x: any) => [...(await realActiveIds(x))].sort().join();
    check('ON departments only', (await ids(snap(true, true, [['d1', true], ['d2', false], ['d3', true]]))) === 'd1,d3');
    check('settings unreadable → none (fail closed)', (await ids(snap(true, false, [['d1', true]]))) === '');
    check('access not set up yet → Tech only (same as the access rule)', (await ids(snap(false, true, []))) === '94a74961-2dd8-453d-9728-f6f2b9ade99b');
    check('"how is my team doing" lists only people in ON departments', /active\.has\(e\.department_id\)/.test(read('task-manager/brain/live.ts')) && /TaskAccessService\.activeDepartmentIds\(\)/.test(read('task-manager/brain/live.ts')));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 TEMPLATE ROLLOUT TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
