/**
 * Task Import, Stage 3 — saving (OFFLINE: an in-memory fake database, a fake Supabase client, a fake sender;
 * no network, no real database, no WhatsApp message can be sent from this file).
 * Run: npx tsx task-manager/tests/test_import_stage3_save.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import ExcelJS from 'exceljs';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

const PHONE = '918433649199';
const TODAY = '2026-10-07';

async function xlsx(rows: (string | null)[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    rows.forEach(r => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
}

async function run() {
    const V = await import('../TaskImportSave');
    const S = await import('../TaskImportService');
    const I = await import('../TaskImportInbound');
    const P = await import('../TaskImportParser');

    // ── A fake database that behaves like task_assignments ───────────────────
    const fakeDb = () => {
        const d: any = { rows: [] as any[], audits: [] as any[], failTitles: new Set<string>(), failList: false, failAudit: false, n: 0 };
        d.getDailyAssignments = async (p: any) => { if (d.failList) throw new Error('db down'); return d.rows.filter((r: any) => r.employee_id === p.employeeId && r.assigned_date === p.date); };
        d.createTaskAssignment = async (p: any) => {
            if (d.failTitles.has(p.title)) throw new Error('insert failed');
            const row = { id: `t${++d.n}`, employee_id: p.employeeId, title: p.title.trim(), description: p.description ?? null, assigned_date: p.assignedDate, status: p.status || 'pending', assigned_by: p.assignedBy };
            d.rows.push(row);
            return row;
        };
        d.logAudit = async (a: any) => { if (d.failAudit) throw new Error('audit down'); d.audits.push(a); };
        return d;
    };
    const task = (title: string, o: any = {}) => ({ title, site: null, remark: null, status: 'pending', finalStatus: null, ...o });
    const draftOf = (tasks: any[], date = '2026-09-25') => ({ tasks, date, dateFromSource: true, source: 'excel', structuredBy: 'rules' } as any);

    console.log('\n1. What gets written');
    check('description = readable lines (site, remark, final status)', V.buildDescription({ site: 'Noida', remark: 'Urgent', finalStatus: 'By 2nd half' }) === 'Site: Noida\nRemark: Urgent\nFinal status: By 2nd half');
    check('no extra info → no description (null)', V.buildDescription({ site: null, remark: null, finalStatus: null }) === null);
    check('only some fields → only those lines', V.buildDescription({ site: 'VFS', remark: null, finalStatus: null }) === 'Site: VFS');
    let db = fakeDb();
    let io = V.buildSaveIO(db);
    let out = await V.saveImportedTasks({ employeeId: 'u1', draft: draftOf([
        task('Opex 2nd Cycle', { site: 'All Center', remark: 'Payment align', status: 'in_progress', finalStatus: 'Send for approval' }),
        task('Item standardisation', { site: 'All Center', status: 'completed' }),
        task('Call vendor')]) }, io);
    check('3 saved, none skipped or failed', out.saved === 3 && out.skipped === 0 && out.failed === 0 && out.taskIds?.length === 3, out);
    check('saved on the SHEET date, in the sender\'s own list, assigned by themself', db.rows.every((r: any) => r.assigned_date === '2026-09-25' && r.employee_id === 'u1' && r.assigned_by === 'u1'), db.rows);
    check('WIP → To do (new work never starts in progress), Done → completed, blank → pending', db.rows.map((r: any) => r.status).join() === 'pending,completed,pending', db.rows.map((r: any) => r.status));
    check('site / remark / final status are in the description', db.rows[0].description === 'Site: All Center\nRemark: Payment align\nFinal status: Send for approval' && db.rows[2].description === null, db.rows[0]);
    check('one audit row per task, same shape as the web Tasks tab (task_assigned)', db.audits.length === 3 && db.audits.every((a: any) => a.eventType === 'task_assigned' && a.details.via === 'whatsapp_import' && a.targetEmployeeId === 'u1') && db.audits[0].taskId === 't1', db.audits[0]);

    console.log('\n2. Duplicates (sending the same sheet twice must not double the list)');
    out = await V.saveImportedTasks({ employeeId: 'u1', draft: draftOf([
        task('Opex 2nd Cycle', { site: 'All Center' }), task('Item standardisation', { site: 'All Center' }), task('Call vendor')]) }, io);
    check('same list again → nothing new saved, all 3 skipped', out.saved === 0 && out.skipped === 3 && db.rows.length === 3, out);
    out = await V.saveImportedTasks({ employeeId: 'u1', draft: draftOf([task('opex 2nd cycle!!', { site: 'all center' })]) }, io);
    check('case and punctuation do not defeat the duplicate check', out.skipped === 1 && out.saved === 0);
    out = await V.saveImportedTasks({ employeeId: 'u1', draft: draftOf([task('Opex 2nd Cycle', { site: 'All Center' })], '2026-09-26') }, io);
    check('the same task on a DIFFERENT date is not a duplicate', out.saved === 1 && out.skipped === 0);
    out = await V.saveImportedTasks({ employeeId: 'u2', draft: draftOf([task('Opex 2nd Cycle', { site: 'All Center' })]) }, io);
    check('the same task for a DIFFERENT person is not a duplicate', out.saved === 1);
    db = fakeDb(); io = V.buildSaveIO(db);
    out = await V.saveImportedTasks({ employeeId: 'u1', draft: draftOf([task('Chair Inspection', { site: 'Sigma' }), task('Chair Inspection', { site: 'ETPL' })]) }, io);
    check('same title at two sites → BOTH saved (different jobs); not blocked by the first one just written', out.saved === 2 && out.skipped === 0, out);
    db = fakeDb(); io = V.buildSaveIO(db);
    db.rows.push({ id: 'm1', employee_id: 'u1', title: 'Call vendor', description: null, assigned_date: '2026-09-25', status: 'pending' });
    out = await V.saveImportedTasks({ employeeId: 'u1', draft: draftOf([task('Call vendor')]) }, io);
    check('a task typed in by hand with the same title and no site → skipped as already there', out.skipped === 1 && out.saved === 0);

    console.log('\n3. When something goes wrong');
    db = fakeDb(); io = V.buildSaveIO(db); db.failTitles.add('Second');
    out = await V.saveImportedTasks({ employeeId: 'u1', draft: draftOf([task('First'), task('Second'), task('Third')]) }, io);
    check('one insert fails → the others are still saved; the failure is reported with its position', out.saved === 2 && out.failed === 1 && out.failedIndexes?.join() === '1', out);
    db = fakeDb(); io = V.buildSaveIO(db); db.failAudit = true;
    out = await V.saveImportedTasks({ employeeId: 'u1', draft: draftOf([task('First')]) }, io);
    check('an audit failure never undoes or fails a saved task', out.saved === 1 && out.failed === 0 && db.rows.length === 1, out);
    db = fakeDb(); io = V.buildSaveIO(db); db.failList = true;
    let threw = false; try { await V.saveImportedTasks({ employeeId: 'u1', draft: draftOf([task('First')]) }, io); } catch { threw = true; }
    check('cannot read existing tasks → throws BEFORE writing anything (the conversation catches it)', threw && db.rows.length === 0);

    console.log('\n4. The existing task-create function (only an optional "status" was added)');
    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    let inserted: any = null;
    (supabaseAdmin as any).from = (table: string) => ({
        insert: (payload: any) => { inserted = { table, payload }; return { select: () => ({ single: async () => ({ data: { id: 'x', ...payload }, error: null }) }) }; },
    });
    await TaskDatabaseService.createTaskAssignment({ employeeId: 'u1', title: ' Plain ', assignedDate: '2026-09-25', assignedBy: 'u1' });
    check('no status given → exactly as before: pending, no completed_at', inserted.table === 'task_assignments' && inserted.payload.status === 'pending' && !('completed_at' in inserted.payload) && inserted.payload.title === 'Plain', inserted);
    await TaskDatabaseService.createTaskAssignment({ employeeId: 'u1', title: 'WIP one', status: 'in_progress' });
    check('in_progress is stored, no completed_at', inserted.payload.status === 'in_progress' && !('completed_at' in inserted.payload));
    await TaskDatabaseService.createTaskAssignment({ employeeId: 'u1', title: 'Done one', status: 'completed' });
    check('completed is stored WITH a completed_at time', inserted.payload.status === 'completed' && typeof inserted.payload.completed_at === 'string');

    console.log('\n5. The conversation with the real save step');
    const world = () => {
        const w: any = { replies: [] as string[], audits: [] as any[], ctx: null as any, db: fakeDb() };
        const llm = { imageToText: async () => 'NO_TASKS', structureText: async () => [] };
        w.deps = {
            getContext: async () => w.ctx,
            setContext: async (_p: string, type: string, data: any) => { w.ctx = { type, data }; },
            clearContext: async () => { w.ctx = null; },
            reply: async (_p: string, t: string) => { w.replies.push(t); },
            parse: (input: any) => P.parseTaskImport(input, { llm, today: TODAY }),
            audit: async (e: string, _p: string, d: any) => { w.audits.push({ e, d }); },
            today: () => TODAY,
            save: async (_p: string, draft: any) => V.saveImportedTasks({ employeeId: 'u1', draft }, V.buildSaveIO(w.db)),
        };
        return w;
    };
    let w = world();
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. Call vendor X\n2. Send the PO\n3. Check stock', w.deps).then(c => c.background!());
    check('preview of a today-dated list has NO "not today" warning', !/not today/.test(w.replies.join('\n')), w.replies);
    let r = await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('YES → 3 tasks really written to the sender\'s list for today', r.handled && w.db.rows.length === 3 && w.db.rows.every((x: any) => x.assigned_date === TODAY && x.employee_id === 'u1'), w.db.rows);
    check('confirmation names the count and where to look', /Saved 3 tasks for Wed, 7 Oct 2026\. You'll find them in your Tasks tab\./.test(w.replies[w.replies.length - 1]), w.replies.slice(-1));
    check('state cleared; the audit row carries the created ids', w.ctx === null && w.audits[w.audits.length - 1].e === 'task_import_confirmed' && w.audits[w.audits.length - 1].d.taskIds.length === 3 && w.audits[w.audits.length - 1].d.savedCount === 3, w.audits[w.audits.length - 1]);
    r = await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('a second YES afterwards does nothing (left to the normal bot), nothing is written twice', !r.handled && w.db.rows.length === 3);

    w = world();
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. Call vendor X\n2. Send the PO', w.deps).then(c => c.background!());
    let release: () => void = () => undefined;
    const gate = new Promise<void>(res => { release = res; });
    const slowSave = w.deps.save;
    w.deps.save = async (p: string, d: any) => { await gate; return slowSave(p, d); };
    const first = S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    await new Promise(res => setTimeout(res, 5));
    const second = await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('a second YES while the first is still saving → "still saving", never a second save', second.handled && /still saving/.test(w.replies[w.replies.length - 1]) && w.ctx?.data?.saving === true, w.replies.slice(-1));
    release(); await first;
    check('…and the list was saved exactly once', w.db.rows.length === 2 && w.ctx === null);

    w = world();
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. Call vendor X\n2. Send the PO', w.deps).then(c => c.background!());
    await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. Call vendor X\n2. Send the PO\n3. New one', w.deps).then(c => c.background!());
    await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('sending an overlapping list again → only the new task is added, and the reply says what was skipped', w.db.rows.length === 3 && /Saved 1 task for/.test(w.replies[w.replies.length - 1]) && /skipped 2/.test(w.replies[w.replies.length - 1]), w.replies.slice(-1));
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. Call vendor X\n2. Send the PO', w.deps).then(c => c.background!());
    await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('sending a list that is entirely already there → "already in your list", nothing added', w.db.rows.length === 3 && /already in your list/.test(w.replies[w.replies.length - 1]), w.replies.slice(-1));

    w = world(); w.db.failTitles.add('Send the PO');
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. Call vendor X\n2. Send the PO\n3. Check stock', w.deps).then(c => c.background!());
    await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('partial failure → honest "saved 2 of 3", the failed one is kept for a retry', w.db.rows.length === 2 && /Saved 2 of 3/.test(w.replies[w.replies.length - 1]) && w.ctx?.type === 'IMPORT_PREVIEW' && w.ctx.data.tasks.length === 1 && w.ctx.data.tasks[0].title === 'Send the PO', w.replies.slice(-1));
    w.db.failTitles.clear();
    await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('YES again → retries ONLY the failed one (no duplicates of the two that saved)', w.db.rows.length === 3 && w.ctx === null && /Saved 1 task/.test(w.replies[w.replies.length - 1]), w.db.rows.map((x: any) => x.title));

    w = world(); w.db.failList = true;
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. Call vendor X\n2. Send the PO', w.deps).then(c => c.background!());
    await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('database down → nothing written, list put back, told to try again (not lost)', w.db.rows.length === 0 && w.ctx?.type === 'IMPORT_PREVIEW' && w.ctx.data.tasks.length === 2 && /Reply YES to try again/.test(w.replies[w.replies.length - 1]) && w.audits[w.audits.length - 1].e === 'task_import_save_failed', w.replies.slice(-1));
    w.db.failList = false;
    await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('…and YES works once it is back', w.db.rows.length === 2 && w.ctx === null);

    w = world();
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. Old one\n2. Older one', w.deps).then(c => c.background!());
    await S.TaskImportService.handleText(PHONE, 'date 21 Aug', w.deps);
    check('a preview for a date that is not today warns that it will not show on today\'s list', /not today's date/.test(w.replies[w.replies.length - 1]) && /date today/.test(w.replies[w.replies.length - 1]), w.replies.slice(-1));
    await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('…and the confirmation says they are on that date', w.db.rows.every((x: any) => x.assigned_date === '2026-08-21') && /not today/.test(w.replies[w.replies.length - 1]), w.replies.slice(-1));
    w = world();
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. A\n2. B', w.deps).then(c => c.background!());
    await S.TaskImportService.handleText(PHONE, 'no', w.deps);
    check('NO → nothing is written', w.db.rows.length === 0);

    console.log('\n6. End to end: an Excel file through the webhook adapter, YES, rows in the database');
    w = world();
    const url = 'https://cdn.example.com/t.xlsx';
    const files: Record<string, Buffer> = { [url]: await xlsx([
        ['25-Sep-26'], [], ['Sr. No', 'Today Task List', 'Site Name', 'Remark', 'Status', 'Final Status'],
        ['1', 'Opex 2nd Cycle', 'All Center', 'Payment align', 'WIP', 'Have to send for approval'],
        ['2', 'Hk material', 'Noida', 'Urgent requirement', 'Done', null],
        ['3', 'Audio-Visual Quotation', 'VFS', 'Follow up with vendors', null, null]]) };
    const config = { enabled: true, employees: [{ name: 'Sahil', phone: '8433649199' }] } as any;
    const hookIO: any = {
        importDeps: w.deps, getConfig: async () => config, getImportDepartments: async () => new Set(['d1']), getEmployee: async () => ({ id: 'u1', department_id: 'd1' }),
        checkAccess: async () => ({ allowed: true }),
        fetchMedia: async (u: string) => files[u] ? { ok: true, buffer: files[u], contentType: '' } : { ok: false, error: '404' },
        seenBefore: () => false, markSeen: () => undefined,
    };
    const body = (m: any, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, ...m }] } });
    const cl = await I.claimTaskImport(body({ message_type: 'document', document: { link: url, filename: 'Tasks.xlsx' } }, 'wamid.E1'), hookIO);
    await cl.background!();
    check('preview shows the 3 tasks for the sheet date; nothing written yet', w.db.rows.length === 0 && /for Fri, 25 Sep 2026/.test(w.replies[1]) && /not today's date/.test(w.replies[w.replies.length - 1]), w.replies);
    const yes = await I.claimTaskImport(body({ message_type: 'text', text: { body: 'yes' } }, 'wamid.E2'), hookIO);
    check('YES (sandbox number, switch ON) → handled, 3 tasks written', yes.handled && w.db.rows.length === 3, w.db.rows);
    check('statuses, dates and descriptions are right in the database rows',
        w.db.rows.map((r: any) => r.status).join() === 'pending,completed,pending' && w.db.rows.every((r: any) => r.assigned_date === '2026-09-25') &&
        w.db.rows[0].description === 'Site: All Center\nRemark: Payment align\nFinal status: Have to send for approval' && w.db.rows[1].description === 'Site: Noida\nRemark: Urgent requirement', w.db.rows);
    const stranger = body({ message_type: 'text', text: { body: 'yes' } }, 'wamid.E3') as any; stranger.data.messages[0].phone_number = '919876543210';
    const rowsBefore = w.db.rows.length;
    const sc = await I.claimTaskImport(stranger, hookIO);
    check('someone outside the sandbox can never reach the save (not claimed, nothing written)', !sc.handled && w.db.rows.length === rowsBefore);

    console.log(failures === 0 ? '\n🎉 IMPORT STAGE 3 TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
