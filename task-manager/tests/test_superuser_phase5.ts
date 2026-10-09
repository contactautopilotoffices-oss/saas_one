/**
 * Phase 5 — working with a superuser (100% OFFLINE: fake data, a scripted AI, RECORDERS in place of WhatsApp and the task
 * functions; no network, no real database, no message can be sent from this file).
 * Run: npx tsx task-manager/tests/test_superuser_phase5.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const M = await import('../pingMessage');
    const P = await import('../SuperuserPingService');
    const R = await import('../brain/relay');
    const X = await import('../brain/execute');
    const L = await import('../brain/live');
    const { tasksDomain } = await import('../brain/tasksDomain');
    const { world } = await import('../brain/eval/worlds');
    const { PermissionService, PermissionDeniedError } = await import('../PermissionService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');

    // ── 1. the wording ───────────────────────────────────────────────────────
    console.log('\n1. The message Saniel sees (and the live preview is the same function)');
    const input = { fromLabel: 'Priyanka', department: 'Procurement', tasks: ['Carpet Installation PO', 'Kone Lift AMC Renewal'], note: 'Need a decision by Friday' };
    const text = M.buildPingText(input);
    check('says who it is from and from which department, lists the tasks, then the note and the swipe-reply line',
        text === '🔔 *Pending for you* — from Priyanka, Procurement\n\n1. Carpet Installation PO\n2. Kone Lift AMC Renewal\n\n📝 Need a decision by Friday\n\nSwipe-reply to this message.', text);
    check('the "from" name can be anything the sender types', M.buildPingText({ ...input, fromLabel: 'Procurement team' }).includes('from Procurement team, Procurement'));
    check('no note → no note line', !M.buildPingText({ ...input, note: '' }).includes('📝'));
    const long = M.buildPingText({ ...input, tasks: Array.from({ length: 12 }, (_, i) => `Task ${i + 1}`) });
    check('more than 8 tasks → the first 8 and "…and 4 more"', (long.match(/^\d+\. /gm) || []).length === 8 && long.includes('…and 4 more'), long);
    const params = M.buildPingTemplateParams(input, 'Saniel Shah');
    check('the approved template gets three blanks: his first name, who (department), and the tasks on ONE line', params.length === 3 && params[0] === 'Saniel' && params[1] === 'Priyanka (Procurement)' && params[2] === '1. Carpet Installation PO | 2. Kone Lift AMC Renewal', params);
    check('template blanks never contain a line break, tab or long run of spaces (Meta rejects them)', ![...params, ...M.buildPingTemplateParams({ ...input, fromLabel: 'A\nB', tasks: ['x\n\ty    z'] })].some(p => /[\n\t]|\s{4,}/.test(p)));
    const groups = [{ assigner: 'Priyanka', tasks: ['A', 'B'] }, { assigner: 'Vidya', tasks: ['C'] }];
    const rem = M.buildReminderText('Procurement', groups);
    check('the regular reminder groups his pending work by who gave it, with a total', /Your pending work from Procurement\* \(3\)/.test(rem) && /\*From Priyanka\*\n1\. A\n2\. B/.test(rem) && /\*From Vidya\*\n1\. C/.test(rem), rem);
    check('…and its template blanks are one line each', !M.buildReminderTemplateParams('Procurement', groups).some(p => /[\n\t]/.test(p)) && M.buildReminderTemplateParams('Procurement', groups, 'Saniel Shah').join('|') === 'Saniel|Procurement team|Priyanka: A, B | Vidya: C');
    check('reminder settings are cleaned: bad values fall back to safe defaults', JSON.stringify(M.normalizeReminder({ enabled: 'yes', time: '25:99', days: [9, -1, 'x'] })) === JSON.stringify({ enabled: false, time: '09:30', days: [1, 2, 3, 4, 5, 6], recipientId: null, lastRunDate: null }));
    check('a good setting is kept', M.normalizeReminder({ enabled: true, time: '14:15', days: [5, 1, 1], recipientId: 'u9', lastRunDate: '2026-10-07' }).days.join() === '1,5' && M.isQuarterHour('14:15') && !M.isQuarterHour('14:20'));

    // ── 2. the permission change ─────────────────────────────────────────────
    console.log('\n2. The one permission change: a team with the switch ON may give tasks to a superuser');
    const db: any = TaskDatabaseService; const acc: any = TaskAccessService; const perm: any = PermissionService;
    const people: Record<string, any> = {
        u1: { id: 'u1', name: 'Priyanka Shah', phone_number: '9000000001', department_id: 'd1', department_name: 'Procurement', role: 'employee', active: true },
        u2: { id: 'u2', name: 'Vidya Nair', phone_number: '9000000002', department_id: 'd1', department_name: 'Procurement', role: 'employee', active: true },
        u7: { id: 'u7', name: 'Neha Joshi', phone_number: '9000000007', department_id: 'd2', department_name: 'Finance', role: 'employee', active: true },
        u9: { id: 'u9', name: 'Saniel Mehta', phone_number: '9000000009', department_id: 'd9', department_name: 'Management', role: 'superuser', active: true },
    };
    const audits: any[] = [];
    db.getEmployeeById = async (id: string) => people[id] || null; db.logAudit = async (a: any) => { audits.push(a); };
    perm.visibleAndAssignable = async (_a: any, c: any[]) => c.filter(e => e.department_id === 'd1'); // team sharing ON for Procurement only
    const realCollab = acc.isSuperuserCollabEnabled.bind(TaskAccessService);
    let collabOn = new Set<string>(['d1']);
    acc.isSuperuserCollabEnabled = async (d: string) => collabOn.has(d);
    const canAssign = async (actor: string, target: string) => { try { await PermissionService.assertCanAssignTask(actor, target); return true; } catch (e) { return e instanceof PermissionDeniedError ? false : Promise.reject(e); } };
    check('Procurement → Saniel (a superuser) is allowed when the switch is ON', await canAssign('u1', 'u9'));
    collabOn = new Set();
    check('…and refused when the switch is OFF (exactly as before)', !(await canAssign('u1', 'u9')));
    collabOn = new Set(['d1']);
    check('the switch opens ONLY the door to a superuser: Procurement → someone in Finance is still refused', !(await canAssign('u1', 'u7')));
    check('Procurement → a teammate still works as before', await canAssign('u1', 'u2'));
    collabOn = new Set(['d2']);
    check('the switch is per department: Finance having it ON does not help Procurement', !(await canAssign('u1', 'u9')));
    collabOn = new Set(['d1']);

    // ── 3. the service ───────────────────────────────────────────────────────
    console.log('\n3. Sending now, scheduling, and what is allowed');
    const mk = (over: any = {}) => {
        const w: any = {
            now: new Date('2026-10-08T05:00:00Z'), // 10:30 IST, a Thursday
            collab: new Set(['d1']), reminders: new Map<string, any>(), locked: new Set<string>(), sendFails: false,
            tasks: [
                { id: 't1', title: 'Approve measurement sheet', status: 'pending', employee_id: 'u9', assigned_by: 'u1', assigned_date: '2026-10-08' },
                { id: 't2', title: 'Sign the AMC', status: 'in_progress', employee_id: 'u9', assigned_by: 'u2', assigned_date: '2026-10-08' },
                { id: 't3', title: 'Budget from Finance', status: 'pending', employee_id: 'u9', assigned_by: 'u7', assigned_date: '2026-10-08' },
                { id: 't4', title: 'Already done thing', status: 'completed', employee_id: 'u9', assigned_by: 'u1', assigned_date: '2026-10-07' },
                { id: 't5', title: 'Single Disc Machine', status: 'pending', employee_id: 'u1', assigned_by: 'u1', assigned_date: '2026-10-08' },
            ], pings: [] as any[], sent: [] as any[], audits: [] as any[], saved: [] as any[], n: 0, ...over,
        };
        const io: any = {
            now: () => w.now,
            getEmployee: async (id: string) => people[id] || null,
            access: async (e: any) => (w.locked.has(e.id) ? { allowed: false, message: 'Not switched on for your team yet.' } : { allowed: true }),
            getCollab: async () => ({ departments: w.collab, reminders: w.reminders }),
            saveReminder: async (d: string, r: any, a: string) => { w.reminders.set(d, r); w.saved.push({ d, r, a }); },
            allEmployees: async () => Object.values(people),
            tasksByIds: async (ids: string[]) => w.tasks.filter((t: any) => ids.includes(t.id)),
            openTasksOf: async (u: string) => w.tasks.filter((t: any) => t.employee_id === u && t.status !== 'completed'),
            insertPing: async (row: any) => { const r = { id: `p${++w.n}`, sent_at: null, error: null, ...row }; w.pings.push(r); return { ...r }; },
            claimDue: async (iso: string) => { const due = w.pings.filter((p: any) => p.status === 'scheduled' && p.send_at <= iso); due.forEach((p: any) => { p.status = 'sending'; }); return due.map((p: any) => ({ ...p })); },
            updatePing: async (id: string, patch: any) => { Object.assign(w.pings.find((p: any) => p.id === id), patch); },
            cancelPing: async (id: string, d: string) => { const p = w.pings.find((x: any) => x.id === id && x.department_id === d && x.status === 'scheduled'); if (p) p.status = 'cancelled'; return !!p; },
            listPings: async (d: string, r: string) => w.pings.filter((p: any) => p.department_id === d && p.recipient_id === r),
            recentlySent: async (ids: string[], since: string) => w.pings.filter((p: any) => p.status === 'sent' && p.sent_at >= since && p.task_ids.some((t: string) => ids.includes(t))),
            listRecentSent: async (r: string, since: string) => w.pings.filter((p: any) => p.recipient_id === r && p.status === 'sent' && p.sent_at >= since),
            send: async (phone: string, text: string, params: any) => { w.sent.push({ phone, text, params }); return !w.sendFails; },
            audit: async (event: string, actor: string | null, details: any) => { w.audits.push({ event, actor, details }); },
        };
        w.io = io;
        return w;
    };
    const expectErr = async (label: string, fn: () => Promise<unknown>, code: string, status?: number) => {
        let e: any = null; try { await fn(); } catch (x) { e = x; }
        check(label, !!e && e.code === code && (status === undefined || e.status === status), e ? `${e.message} (${e.code}/${e.status})` : 'no error');
    };

    let w = mk();
    const panel: any = await P.getPanel('u1', w.io);
    check('the panel shows ONLY the open tasks this team gave him (not Finance\'s, not finished ones)', panel.tasks.map((t: any) => t.id).join() === 't1,t2' && panel.tasks[0].assignerName === 'Priyanka Shah' && panel.recipient.id === 'u9', panel);
    check('…and my own open tasks, to give him one', panel.myOpen.map((t: any) => t.id).join() === 't5');
    w = mk({ collab: new Set() });
    await expectErr('a team whose switch is OFF cannot use any of it', () => P.getPanel('u1', w.io), 'NOT_ENABLED', 403);
    w = mk({ locked: new Set(['u1']) });
    await expectErr('a person locked out of the Task Manager cannot either', () => P.getPanel('u1', w.io), 'LOCKED', 403);

    w = mk();
    let r: any = await P.sendPing('u1', { taskIds: ['t1', 't2'], note: 'Need a decision' }, w.io);
    check('send now → one message to HIS number only, through the approved template path', r.status === 'sent' && w.sent.length === 1 && w.sent[0].phone === '9000000009' && w.sent[0].params.length === 3 && w.sent[0].params[1] === 'Priyanka Shah (Procurement)', w.sent);
    check('the message is exactly what the live preview shows', w.sent[0].text === M.buildPingText({ fromLabel: 'Priyanka Shah', department: 'Procurement', tasks: ['Approve measurement sheet', 'Sign the AMC'], note: 'Need a decision' }));
    check('the reminder is recorded as sent and audited', w.pings[0].status === 'sent' && w.pings[0].sent_at === '2026-10-08T05:00:00.000Z' && w.audits.some((a: any) => a.event === 'task_ping_sent'));
    w = mk();
    await P.sendPing('u1', { taskIds: ['t1'], fromLabel: 'Procurement team' }, w.io);
    check('a typed "from" name is used', w.sent[0].params[1] === 'Procurement team (Procurement)' && /from Procurement team, Procurement/.test(w.sent[0].text));
    w = mk();
    r = await P.sendPing('u1', { taskIds: ['t1'], sendAt: '2026-10-08T09:00:00Z' }, w.io);
    check('a later time → saved as scheduled, NOTHING sent now', r.status === 'scheduled' && w.pings[0].status === 'scheduled' && w.sent.length === 0 && w.audits.some((a: any) => a.event === 'task_ping_scheduled'));
    r = await P.sendPing('u1', { taskIds: ['t2'], sendAt: '2026-10-08T05:00:30Z' }, w.io);
    check('a time within a minute counts as "now"', r.status === 'sent');
    w = mk();
    await expectErr('no task chosen → refused', () => P.sendPing('u1', { taskIds: [] }, w.io), 'NO_TASKS', 400);
    await expectErr('a task that is not his, or not given by this team (Finance\'s) → refused', () => P.sendPing('u1', { taskIds: ['t1', 't3'] }, w.io), 'NOT_TEAM_TASK', 400);
    await expectErr('a finished task → refused', () => P.sendPing('u1', { taskIds: ['t4'] }, w.io), 'NOT_TEAM_TASK', 400);
    await expectErr('one of MY OWN tasks (not given to him) → refused', () => P.sendPing('u1', { taskIds: ['t5'] }, w.io), 'NOT_TEAM_TASK', 400);
    await expectErr('a nonsense time → refused', () => P.sendPing('u1', { taskIds: ['t1'], sendAt: 'tomorrow-ish' }, w.io), 'BAD_TIME', 400);
    await expectErr('more than 30 days ahead → refused', () => P.sendPing('u1', { taskIds: ['t1'], sendAt: '2026-12-31T00:00:00Z' }, w.io), 'TOO_FAR', 400);
    check('…and nothing was sent or stored by any refused request', w.sent.length === 0 && w.pings.length === 0);
    w = mk();
    await P.sendPing('u1', { taskIds: ['t1'] }, w.io);
    w.now = new Date('2026-10-08T05:20:00Z');
    await expectErr('reminding again about the same task within the hour asks first, with how long ago', () => P.sendPing('u2', { taskIds: ['t1'] }, w.io), 'RECENT', 409);
    let msg = ''; try { await P.sendPing('u2', { taskIds: ['t1'] }, w.io); } catch (e: any) { msg = e.message; }
    check('…the message says 20 minutes ago and offers to send anyway', /20 minutes ago\. Send anyway\?/.test(msg), msg);
    r = await P.sendPing('u2', { taskIds: ['t1'], force: true }, w.io);
    check('"send anyway" goes through', r.status === 'sent' && w.sent.length === 2);
    w.now = new Date('2026-10-08T07:00:00Z');
    check('after an hour no warning', (await P.sendPing('u2', { taskIds: ['t1'] }, w.io)).status === 'sent');
    w = mk({ sendFails: true });
    await expectErr('WhatsApp not accepting the message → a clear error, recorded as failed (never "sent")', () => P.sendPing('u1', { taskIds: ['t1'] }, w.io), 'SEND_FAILED', 502);
    check('…the row says failed', w.pings[0].status === 'failed' && w.audits.some((a: any) => a.event === 'task_ping_failed'));
    w = mk(); w.tasks.find((t: any) => t.id === 't1').status = 'completed';
    const stored = await w.io.insertPing({ department_id: 'd1', created_by: 'u1', recipient_id: 'u9', from_label: 'Priyanka', note: null, task_ids: ['t1'], send_at: w.now.toISOString(), status: 'scheduled' });
    check('a reminder whose tasks were all finished meanwhile is NOT sent (recorded as failed with the reason)', !(await P.deliver(stored, w.io)).ok && w.sent.length === 0 && /already been completed/.test(w.pings[0].error));
    w = mk(); people.u9.phone_number = '';
    const noPhone = await w.io.insertPing({ department_id: 'd1', created_by: 'u1', recipient_id: 'u9', from_label: 'P', note: null, task_ids: ['t1'], send_at: w.now.toISOString(), status: 'scheduled' });
    check('a recipient with no phone number → failed with a plain reason', !(await P.deliver(noPhone, w.io)).ok && /no phone number/.test(w.pings[0].error)); people.u9.phone_number = '9000000009';
    w = mk(); w.tasks.push({ id: 't6', title: 'Second', status: 'pending', employee_id: 'u9', assigned_by: 'u1', assigned_date: '2026-10-08' });
    const half = await w.io.insertPing({ department_id: 'd1', created_by: 'u1', recipient_id: 'u9', from_label: 'P', note: null, task_ids: ['t1', 't6'], send_at: w.now.toISOString(), status: 'scheduled' });
    w.tasks.find((t: any) => t.id === 't1').status = 'completed';
    await P.deliver(half, w.io);
    check('if one of two was finished meanwhile, only the still-open one is listed', /1\. Second/.test(w.sent[0].text) && !/Approve measurement/.test(w.sent[0].text));

    console.log('\n4. Cancelling and the team\'s regular reminder');
    w = mk();
    r = await P.sendPing('u1', { taskIds: ['t1'], sendAt: '2026-10-08T09:00:00Z' }, w.io);
    await P.cancelPing('u2', r.pingId, w.io);
    check('anyone on the team can cancel a scheduled reminder; it is audited', w.pings[0].status === 'cancelled' && w.audits.some((a: any) => a.event === 'task_ping_cancelled'));
    await expectErr('cancelling something already cancelled or sent is refused', () => P.cancelPing('u1', r.pingId, w.io), 'NOT_SCHEDULED', 409);
    w = mk();
    const saved = await P.saveTeamReminder('u1', { enabled: true, time: '09:30', days: [5, 1, 1, 2] }, w.io);
    check('saving the shared reminder: sorted days, the one superuser as recipient, who saved it is recorded', saved.days.join() === '1,2,5' && saved.recipientId === 'u9' && w.saved[0].d === 'd1' && w.saved[0].a === 'Priyanka Shah');
    w.reminders.set('d1', { ...saved, lastRunDate: '2026-10-07' });
    check('saving again keeps the "last sent" date (it must not trigger a repeat)', (await P.saveTeamReminder('u2', { enabled: true, time: '10:00', days: [1] }, w.io)).lastRunDate === '2026-10-07');
    await expectErr('a time that is not on a 15-minute step is refused', () => P.saveTeamReminder('u1', { enabled: true, time: '09:20', days: [1] }, w.io), 'BAD_TIME', 400);
    await expectErr('no days → refused', () => P.saveTeamReminder('u1', { enabled: true, time: '09:30', days: [] }, w.io), 'NO_DAYS', 400);

    console.log('\n5. The scheduler (the existing 15-minute cron)');
    w = mk({ collab: new Set() });
    let d = await P.runDue(w.io);
    check('no team has it switched on (the default) → does NOTHING: no claim, no message', d.sent === 0 && w.sent.length === 0 && w.audits.length === 0);
    check('IST maths: 05:00 UTC Thursday = 10:30 IST, day 4', JSON.stringify(P.istParts(new Date('2026-10-08T05:00:00Z'))) === '{"dayOfWeek":4,"minutes":630,"todayIST":"2026-10-08"}' && P.istParts(new Date('2026-10-08T19:00:00Z')).todayIST === '2026-10-09');
    w = mk();
    await P.sendPing('u1', { taskIds: ['t1'], sendAt: '2026-10-08T05:30:00Z' }, w.io);
    await P.sendPing('u1', { taskIds: ['t2'], sendAt: '2026-10-08T09:00:00Z' }, w.io);
    d = await P.runDue(w.io);
    check('a scheduled reminder that is not due yet is left alone', d.sent === 0 && w.sent.length === 0 && w.pings.every((p: any) => p.status === 'scheduled'));
    w.now = new Date('2026-10-08T05:30:00Z');
    d = await P.runDue(w.io);
    check('when its time comes it is sent, once', d.sent === 1 && w.sent.length === 1 && w.pings[0].status === 'sent' && w.pings[1].status === 'scheduled');
    d = await P.runDue(w.io);
    check('running the scheduler again (or two runs at the same moment) never sends it twice', d.sent === 0 && w.sent.length === 1);
    w = mk(); await P.sendPing('u1', { taskIds: ['t1'], sendAt: '2026-10-08T05:30:00Z' }, w.io);
    w.collab = new Set(['d1']); w.now = new Date('2026-10-08T05:30:00Z'); w.collab = new Set(['d9']);
    d = await P.runDue(w.io);
    check('if the team\'s switch was turned OFF meanwhile, the scheduled reminder is cancelled, not sent', w.sent.length === 0 && w.pings[0].status === 'cancelled' && d.skipped === 1);

    w = mk(); w.reminders.set('d1', { enabled: true, time: '09:30', days: [1, 2, 3, 4, 5, 6], recipientId: 'u9', lastRunDate: null });
    d = await P.runDue(w.io);
    check('regular reminder due (10:30, set for 09:30, a Thursday) → ONE message, his pending work grouped by who gave it', d.reminders === 1 && w.sent.length === 1 && /\*From Priyanka Shah\*\n1\. Approve measurement sheet/.test(w.sent[0].text) && /\*From Vidya Nair\*\n1\. Sign the AMC/.test(w.sent[0].text) && !/Budget from Finance/.test(w.sent[0].text) && !/Already done/.test(w.sent[0].text), w.sent[0]?.text);
    check('…sent to HIS number only, and today is marked as done', w.sent[0].phone === '9000000009' && w.reminders.get('d1').lastRunDate === '2026-10-08');
    d = await P.runDue(w.io);
    check('…and the next 15-minute run does not repeat it', d.reminders === 0 && w.sent.length === 1);
    const regular = (over: any, nowIso = '2026-10-08T05:00:00Z') => { const x = mk({ now: new Date(nowIso) }); x.reminders.set('d1', { enabled: true, time: '09:30', days: [1, 2, 3, 4, 5, 6], recipientId: 'u9', lastRunDate: null, ...over }); return x; };
    let x = regular({}, '2026-10-08T03:00:00Z'); await P.runDue(x.io);
    check('before its time (08:30 IST) → waits', x.sent.length === 0);
    x = regular({ days: [1, 2, 3] }); await P.runDue(x.io);
    check('not a scheduled day (Thursday not in the list) → nothing', x.sent.length === 0);
    x = regular({ enabled: false }); await P.runDue(x.io);
    check('switched off → nothing', x.sent.length === 0);
    x = regular({}); x.tasks.forEach((t: any) => { if (t.employee_id === 'u9') t.status = 'completed'; }); d = await P.runDue(x.io);
    check('he has nothing pending from the team → no message, but today is still marked (no endless re-checking)', x.sent.length === 0 && d.skipped === 1 && x.reminders.get('d1').lastRunDate === '2026-10-08');
    x = regular({}); x.sendFails = true; d = await P.runDue(x.io);
    check('WhatsApp refusing the message → counted as failed, but NOT retried every 15 minutes', d.failed === 1 && x.reminders.get('d1').lastRunDate === '2026-10-08');
    x = regular({}); x.io.openTasksOf = async () => { throw new Error('db down'); };
    let threw = false; try { d = await P.runDue(x.io); } catch { threw = true; }
    check('a database problem inside the scheduler never escapes (the cron\'s other work is unaffected)', !threw && d.failed === 1);
    x = regular({}); x.io.getCollab = async () => { throw new Error('db down'); };
    threw = false; try { await P.runDue(x.io); } catch { threw = true; }
    check('…not even when the settings cannot be read', !threw);
    x = regular({}); x.locked.add('u9'); await P.runDue(x.io);
    check('a recipient who is not switched on for the Task Manager is not messaged', x.sent.length === 0);

    console.log('\n6. Telling the right people what his reply MEANT');
    const facts = R.relayFacts({ assignerName: 'Priyanka Shah', actorName: 'Saniel Mehta', state: 'working', titles: ['Approve measurement sheet'], note: null })!;
    check('the instruction asks for a summary in the AI\'s own words, never a quote, and never he/she', /own words as a summary of what was meant, never as a quote/.test(facts.describe) && /never he or she/.test(facts.describe));
    check('the facts carry only titles and names — no message text exists at this point to leak', Object.keys(facts.values).join() === 'tasks' && facts.required.join() === 'tasks');
    check('each state has its own meaning ("working", "progress", "stuck", "finished"); an unclear "other" produces nothing', /is working on/.test(facts.fallback)
        && /has made progress on/.test(R.relayFacts({ assignerName: 'A', actorName: 'S', state: 'partly_done', titles: ['t'], note: null })!.fallback)
        && /is stuck on/.test(R.relayFacts({ assignerName: 'A', actorName: 'S', state: 'blocked', titles: ['t'], note: null })!.fallback)
        && /has finished/.test(R.relayFacts({ assignerName: 'A', actorName: 'S', state: 'done_all', titles: ['t'], note: null })!.fallback)
        && R.relayFacts({ assignerName: 'A', actorName: 'S', state: 'other', titles: ['t'], note: null }) === null);
    check('the fallback sentence carries a note in brackets, and uses names not pronouns', /\(needs two more days\)/.test(R.relayFacts({ assignerName: 'A', actorName: 'Saniel', state: 'working', titles: ['t'], note: 'needs two more days' })!.fallback) && !/\b(he|she|his|her)\b/i.test(facts.fallback));

    const relayWorld = (over: any = {}) => {
        const rw: any = { composed: [] as any[], sent: [] as any[], audits: [] as any[], noPhone: new Set<string>(), sendFails: new Set<string>() };
        rw.io = {
            tasksByIds: async (ids: string[]) => [
                { id: 'p1', title: 'Approve measurement sheet', assigned_by: 'u1' }, { id: 'p2', title: 'Sign the AMC', assigned_by: 'u2' },
                { id: 'p3', title: 'Second for Priyanka', assigned_by: 'u1' }, { id: 'p4', title: 'He gave this one himself', assigned_by: 'u9' },
            ].filter(t => ids.includes(t.id)),
            getPerson: async (id: string) => (people[id] ? { id, name: people[id].name, phone_number: rw.noPhone.has(id) ? '' : people[id].phone_number, department_name: people[id].department_name, active: true } : null),
            compose: async (f: any, known: Set<string>) => { rw.composed.push({ f, known }); return f.fallback; },
            send: async (phone: string, text: string, from: string) => { rw.sent.push({ phone, text, from }); return ![...rw.sendFails].some(id => people[id].phone_number === phone); },
            audit: async (d: any) => { rw.audits.push(d); }, ...over,
        };
        return rw;
    };
    const saniel = { id: 'u9', name: 'Saniel Mehta', phone_number: '9000000009', department_name: 'Management', active: true };
    let rw = relayWorld();
    let rr = await R.relayToAssigners({ actor: saniel, taskIds: ['p1', 'p2', 'p3'], state: 'working', note: null }, rw.io);
    check('each person who gave him a task hears about THEIR tasks only (Priyanka: 2, Vidya: 1)', rr.told.sort().join() === 'Priyanka Shah,Vidya Nair' && rw.sent.length === 2
        && rw.sent.find((s: any) => s.phone === '9000000001').text.includes('Second for Priyanka') && !rw.sent.find((s: any) => s.phone === '9000000001').text.includes('Sign the AMC')
        && rw.sent.find((s: any) => s.phone === '9000000002').text.includes('Sign the AMC') && !rw.sent.find((s: any) => s.phone === '9000000002').text.includes('Approve measurement'), rw.sent);
    check('the sender line names him and his department', rw.sent[0].from === 'Saniel Mehta (Management)');
    check('each relay is audited', rw.audits.length === 2 && rw.audits.every((a: any) => a.actorId === 'u9' && a.delivered === true));
    rw = relayWorld(); rr = await R.relayToAssigners({ actor: saniel, taskIds: ['p4'], state: 'working', note: null }, rw.io);
    check('a task he assigned to himself tells nobody', rr.told.length === 0 && rw.sent.length === 0);
    rw = relayWorld(); rw.noPhone.add('u2'); rr = await R.relayToAssigners({ actor: saniel, taskIds: ['p1', 'p2'], state: 'blocked', note: null }, rw.io);
    check('someone with no phone → reported as NOT reached (never silently dropped); the other still hears', rr.told.join() === 'Priyanka Shah' && rr.couldNot.join() === 'Vidya Nair');
    rw = relayWorld(); rw.sendFails.add('u1'); rr = await R.relayToAssigners({ actor: saniel, taskIds: ['p1'], state: 'done_all', note: null }, rw.io);
    check('WhatsApp refusing one relay → reported as not reached', rr.couldNot.join() === 'Priyanka Shah' && rr.told.length === 0);
    rw = relayWorld(); rw.io.send = async () => { throw new Error('boom'); }; rr = await R.relayToAssigners({ actor: saniel, taskIds: ['p1'], state: 'working', note: null }, rw.io);
    check('a crash while sending → reported, no exception', rr.couldNot.join() === 'Priyanka Shah');
    rw = relayWorld(); rr = await R.relayToAssigners({ actor: saniel, taskIds: ['p1'], state: 'other', note: null }, rw.io);
    check('an unclear state relays nothing', rr.told.length === 0 && rw.sent.length === 0);
    rw = relayWorld(); await R.relayToAssigners({ actor: saniel, taskIds: ['p1', 'p2'], state: 'working', note: 'two more days needed', titles: { p1: 'Approve measurement sheet (from Priyanka Shah)' } }, rw.io);
    check('the AI may only use words it was given (names, titles, the note) — and the original message is never passed in', rw.composed[0].known.has('priyanka') && rw.composed[0].known.has('measurement') && rw.composed[0].known.has('days') && rw.composed.every((c: any) => !('message' in c.f)));

    console.log('\n7. The executor: noting status, then telling people (and saying honestly who was reached)');
    const sCtx = { ...world('default'), sender: { id: 'u9', name: 'Saniel Mehta', department: 'Management', role: 'superuser' as const } };
    const exec: any[] = []; const relays: any[] = []; let relayResult: any = { told: ['Priyanka Shah'], couldNot: [] };
    const xio: any = { setStatus: async (_a: string, id: string, s: string) => { exec.push([id, s]); }, assign: async () => undefined, handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '', relay: async (a: string, i: any) => { relays.push([a, i]); return relayResult; } };
    let er: any = await X.executeAction({ type: 'progress_update', state: 'working', taskIds: ['p1'], note: null }, sCtx, xio, { relay: true, titles: { p1: 'Approve measurement sheet' } });
    check('"working on it" in reply to a request → task set to in progress, the person is told, and the reply says so', JSON.stringify(exec) === '[["p1","in_progress"]]' && relays.length === 1 && relays[0][1].state === 'working' && /I've let Priyanka Shah know\./.test(er.summary) && /Approve measurement sheet/.test(er.values.details), er);
    check('…the relay receives the MEANING (state, tasks, note) and nothing else', JSON.stringify(Object.keys(relays[0][1]).sort()) === '["note","state","taskIds","titles"]');
    relayResult = { told: ['Priyanka Shah', 'Vidya Nair'], couldNot: [] };
    er = await X.executeAction({ type: 'progress_update', state: 'working', taskIds: ['p1', 'p2'], note: null }, sCtx, xio, { relay: true });
    check('two people told → "Priyanka Shah and Vidya Nair"', /I've let Priyanka Shah and Vidya Nair know\./.test(er.summary));
    relayResult = { told: ['Priyanka Shah'], couldNot: ['Vidya Nair'] };
    er = await X.executeAction({ type: 'progress_update', state: 'blocked', taskIds: ['p1', 'p2'], note: null }, sCtx, xio, { relay: true });
    check('one not reachable → the reply says exactly that, never claiming everyone was told', /I've let Priyanka Shah know\. I couldn't reach Vidya Nair just now\./.test(er.summary), er.summary);
    relayResult = { told: [], couldNot: ['Priyanka Shah'] };
    er = await X.executeAction({ type: 'progress_update', state: 'working', taskIds: ['p1'], note: null }, sCtx, xio, { relay: true });
    check('nobody reached → only the honest "couldn\'t reach" line', /I couldn't reach Priyanka Shah just now\./.test(er.summary) && !/I've let/.test(er.summary));
    const before = relays.length;
    er = await X.executeAction({ type: 'progress_update', state: 'working', taskIds: ['p1'], note: null }, sCtx, xio, { relay: false });
    check('NOT a reply to a request (an ordinary status note) → nobody is told', relays.length === before);
    exec.length = 0;
    relayResult = { told: ['Priyanka Shah'], couldNot: [] };
    er = await X.executeAction({ type: 'progress_update', state: 'done_all', taskIds: ['p1', 'p2'], note: null }, sCtx, xio, { relay: true });
    check('"done" → the tasks are completed, then the people are told it was finished', JSON.stringify(exec) === '[["p1","completed"],["p2","completed"]]' && relays[relays.length - 1][1].state === 'done_all' && /I've let Priyanka Shah know/.test(er.summary), er.summary);
    xio.relay = async () => { throw new Error('relay crashed'); };
    er = await X.executeAction({ type: 'progress_update', state: 'working', taskIds: ['p1'], note: null }, sCtx, xio, { relay: true });
    check('a crash in the relay never undoes the status change, and is reported as not reached', /Noted 1 task as in progress/.test(er.summary) && !/I've let/.test(er.summary));

    console.log('\n8. Deciding a reply when SEVERAL people are waiting');
    const ping2: any = { kind: 'ping_reply', assigner: 'Priyanka Shah and Vidya Nair', taskIds: ['p1', 'p2', 'p3'], taskTitles: ['A (from Priyanka Shah)', 'B (from Vidya Nair)', 'C (from Priyanka Shah)'], assigners: ['Priyanka Shah', 'Vidya Nair'] };
    const interp = (slots: any, over: any = {}) => ({ intent: 'progress_update', confidence: 0.95, language: 'en', slots: { intent: 'progress_update', ...slots }, ambiguities: [], clarifyQuestion: null, summary: '', grounded: true, ...over }) as any;
    const dec = (i: any, pending: any) => tasksDomain.decide(i, { ...world('default'), pending }, { confirmProgressUpdates: false }) as any;
    let dd = dec(interp({ state: 'working', which: { all: false, numbers: [], hints: [] }, note: null }), ping2);
    check('"working on it" with two people waiting → ASKS who it is for, with a choice per person and "All of them"', dd.outcome === 'CLARIFY' && dd.options.join('|') === "Priyanka Shah's tasks|Vidya Nair's tasks|All of them", dd);
    dd = dec(interp({ state: 'working', which: { all: true, numbers: [], hints: [] }, note: null }), ping2);
    check('"working on all of them" → every task, no question', dd.outcome === 'ACT' && dd.action.taskIds.join() === 'p1,p2,p3');
    dd = dec(interp({ state: 'working', which: { all: false, numbers: [2], hints: [] }, note: null }), ping2);
    check('"working on 2" → just that one task', dd.outcome === 'ACT' && dd.action.taskIds.join() === 'p2');
    dd = dec(interp({ state: 'done_all', which: { all: false, numbers: [], hints: [] }, note: null }), ping2);
    check('"done all" is explicit → every task (still confirmed first)', dd.outcome === 'CONFIRM' && dd.action.taskIds.join() === 'p1,p2,p3');
    dd = dec(interp({ state: 'done_some', which: { all: false, numbers: [], hints: [] }, note: null }), ping2);
    check('"done some" with no task named → asks which, listing the request\'s own tasks', dd.outcome === 'CLARIFY' && dd.options.length === 3);
    dd = dec(interp({ state: 'working', which: { all: false, numbers: [], hints: [] }, note: null }), { ...ping2, assigners: undefined, assigner: 'Priyanka Shah' });
    check('only ONE person waiting → no question, goes straight through for all of that request', dd.outcome === 'ACT' && dd.action.taskIds.join() === 'p1,p2,p3');

    // ── 9. Saniel replies on WhatsApp (the whole conversation) ───────────────
    console.log('\n9. Saniel replies on WhatsApp');
    const sPhone = '919000000009';
    const body = (t: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: sPhone, id, message_type: 'text', text: { body: t } }] } });
    const interps = (msg: string): any => {
        const has = (s: string) => msg.toLowerCase().includes(s);
        const mkI = (intent: string, slots: any, summary: string) => ({ intent, slots, summary });
        if (has('specifically: vidya')) return mkI('progress_update', { state: 'working', which: { all: false, numbers: [2], hints: [] }, note: null }, 'Working on Vidya\'s task');
        if (has('done all')) return mkI('progress_update', { state: 'done_all', which: { all: false, numbers: [], hints: [] }, note: null }, 'Finished everything');
        if (has('stuck')) return mkI('progress_update', { state: 'blocked', which: { all: false, numbers: [], hints: [] }, note: 'waiting for a vendor' }, 'Stuck, waiting for a vendor');
        if (has('hmm')) return mkI('unknown', {}, 'Unclear message');
        if (has('working on it')) return mkI('progress_update', { state: 'working', which: { all: false, numbers: [], hints: [] }, note: null }, 'Working on the tasks');
        return mkI('smalltalk', {}, 'Said hello');
    };
    const replyFor = (u: any) => { const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join(' '); return u.mustEndWithQuestion ? `Quick check, is this right? ${need}` : `Okay, here you go: ${need}`; };
    const waiting = (many: boolean) => many
        ? { pending: ping2, titles: { p1: 'A (from Priyanka Shah)', p2: 'B (from Vidya Nair)', p3: 'C (from Priyanka Shah)' } }
        : { pending: { kind: 'ping_reply', assigner: 'Priyanka Shah', taskIds: ['p1', 'p3'], taskTitles: ['A', 'C'] }, titles: { p1: 'A', p3: 'C' } };
    const mkLive = (many: boolean, over: any = {}) => {
        const lw: any = { state: null as any, sent: [] as string[], audits: [] as any[], exec: [] as any[], relays: [] as any[], calls: 0, many, noPings: false, ...over };
        const llm = { complete: async (req: any) => {
            const u = JSON.parse(req.user); lw.calls++;
            if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: replyFor(u) }), tokensIn: 1, tokensOut: 1 };
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...interps(u.message) }), tokensIn: 1, tokensOut: 1 };
        } };
        lw.io = {
            getSmartChatDepartments: async () => new Set(['d9']), getConfig: async () => ({ enabled: true, employees: [{ name: 'S', phone: '9000000009' }] }),
            getEmployee: async () => people.u9, checkAccess: async () => ({ allowed: true }), facilityActive: async () => false,
            getState: async () => lw.state, setState: async (_p: string, s: any) => { lw.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { if (lw.state?.type === L.LIVE_STATE_TYPE) lw.state = null; },
            openPingPending: async () => (lw.noPings ? null : waiting(lw.many)),
            buildContext: async (_e: any, _p: string, opts: any) => ({ ...world('default'), sender: { id: 'u9', name: 'Saniel Mehta', department: 'Management', role: 'superuser' }, tasks: [], pending: opts.pending, recent: opts.recent }),
            brain: { llm },
            exec: {
                setStatus: async (a: string, id: string, s: string) => { lw.exec.push(['setStatus', id, s]); }, assign: async () => undefined, handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '',
                relay: async (_a: string, i: any) => { lw.relays.push(i); return { told: many ? ['Priyanka Shah', 'Vidya Nair'] : ['Priyanka Shah'], couldNot: [] }; },
            },
            reply: async (_p: string, t: string) => { lw.sent.push(t); }, audit: async (d: any) => { lw.audits.push(d); }, seenBefore: () => false, markSeen: () => undefined,
        };
        return lw;
    };
    const turn = async (lw: any, text: string, id: string) => { const c = await L.claimSmartChat(body(text, id), lw.io); if (c.background) await c.background(); return c; };

    let lw = mkLive(false);
    await turn(lw, 'i am working on it', 's1');
    check('one person waiting: "working on it" → the tasks go to in progress, Priyanka is told what it MEANT, and Saniel is told it went through', JSON.stringify(lw.exec) === '[["setStatus","p1","in_progress"],["setStatus","p3","in_progress"]]' && lw.relays.length === 1 && lw.relays[0].taskIds.join() === 'p1,p3' && lw.relays[0].state === 'working', { exec: lw.exec, relays: lw.relays });
    check('…his confirmation names who was told', /I've let Priyanka Shah know\./.test(lw.audits[0].executed) && lw.sent.length === 1 && /A/.test(lw.sent[0]), lw.audits[0]);
    check('PRIVACY: the relay got only the meaning — his own words are nowhere in what was passed on, stored or logged', !JSON.stringify([lw.relays, lw.state, lw.audits]).toLowerCase().includes('i am working on it'));
    lw = mkLive(false);
    await turn(lw, 'stuck, waiting on the vendor', 's2');
    check('"stuck" → noted, nothing changes status, Priyanka told he is stuck (with the paraphrased reason), reply confirms', lw.exec.length === 0 && lw.relays[0].state === 'blocked' && lw.relays[0].note === 'waiting for a vendor' && /I've let Priyanka Shah know/.test(lw.audits[0].executed));
    lw = mkLive(false);
    await turn(lw, 'done all', 's3');
    check('"done all" is proposed first: nothing completed, nobody told yet', lw.exec.length === 0 && lw.relays.length === 0 && lw.state.data.pending?.kind === 'confirm' && lw.state.data.relay === true);
    await turn(lw, 'yes', 's4');
    check('after "yes": both completed, then the person is told it is finished', JSON.stringify(lw.exec) === '[["setStatus","p1","completed"],["setStatus","p3","completed"]]' && lw.relays[0].state === 'done_all', { exec: lw.exec, relays: lw.relays });
    lw = mkLive(false);
    await turn(lw, 'hmm ok', 's5');
    check('an unclear message → a question back; nothing changed, nobody told', lw.exec.length === 0 && lw.relays.length === 0 && /\?/.test(lw.sent[0]));
    lw = mkLive(false, { noPings: true });
    await turn(lw, 'working on it', 's6');
    check('with NO request waiting, "working on it" is not a reply to anyone: nobody is told', lw.relays.length === 0);

    lw = mkLive(true);
    await turn(lw, 'working on it', 's7');
    check('TWO people waiting: "working on it" → asked who it is for, with both names and "All of them"; nothing done, nobody told', lw.exec.length === 0 && lw.relays.length === 0 && /Priyanka Shah's tasks/.test(lw.sent[0]) && /All of them/.test(lw.sent[0]) && lw.state.data.pending?.kind === 'pick' && lw.state.data.relay === true, lw.sent[0]);
    await turn(lw, '2', 's8');
    check('"2" (Vidya\'s) → only Vidya\'s task goes in progress, and only Vidya is told', JSON.stringify(lw.exec) === '[["setStatus","p2","in_progress"]]' && lw.relays.length === 1 && lw.relays[0].taskIds.join() === 'p2', { exec: lw.exec, relays: lw.relays });
    lw = mkLive(true);
    await turn(lw, 'done all', 's9'); await turn(lw, 'yes', 's10');
    check('"done all" with two people waiting → everything completed and BOTH hear about it (no question: "all" is explicit)', lw.exec.length === 3 && lw.relays[0].taskIds.length === 3);

    const someoneElse = mkLive(false);
    someoneElse.io.getEmployee = async () => people.u1; someoneElse.io.getSmartChatDepartments = async () => new Set(['d1']);
    let asked = 0; someoneElse.io.openPingPending = async () => { asked++; return waiting(false); };
    await turn(someoneElse, 'working on it', 's11');
    check('a NON-superuser is never matched to a reminder (it is only looked up for a superuser)', asked === 0);

    // ── 10. wiring ───────────────────────────────────────────────────────────
    console.log('\n10. Wiring (source checks)');
    const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
    const route = read('app/api/task-manager/superuser-pings/route.ts');
    check('the pings route takes the actor from the login session; the body can never name one', /SuperuserPingService\.send\(userId,/.test(route) && /SuperuserPingService\.cancel\(userId,/.test(route) && !/body\.(actorId|actor|userId|createdBy)\b/.test(route));
    const cron = read('app/api/cron/task-manager/route.ts');
    check('the cron runs the scheduler first, only in "auto" and never in a dry run, before the existing notification rules', /if \(action === 'auto' && !dryRun\) await SuperuserPingService\.runDue\(\);/.test(cron) && cron.indexOf('runDue()') < cron.indexOf("if (action === 'daily_tasks')"));
    const sql = read('supabase/migrations/20261007000006_task_manager_superuser_pings.sql').split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    check('the migration is ADDITIVE: two new columns with safe defaults and one new table; nothing destructive', /ADD COLUMN IF NOT EXISTS superuser_collab_enabled BOOLEAN NOT NULL DEFAULT false/.test(sql) && /ADD COLUMN IF NOT EXISTS superuser_reminder JSONB/.test(sql) && /CREATE TABLE IF NOT EXISTS public\.task_pings/.test(sql) && !/\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/i.test(sql.replace(/ON DELETE CASCADE/g, '')));
    const panelSrc = read('frontend/components/procurement/tasks/SuperuserPanel.tsx');
    check('the live preview uses the SAME function the server sends with', /import \{ buildPingText \} from '@\/task-manager\/pingMessage'/.test(panelSrc) && /deliver/.test(read('task-manager/SuperuserPingService.ts')) && /buildPingText\(input\)/.test(read('task-manager/SuperuserPingService.ts')));
    check('the view offers send now, schedule in 15-minute steps, cancel, and the shared regular reminder', /Send now/.test(panelSrc) && /step=\{900\}/.test(panelSrc) && /Cancel/.test(panelSrc) && /Regular reminders/.test(panelSrc));
    const tab = read('frontend/components/procurement/ProcurementTasksTab.tsx');
    check('the Tasks tab shows the view only for a team whose switch is ON and when there is someone to work with', /const collab = ok\.superuserCollab\?\.enabled && ok\.superuserCollab\.superusers\.length/.test(tab) && /\.\.\.\(collab \? \[\{ id: 'superuser' as View/.test(tab));
    const panelUi = read('frontend/components/task-manager/TaskAccessPanel.tsx');
    check('the Control Center has the per-department switch with its SQL-file banner', /Send tasks to a superuser: \{d\.superuserCollabEnabled/.test(panelUi) && /action: 'set_superuser_collab', departmentId/.test(panelUi) && /20261007000006_task_manager_superuser_pings\.sql/.test(panelUi));
    const permSrc = read('task-manager/PermissionService.ts');
    check('the permission change is exactly one guarded branch (superuser target + switch ON)', /target\.role === 'superuser' && actor\.department_id && await TaskAccessService\.isSuperuserCollabEnabled\(actor\.department_id\)/.test(permSrc));
    const relaySrc = read('task-manager/brain/relay.ts');
    check('the relay module never receives the person\'s message (its inputs are state, tasks and a paraphrased note)', !/message|text:/.test(relaySrc.split('export interface RelayIO')[0].replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/userMessage/g, '')) || /input: \{ actor: RelayPerson; taskIds: string\[\]; state: ProgressState; note: string \| null/.test(relaySrc));

    console.log('\n11. The switch for this permission');
    const audits3: any[] = []; db.logAudit = async (a: any) => { audits3.push(a); }; db.getDepartmentById = async (id: string) => (id === 'd1' ? { id, name: 'Procurement' } : null);
    acc.isSuperuserCollabEnabled = realCollab;
    (supabaseAdmin as any).from = () => ({ select: async () => ({ data: [{ department_id: 'd1', superuser_collab_enabled: true, superuser_reminder: { enabled: true, time: '09:30', days: [1], recipientId: 'u9' } }, { department_id: 'd2', superuser_collab_enabled: false, superuser_reminder: null }], error: null }) });
    let g = await TaskAccessService.getSuperuserCollab();
    check('only departments explicitly ON are returned, with their reminder schedule', g.departments.size === 1 && g.departments.has('d1') && g.reminders.get('d1')!.time === '09:30' && !g.columnMissing);
    (supabaseAdmin as any).from = () => ({ select: async () => ({ data: null, error: { code: '42703', message: 'column does not exist' } }) });
    g = await TaskAccessService.getSuperuserCollab();
    check('migration not run → nobody has it, flagged (FAIL CLOSED), so the permission is never granted by accident', g.departments.size === 0 && g.columnMissing === true && (await TaskAccessService.isSuperuserCollabEnabled('d1')) === false);
    (supabaseAdmin as any).from = () => ({ select: async () => { throw new Error('down'); } });
    check('database unreadable → nobody has it', (await TaskAccessService.getSuperuserCollab()).departments.size === 0);
    acc.getSnapshot = async () => ({ provisioned: true, readable: true, departmentEnabled: new Map(), onboarded: new Map() });
    let upserted: any = null;
    (supabaseAdmin as any).from = () => ({ upsert: async (p: any, o: any) => { upserted = { p, o }; return { error: null }; } });
    await TaskAccessService.setSuperuserCollabEnabled('d1', true, 'Admin A');
    check('switching ON writes ONLY its own column, and records who did it', upserted.p.superuser_collab_enabled === true && !('smart_chat_enabled' in upserted.p) && !('superuser_reminder' in upserted.p) && audits3[0].event_type === 'task_access_superuser_collab_updated' && audits3[0].details.actor === 'Admin A');
    await TaskAccessService.saveSuperuserReminder('d1', { enabled: true, time: '10:00', days: [1], recipientId: 'u9', lastRunDate: null }, 'Priyanka');
    check('saving the reminder writes ONLY the reminder column', upserted.p.superuser_reminder.time === '10:00' && !('superuser_collab_enabled' in upserted.p));
    check('nothing in this whole test touched the network', net.length === 0, net);

    console.log(failures === 0 ? '\n🎉 PHASE 5 (WORKING WITH A SUPERUSER) TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
