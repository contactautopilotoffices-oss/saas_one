/**
 * Phase 1 — handing a task to a teammate (100% OFFLINE: fake database, fake permission/access checks, and a
 * RECORDER in place of WhatsApp. Nothing real is read, written or sent.)
 * Run: npx tsx task-manager/tests/test_handover_phase1.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
process.env.AISENSY_PROJECT_ID = 'fake-project';
process.env.AISENSY_PROJECT_API_KEY = 'fake-password';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const networkCalls: string[] = [];
    (globalThis as any).fetch = async (url: any) => { networkCalls.push(String(url)); throw new Error('network must not be used in this test'); };

    const { WorkspaceService, WorkspaceError, canHandOverTask } = await import('../WorkspaceService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { PermissionService, PermissionDeniedError } = await import('../PermissionService');
    const { TaskMessagingService } = await import('../TaskMessagingService');
    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');

    // ── The world ────────────────────────────────────────────────────────────
    const people: Record<string, any> = {
        u1: { id: 'u1', name: 'Priyanka', phone_number: '9000000001', department_id: 'd1', department_name: 'Procurement', role: 'employee', active: true },
        u2: { id: 'u2', name: 'Vidya', phone_number: '9000000002', department_id: 'd1', department_name: 'Procurement', role: 'employee', active: true },
        u3: { id: 'u3', name: 'Nophone', phone_number: '', department_id: 'd1', department_name: 'Procurement', role: 'employee', active: true },
        u4: { id: 'u4', name: 'Outsider', phone_number: '9000000004', department_id: 'd2', department_name: 'Finance', role: 'employee', active: true },
        u5: { id: 'u5', name: 'Locked', phone_number: '9000000005', department_id: 'd1', department_name: 'Procurement', role: 'employee', active: true },
        u9: { id: 'u9', name: 'Saniel', phone_number: '9000000009', department_id: 'd9', department_name: 'Management', role: 'superuser', active: true },
    };
    const store: any = { rows: [], lastUpdate: null, updateError: null, onBeforeUpdate: null };
    const sent: any[] = []; const audits: any[] = [];
    const forbidden = new Set<string>(['u4']);

    const resetWorld = () => {
        store.rows = [
            { id: 't-todo', employee_id: 'u1', title: 'Single Disc Machine', description: 'Site: SS Plaza\nRemark: Need to order', assigned_date: '2026-10-08', status: 'pending', assigned_by: 'u9' },
            { id: 't-doing', employee_id: 'u1', title: 'Kone Lift AMC Renewal', description: null, assigned_date: '2026-10-08', status: 'in_progress', assigned_by: 'u9' },
            { id: 't-done', employee_id: 'u1', title: 'Old finished thing', description: null, assigned_date: '2026-10-08', status: 'completed', assigned_by: 'u9' },
            { id: 't-vidya', employee_id: 'u2', title: 'Vidya own task', description: null, assigned_date: '2026-10-08', status: 'pending', assigned_by: 'u2' },
            { id: 't-multi', employee_id: 'u1', title: 'Line one\nline two   with   spaces', description: 'x'.repeat(995), assigned_date: '2026-10-08', status: 'pending', assigned_by: 'u1' },
        ];
        store.lastUpdate = null; store.updateError = null; store.onBeforeUpdate = null;
        sent.length = 0; audits.length = 0; networkCalls.length = 0;
    };

    (supabaseAdmin as any).from = (table: string) => {
        if (table !== 'task_assignments') throw new Error(`unexpected table ${table}`);
        return {
            select: () => ({ eq: (_c: string, v: any) => ({ maybeSingle: async () => ({ data: store.rows.find((r: any) => r.id === v) ? { ...store.rows.find((r: any) => r.id === v) } : null, error: null }) }) }),
            update: (payload: any) => {
                const filters: Array<{ op: 'eq' | 'neq'; col: string; val: any }> = [];
                const q: any = {
                    eq: (col: string, val: any) => { filters.push({ op: 'eq', col, val }); return q; },
                    neq: (col: string, val: any) => { filters.push({ op: 'neq', col, val }); return q; },
                    select: () => q,
                    maybeSingle: async () => {
                        store.lastUpdate = { payload, filters };
                        if (store.onBeforeUpdate) store.onBeforeUpdate();
                        if (store.updateError) return { data: null, error: store.updateError };
                        const row = store.rows.find((r: any) => filters.every(f => (f.op === 'eq' ? r[f.col] === f.val : r[f.col] !== f.val)));
                        if (!row) return { data: null, error: null };
                        Object.assign(row, payload);
                        return { data: { ...row }, error: null };
                    },
                };
                return q;
            },
        };
    };

    const db: any = TaskDatabaseService; const access: any = TaskAccessService; const perm: any = PermissionService; const msg: any = TaskMessagingService;
    db.getEmployeeById = async (id: string) => people[id] || null;
    db.logAudit = async (a: any) => { audits.push(a); };
    access.check = async ({ userId }: any) => (userId === 'u5' ? { allowed: false, reason: 'not_onboarded', message: 'Kickoff not sent yet.' } : { allowed: true, reason: 'ok', message: '' });
    perm.assertCanAssignTask = async (actorId: string, targetId: string) => {
        if (forbidden.has(targetId)) throw new PermissionDeniedError('ASSIGN_TASK', actorId, 'You can only assign tasks to people who report to you.');
        return { actor: people[actorId], target: people[targetId] };
    };
    msg.sendMessage = async (phone: string, text: string, options: any) => { sent.push({ phone, text, options }); return true; };
    const flush = () => new Promise(res => setImmediate(res));

    console.log('\n1. The happy path');
    resetWorld();
    const r = await WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u2' });
    const moved = store.rows.find((x: any) => x.id === 't-todo');
    check('the SAME task row moves to the teammate (not copied): one row, new owner', moved.employee_id === 'u2' && store.rows.filter((x: any) => x.title === 'Single Disc Machine').length === 1 && r.task.employee_id === 'u2' && r.toName === 'Vidya', r);
    check('it is gone from the giver\'s list', !store.rows.some((x: any) => x.employee_id === 'u1' && x.id === 't-todo'));
    check('title, date, original assigner and original details are untouched', moved.title === 'Single Disc Machine' && moved.assigned_date === '2026-10-08' && moved.assigned_by === 'u9' && moved.description.startsWith('Site: SS Plaza\nRemark: Need to order'));
    check('a short "Given by …" trail is added to the card', /\nGiven by Priyanka on \d{1,2} [A-Z][a-z]{2}$/.test(moved.description), moved.description);
    check('the update is conditional: only if still held by the giver AND not finished (race-proof)', store.lastUpdate.filters.some((f: any) => f.op === 'eq' && f.col === 'employee_id' && f.val === 'u1') && store.lastUpdate.filters.some((f: any) => f.op === 'neq' && f.col === 'status' && f.val === 'completed') && store.lastUpdate.filters.some((f: any) => f.col === 'id' && f.val === 't-todo'), store.lastUpdate.filters);
    check('the audit log records who gave what to whom', audits.length === 1 && audits[0].eventType === 'task_handed_over' && audits[0].actorId === 'u1' && audits[0].targetEmployeeId === 'u2' && audits[0].taskId === 't-todo' && audits[0].details.fromUserId === 'u1' && audits[0].details.toUserId === 'u2', audits[0]);
    await flush();
    check('the receiver is told on WhatsApp (to HER number only), naming who gave it', sent.length === 1 && sent[0].phone === '9000000002' && /\*Given by:\* Priyanka \(Procurement\)/.test(sent[0].text) && /Single Disc Machine/.test(sent[0].text), sent);
    check('the message is gated as a hand-over alert and is text-only: NO template, nothing sent outside the 24-hour window', sent[0].options.messageType === 'task_handover' && sent[0].options.freeformOnly === true && !sent[0].options.campaignName && !sent[0].options.templateParams, sent[0].options);
    check('no guessing of he/she/him/her anywhere in the message', !/\b(he|she|him|her|his|hers)\b/i.test(sent[0].text));
    check('nothing touched the network', networkCalls.length === 0);

    console.log('\n2. Status and details on the way over');
    resetWorld();
    await WorkspaceService.handOver('u1', { taskId: 't-doing', targetUserId: 'u2' });
    const doing = store.rows.find((x: any) => x.id === 't-doing');
    check('"In progress" goes back to "To do" for the new holder (they have not started it)', doing.status === 'pending' && audits[0].details.fromStatus === 'in_progress' && audits[0].details.toStatus === 'pending', doing);
    check('a task with no details gets just the trail as its details', /^Given by Priyanka on /.test(doing.description));
    resetWorld();
    await WorkspaceService.handOver('u1', { taskId: 't-multi', targetUserId: 'u2' });
    const multi = store.rows.find((x: any) => x.id === 't-multi'); await flush();
    check('very long details: the original is kept and the trail is skipped rather than overflow 1000 characters', multi.description.length <= 1000 && !/Given by/.test(multi.description));
    resetWorld();
    await WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u3' }); await flush();
    check('a receiver with no phone still gets the task; nobody is messaged', store.rows.find((x: any) => x.id === 't-todo').employee_id === 'u3' && sent.length === 0);

    console.log('\n3. Who may do it');
    const expectRefusal = async (label: string, fn: () => Promise<unknown>, code: string | RegExp, status?: number) => {
        let err: any = null; try { await fn(); } catch (e) { err = e; }
        const okCode = err && (typeof code === 'string' ? err.code === code : code.test(String(err.message)));
        check(label, !!err && !!okCode && (status === undefined || err.status === status), err ? `${err.name}: ${err.message} (${err.code})` : 'no error');
        await flush();
    };
    const unchanged = () => store.rows.every((x: any) => (x.id === 't-vidya' ? x.employee_id === 'u2' : x.employee_id === 'u1')) && store.lastUpdate === null && sent.length === 0 && audits.length === 0;
    resetWorld();
    await expectRefusal('someone who does NOT hold the task cannot give it away (Vidya tries Priyanka\'s)', () => WorkspaceService.handOver('u2', { taskId: 't-todo', targetUserId: 'u1' }), 'NOT_HOLDER', 403);
    check('…and nothing changed, nothing was sent, nothing audited', unchanged());
    resetWorld();
    await expectRefusal('not even a superuser can give away someone else\'s task', () => WorkspaceService.handOver('u9', { taskId: 't-todo', targetUserId: 'u2' }), 'NOT_HOLDER', 403);
    check('…and nothing changed', unchanged());
    resetWorld();
    await expectRefusal('a finished task cannot be given away', () => WorkspaceService.handOver('u1', { taskId: 't-done', targetUserId: 'u2' }), 'ALREADY_DONE', 409);
    check('…and nothing changed', unchanged());
    resetWorld();
    await expectRefusal('giving it to yourself is refused', () => WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u1' }), 'SAME_PERSON', 400);
    resetWorld();
    await expectRefusal('someone you are not allowed to assign to is refused by the shared permission rule', () => WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u4' }), /only assign tasks to people who report to you/);
    check('…and nothing changed, nothing was sent', unchanged());
    resetWorld();
    await expectRefusal('a teammate who is locked out of the Task Manager is refused', () => WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u5' }), 'TARGET_LOCKED', 409);
    check('…and nothing changed, nothing was sent', unchanged());
    resetWorld();
    await expectRefusal('an unknown task is refused', () => WorkspaceService.handOver('u1', { taskId: 'nope', targetUserId: 'u2' }), /Task not found/, 404);
    await expectRefusal('missing task id / missing person are refused', () => WorkspaceService.handOver('u1', { targetUserId: 'u2' }), /Missing task/, 400);
    await expectRefusal('…', () => WorkspaceService.handOver('u1', { taskId: 't-todo' }), /Choose who/, 400);
    resetWorld();
    access.check = async ({ userId }: any) => (userId === 'u1' ? { allowed: false, reason: 'department_off', message: 'Not switched on for your team yet.' } : { allowed: true, reason: 'ok', message: '' });
    await expectRefusal('a giver who is locked out of the Task Manager cannot do anything', () => WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u2' }), 'LOCKED', 403);
    access.check = async ({ userId }: any) => (userId === 'u5' ? { allowed: false, reason: 'not_onboarded', message: 'Kickoff not sent yet.' } : { allowed: true, reason: 'ok', message: '' });

    console.log('\n4. When things change under our feet');
    resetWorld();
    store.onBeforeUpdate = () => { store.rows.find((x: any) => x.id === 't-todo').status = 'completed'; }; // finished a moment before the move
    await expectRefusal('finished at the very moment of the move → refused, no half-move', () => WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u2' }), 'CHANGED', 409);
    check('…the task stayed with the giver, no message, no audit', store.rows.find((x: any) => x.id === 't-todo').employee_id === 'u1' && sent.length === 0 && audits.length === 0);
    resetWorld();
    store.onBeforeUpdate = () => { store.rows.find((x: any) => x.id === 't-todo').employee_id = 'u2'; }; // someone else took it first
    await expectRefusal('given away by someone else a moment earlier → refused (cannot be given twice)', () => WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u2' }), 'CHANGED', 409);
    resetWorld();
    store.updateError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    await expectRefusal('the teammate already has the same daily task → friendly message', () => WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u2' }), 'ALREADY_THERE', 409);
    check('…nothing sent, nothing audited', sent.length === 0 && audits.length === 0);
    resetWorld();
    store.updateError = { code: 'XX000', message: 'boom' };
    await expectRefusal('any other database error → a plain message, never the raw error', () => WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u2' }), /Could not give the task just now/, 500);
    resetWorld();
    msg.sendMessage = async () => { throw new Error('whatsapp down'); };
    const afterFail = await WorkspaceService.handOver('u1', { taskId: 't-todo', targetUserId: 'u2' }); await flush();
    check('WhatsApp failing never undoes the hand-over', afterFail.task.employee_id === 'u2' && store.rows.find((x: any) => x.id === 't-todo').employee_id === 'u2');
    msg.sendMessage = async (phone: string, text: string, options: any) => { sent.push({ phone, text, options }); return true; };

    console.log('\n5. What the screen is told');
    check('canHandOver: my open task → yes', canHandOverTask({ employee_id: 'u1', status: 'pending' }, 'u1') && canHandOverTask({ employee_id: 'u1', status: 'in_progress' }, 'u1'));
    check('canHandOver: my finished task → no', !canHandOverTask({ employee_id: 'u1', status: 'completed' }, 'u1'));
    check('canHandOver: someone else\'s task → no (even a superuser\'s view of it)', !canHandOverTask({ employee_id: 'u2', status: 'pending' }, 'u1') && !canHandOverTask({ employee_id: 'u2', status: 'pending' }, 'u9'));

    console.log('\n6. Wiring (source checks)');
    const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
    const route = read('app/api/task-manager/workspace/route.ts');
    check('the route takes the actor from the login session, never from the request body, for hand_over', /action === 'hand_over'[\s\S]{0,200}WorkspaceService\.handOver\(userId,/.test(route) && !/body\.(actorId|actor|userId|fromUserId)\b/.test(route));
    const svc = read('task-manager/WorkspaceService.ts');
    check('load() tells the screen canHandOver for each task', /canHandOver: canHandOverTask\(r, actor\.id\)/.test(svc));
    const tab = read('frontend/components/procurement/ProcurementTasksTab.tsx');
    check('the Tasks tab offers only teammates (never myself) and the server\'s assignable list', /ok\.assignable\.filter\(a => !a\.isMe\)/.test(tab) && /give=\{give\}/.test(tab));
    const board = read('frontend/components/procurement/tasks/Board.tsx');
    check('the button shows only on cards the server marked canHandOver, never on the floating drag copy', /!floating && give && task\.canHandOver/.test(board));
    const giveTo = read('frontend/components/procurement/tasks/GiveTo.tsx');
    check('clicks inside "Give to…" cannot start a drag, and it asks for confirmation before moving', /onPointerDown=\{stop\}/.test(giveTo) && /onKeyDown=\{stop\}/.test(giveTo) && /Give this task to/.test(giveTo));

    console.log(failures === 0 ? '\n🎉 PHASE 1 (HAND OVER) TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
