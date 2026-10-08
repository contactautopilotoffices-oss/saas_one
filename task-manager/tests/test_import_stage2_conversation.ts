/**
 * Task Import, Stage 2 — the conversation (OFFLINE: in-memory fakes for state, sending, downloading and AI;
 * no network, no database, no WhatsApp message can be sent from this file).
 * Run: npx tsx task-manager/tests/test_import_stage2_conversation.ts
 */
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
    const S = await import('../TaskImportService');
    const I = await import('../TaskImportInbound');
    const P = await import('../TaskImportParser');

    // ── A fake world ─────────────────────────────────────────────────────────
    const world = () => {
        const w: any = {
            replies: [] as string[], audits: [] as string[], ctx: null as null | { type: string; data: any },
            reads: { config: 0, employee: 0 }, downloads: [] as string[], saved: 0,
            importDepts: new Set(['d1']) as Set<string>,
            config: { enabled: false, employees: [{ name: 'Sahil', phone: '8433649199' }] } as any,
            employee: { id: 'u1', department_id: 'd1' } as any, access: { allowed: true } as any,
            files: {} as Record<string, Buffer>,
            llmImage: 'NO_TASKS', llmStructure: [] as unknown,
        };
        const llm = { imageToText: async () => w.llmImage, structureText: async () => w.llmStructure };
        w.deps = {
            getContext: async () => w.ctx,
            setContext: async (_p: string, type: string, data: any) => { w.ctx = { type, data }; },
            clearContext: async () => { w.ctx = null; },
            reply: async (_p: string, text: string) => { w.replies.push(text); },
            parse: (input: any) => P.parseTaskImport(input, { llm, today: TODAY }),
            audit: async (e: string) => { w.audits.push(e); },
            today: () => TODAY,
        };
        w.io = {
            importDeps: w.deps,
            getConfig: async () => { w.reads.config++; return w.config; },
            getImportDepartments: async () => w.importDepts,
            getEmployee: async () => { w.reads.employee++; return w.employee; },
            checkAccess: async () => w.access,
            fetchMedia: async (url: string) => { w.downloads.push(url); return w.files[url] ? { ok: true, buffer: w.files[url], contentType: '' } : { ok: false, error: '404' }; },
            seenBefore: (id: string) => w.seen?.has(id) ?? false,
            markSeen: (id: string) => { (w.seen ||= new Set()).add(id); },
        };
        return w;
    };
    const msg = (m: any, id = 'wamid.1') => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, ...m }] } });
    const text = (t: string, id?: string) => msg({ message_type: 'text', text: { body: t } }, id);
    const image = (caption: string, id?: string) => msg({ message_type: 'image', image: { url: 'https://cdn.example.com/a.jpg', caption } }, id);
    const doc = (url: string, filename: string, id?: string) => msg({ message_type: 'document', document: { link: url, filename } }, id);

    console.log('\n1. What the person types');
    const T = S.matchImportTrigger;
    check('"add tasks" → trigger, nothing after it', T('add tasks')?.rest === '');
    check('"Add my tasks: 1. a" → trigger with the list', T('Add my tasks: 1. a\n2. b')?.rest === '1. a\n2. b');
    check('"import task list" / "upload todays tasks" are triggers', !!T('import task list') && !!T("upload today's tasks"));
    check('heading "Tasks for 25/09/2026:" + list → trigger', T('Tasks for 25/09/2026:\n1. a')?.rest === '1. a');
    check('ordinary chat is not a trigger', T('show my tasks') === null && T('I need a meeting room') === null && T('hello') === null);
    check('caption "my tasks" mentions tasks; "AC leaking" does not', S.captionMentionsTasks('my tasks') && !S.captionMentionsTasks('AC is leaking on floor 2') && !S.captionMentionsTasks(''));
    const C = (t: string) => S.parsePreviewCommand(t, TODAY);
    check('yes / y / ok / save → yes', ['yes', 'Y', 'ok', 'Save', 'save all', 'Yes!'].every(t => C(t)?.kind === 'yes'));
    check('no / cancel / discard → no', ['no', 'Cancel', 'discard', 'nope'].every(t => C(t)?.kind === 'no'));
    check('remove 3 / remove 2, 5 / delete task 4', JSON.stringify(C('remove 3')) === '{"kind":"remove","numbers":[3]}' && (C('remove 2, 5') as any).numbers.join() === '2,5' && (C('delete task 4') as any).numbers.join() === '4');
    check('date: today / tomorrow / 21 Aug / 21-08-2026 / nonsense',
        (C('date today') as any).date === TODAY && (C('date tomorrow') as any).date === '2026-10-08' && (C('date 21 Aug') as any).date === '2026-08-21' &&
        (C('date 21-08-2026') as any).date === '2026-08-21' && C('date banana')?.kind === 'bad_date');
    check('unrelated text is not a command', C('show my tasks') === null && C('what time is it') === null);

    console.log('\n2. The preview message');
    const sample: any = { tasks: [
        { title: 'Opex 2nd Cycle', site: 'All Center', remark: 'Payment align', status: 'in_progress', finalStatus: 'Have to send for approval' },
        { title: 'Audio-Visual Quotation', site: 'VFS', remark: null, status: 'pending', finalStatus: null }],
        date: '2026-09-25', dateFromSource: true, source: 'excel', structuredBy: 'rules' };
    const pv = S.formatPreview(sample);
    check('one message for a short list, ends with the options', pv.length === 1 && /Reply YES/.test(pv[0]) && /remove 3/.test(pv[0]), pv);
    check('shows count, source, readable date', /I found 2 tasks in your Excel file for Fri, 25 Sep 2026/.test(pv[0]), pv[0]);
    check('shows title, site, status and next step', /1\. Opex 2nd Cycle \(All Center\)/.test(pv[0]) && /In progress · Payment align/.test(pv[0]) && /Next: Have to send for approval/.test(pv[0]));
    check('"today" note when the file had no date', /today — I could not find a date/.test(S.formatPreview({ ...sample, dateFromSource: false })[0]));
    const big: any = { ...sample, tasks: Array.from({ length: 100 }, (_, i) => ({ title: `Task number ${i} with a fairly long descriptive title`, site: 'Some Site', remark: 'r'.repeat(200), status: 'pending', finalStatus: 'f'.repeat(200) })) };
    const bp = S.formatPreview(big);
    check(`100 tasks split into several messages, each ≤ ${S.MAX_MESSAGE_CHARS} chars`, bp.length > 1 && bp.every(c => c.length <= S.MAX_MESSAGE_CHARS), bp.map(c => c.length));
    check('every task appears exactly once; options only at the very end', (bp.join('\n').match(/^\d+\. Task number/gm) || []).length === 100 && /Reply YES/.test(bp[bp.length - 1]) && !bp.slice(0, -1).some(c => /Reply YES/.test(c)));

    console.log('\n3. The conversation (stubbed AI, in-memory state)');
    let w = world();
    let r = await S.TaskImportService.handleText(PHONE, 'add tasks', w.deps);
    check('"add tasks" → asks for the list, waits', r.handled && !r.background && w.ctx?.type === 'IMPORT_AWAITING' && /Send me your task list/.test(w.replies[0]), w.replies);
    r = await S.TaskImportService.handleText(PHONE, '1. Call vendor X\n2. Send the PO\n3. Check stock', w.deps);
    check('pasted list → instant "reading" reply, state = processing, slow work handed back', r.handled && typeof r.background === 'function' && w.ctx?.type === 'IMPORT_PROCESSING' && /Reading your tasks/.test(w.replies[1]), w.replies);
    r = await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('a message while still reading → "still reading", nothing else happens', r.handled && /still reading/.test(w.replies[2]) && w.ctx?.type === 'IMPORT_PROCESSING', w.replies);
    const bg =await (async () => { const w2 = world(); await S.TaskImportService.handleText(PHONE, 'add tasks', w2.deps); const c = await S.TaskImportService.handleText(PHONE, '1. Call vendor X\n2. Send the PO\n3. Check stock', w2.deps); await c.background!(); return w2; })();
    w = bg;
    check('background → numbered preview sent, state = preview with 3 tasks', w.ctx?.type === 'IMPORT_PREVIEW' && w.ctx.data.tasks.length === 3 && /1\. Call vendor X/.test(w.replies[w.replies.length - 1]), w.replies);
    check('audit trail: awaiting → received → previewed', w.audits.join() === 'task_import_awaiting,task_import_received,task_import_previewed', w.audits);

    r = await S.TaskImportService.handleText(PHONE, 'remove 2', w.deps);
    check('"remove 2" → 2 left, preview re-sent', r.handled && w.ctx.data.tasks.length === 2 && w.ctx.data.tasks[1].title === 'Check stock' && /Removed task 2\. 2 left/.test(w.replies.slice(-2)[0]), w.replies.slice(-3));
    r = await S.TaskImportService.handleText(PHONE, 'remove 9', w.deps);
    check('"remove 9" → polite error, list unchanged', r.handled && w.ctx.data.tasks.length === 2 && /couldn't find task 9/.test(w.replies[w.replies.length - 1]), w.replies.slice(-1));
    r = await S.TaskImportService.handleText(PHONE, 'remove 1, 2', w.deps);
    check('removing every task is refused (use NO instead)', r.handled && w.ctx.data.tasks.length === 2 && /remove every task/.test(w.replies[w.replies.length - 1]));
    r = await S.TaskImportService.handleText(PHONE, 'date 21 Aug', w.deps);
    check('"date 21 Aug" → whole batch moves to 2026-08-21', w.ctx.data.date === '2026-08-21' && w.ctx.data.dateFromSource === true && /Date changed to Fri, 21 Aug 2026/.test(w.replies.slice(-2)[0]), w.replies.slice(-2));
    r = await S.TaskImportService.handleText(PHONE, 'date banana', w.deps);
    check('bad date → polite error, date unchanged', w.ctx.data.date === '2026-08-21' && /couldn't understand that date/.test(w.replies[w.replies.length - 1]));
    r = await S.TaskImportService.handleText(PHONE, 'show my tasks', w.deps);
    check('an unrelated message is NOT taken (the normal bot answers it); the preview stays', !r.handled && w.ctx?.type === 'IMPORT_PREVIEW');
    r = await S.TaskImportService.handleText(PHONE, 'help', w.deps);
    check('"help" lists what can be said', r.handled && /remove 3/.test(w.replies[w.replies.length - 1]));
    const repliesBefore = w.replies.length;
    r = await S.TaskImportService.handleText(PHONE, 'yes', w.deps);
    check('YES in Stage 2 → honest "saving is not switched on", nothing stored, state cleared', r.handled && w.ctx === null && /saving is not switched on yet/.test(w.replies[repliesBefore]) && w.saved === 0, w.replies.slice(repliesBefore));
    check('YES is audited as not saved', w.audits[w.audits.length - 1] === 'task_import_confirmed');

    w = world();
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. a task\n2. b task', w.deps).then(c => c.background!());
    await S.TaskImportService.handleText(PHONE, 'no', w.deps);
    check('NO → discarded, nothing saved, state cleared', w.ctx === null && /discarded that list/.test(w.replies[w.replies.length - 1]));
    w = world();
    await S.TaskImportService.handleText(PHONE, 'add tasks', w.deps);
    await S.TaskImportService.handleText(PHONE, 'cancel', w.deps);
    check('"add tasks" then CANCEL → state cleared', w.ctx === null && /cancelled/.test(w.replies[w.replies.length - 1]));
    w = world();
    await S.TaskImportService.handleText(PHONE, 'add tasks', w.deps);
    r = await S.TaskImportService.handleText(PHONE, 'hello there', w.deps);
    check('while waiting for a list, a single unrelated line is not swallowed', !r.handled);

    w = world(); w.llmStructure = [];
    await S.TaskImportService.handleText(PHONE, 'add tasks: please do the thing that is vague', w.deps).then(c => c.background!());
    check('nothing found → friendly message, state cleared, no preview', w.ctx === null && /could not find any tasks/.test(w.replies[w.replies.length - 1]) && w.audits.includes('task_import_failed'), w.replies);
    w = world();
    const failing = { ...w.deps, parse: async () => { throw new Error('boom'); } };
    const c2 = await S.TaskImportService.handleText(PHONE, 'add tasks: 1. one\n2. two', failing as any);
    await c2.background!();
    check('parser crashes → friendly message, state cleared, no exception', w.ctx === null && /something went wrong/.test(w.replies[w.replies.length - 1]), w.replies);
    w = world();
    const withSave = { ...w.deps, save: async () => ({ saved: 2, skipped: 1 }) };
    await S.TaskImportService.handleText(PHONE, 'add tasks: 1. one\n2. two\n3. three', withSave as any).then(c => c.background!());
    await S.TaskImportService.handleText(PHONE, 'yes', withSave as any);
    check('(Stage 3 hook) when a save step exists, YES uses it and reports the counts', /Saved 2 tasks/.test(w.replies[w.replies.length - 1]) && /skipped 1/.test(w.replies[w.replies.length - 1]), w.replies.slice(-1));

    console.log('\n4. Who may use it');
    const E = I.decideImportEligibility;
    const cfg = { enabled: false, employees: [{ name: 's', phone: '8433649199' }] } as any;
    const ON = new Set(['d1']);
    const emp = { id: 'u', department_id: 'd1' };
    check('no department has Task import ON → no, even for a fully eligible person', E(cfg, PHONE, emp, { allowed: true }, new Set()).reason === 'department_off');
    check('a DIFFERENT department has it ON → no', E(cfg, PHONE, emp, { allowed: true }, new Set(['d2'])).reason === 'department_off');
    check('person with no department on their profile → no', E(cfg, PHONE, { id: 'u', department_id: null }, { allowed: true }, ON).ok === false);
    check('not a registered employee → no', E(cfg, PHONE, null, null, ON).reason === 'not_employee');
    check('department ON but Task Manager locked for them → no', E(cfg, PHONE, emp, { allowed: false }, ON).reason === 'locked');
    check('department ON + sandbox OFF + unlocked → yes (any phone)', E(cfg, '919999999999', emp, { allowed: true }, ON).ok === true);
    check('sandbox ON + a stranger → no', E({ ...cfg, enabled: true }, '919999999999', emp, { allowed: true }, ON).reason === 'outside_sandbox');
    check('sandbox ON + the sandbox number (12-digit vs 10-digit) → yes', E({ ...cfg, enabled: true }, PHONE, emp, { allowed: true }, ON).ok === true);
    check('sandbox ON + the sandbox manager → yes', E({ ...cfg, enabled: true, employees: [], manager: { name: 'm', phone: '+91 84336 49199' } }, PHONE, emp, { allowed: true }, ON).ok === true);

    console.log('\n5. The webhook: what is claimed, and what is left alone');
    w = world(); w.importDepts = new Set();
    let cl = await I.claimTaskImport(doc('https://cdn.example.com/t.xlsx', 't.xlsx'), w.io);
    check('no department has Task import ON → Excel not claimed, nothing sent, never downloaded, and NO employee/settings lookups at all', !cl.handled && w.replies.length === 0 && w.downloads.length === 0 && w.reads.employee === 0 && w.reads.config === 0);
    w = world(); w.importDepts = new Set(['some-other-department']);
    cl = await I.claimTaskImport(doc('https://cdn.example.com/t.xlsx', 't.xlsx'), w.io);
    check('Task import is ON only for ANOTHER department → this person is not claimed, silent', !cl.handled && w.replies.length === 0 && w.downloads.length === 0);
    w = world();
    cl = await I.claimTaskImport(text('hello team, lunch plans?'), w.io);
    check('ordinary chat → not claimed and costs NO database read at all', !cl.handled && w.reads.config === 0 && w.reads.employee === 0);
    cl = await I.claimTaskImport(msg({ message_type: 'video', video: { url: 'https://cdn.example.com/v.mp4' } }), w.io);
    check('a video → not claimed', !cl.handled && w.reads.config === 0);
    w = world(); w.employee = null;
    cl = await I.claimTaskImport(doc('https://cdn.example.com/t.xlsx', 't.xlsx'), w.io);
    check('unregistered number → not claimed, silent', !cl.handled && w.replies.length === 0);
    w = world(); w.access = { allowed: false };
    cl = await I.claimTaskImport(doc('https://cdn.example.com/t.xlsx', 't.xlsx'), w.io);
    check('Task Manager locked → not claimed, silent', !cl.handled && w.replies.length === 0);
    w = world(); w.config.enabled = true;
    const stranger = { ...doc('https://cdn.example.com/t.xlsx', 't.xlsx') } as any; stranger.data.messages[0].phone_number = '919876543210';
    cl = await I.claimTaskImport(stranger, w.io);
    check('sandbox ON + someone outside it → not claimed, silent, nothing downloaded', !cl.handled && w.replies.length === 0 && w.downloads.length === 0);
    cl = await I.claimTaskImport(doc('https://cdn.example.com/t.xlsx', 't.xlsx'), w.io);
    check('sandbox ON + the sandbox number → claimed', cl.handled === true);

    console.log('\n6. Excel arrives (like the real sample sheet)');
    w = world();
    w.files['https://cdn.example.com/t.xlsx'] = await xlsx([
        ['25-Sep-26'], [], ['Sr. No', 'Today Task List', 'Site Name', 'Remark', 'Status', 'Final Status'],
        ['1', 'Opex 2nd Cycle', 'All Center', 'Payment align', 'WIP', 'Have to send for approval'],
        ['2', 'Hk Material Feedback', 'All Center', 'Feedback on new vendor', 'WIP', 'Email to be sent'],
        ['3', 'Audio-Visual Quotation', 'VFS', 'Follow up with vendors', 'WIP', null]]);
    cl = await I.claimTaskImport(doc('https://cdn.example.com/t.xlsx', 'Tasks.xlsx', 'wamid.X1'), w.io);
    check('caption-less Excel document → claimed; instant "Excel file" acknowledgement; slow part deferred', cl.handled && !!cl.background && /Got your Excel file/.test(w.replies[0]) && w.downloads.length === 0, w.replies);
    await cl.background!();
    check('after the background work: 3-task preview for 25 Sep 2026, state = preview', w.ctx?.type === 'IMPORT_PREVIEW' && w.ctx.data.tasks.length === 3 && /for Fri, 25 Sep 2026/.test(w.replies[1]) && w.downloads.length === 1, w.replies);
    cl = await I.claimTaskImport(doc('https://cdn.example.com/t.xlsx', 'Tasks.xlsx', 'wamid.X1'), w.io);
    check('the provider re-delivers the same message → swallowed, no second reply', cl.handled && !cl.background && w.replies.length === 2 && w.downloads.length === 1);
    cl = await I.claimTaskImport(text('yes', 'wamid.X2'), w.io);
    check('YES from the same person → handled (Stage 2 honest reply), preview cleared', cl.handled && w.ctx === null && /saving is not switched on yet/.test(w.replies[w.replies.length - 1]));
    cl = await I.claimTaskImport(text('yes', 'wamid.X3'), w.io);
    check('a later "yes" with no preview pending is left to the normal bot', !cl.handled);

    console.log('\n7. Images: a ticket photo must never be hijacked');
    w = world(); w.files['https://cdn.example.com/a.jpg'] = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)]);
    w.llmImage = 'Sr | Task | Site | Remark | Status\n1 | Electricity bills | All Sites | One email | WIP';
    cl = await I.claimTaskImport(image('AC is leaking on floor 2'), w.io);
    check('photo with a facility caption → NOT claimed (the ticket flow keeps it)', !cl.handled && w.replies.length === 0 && w.downloads.length === 0);
    cl = await I.claimTaskImport(image(''), w.io);
    check('photo with no caption → NOT claimed', !cl.handled && w.replies.length === 0);
    cl = await I.claimTaskImport(image('my tasks for today', 'wamid.I1'), w.io);
    check('photo captioned "my tasks for today" → claimed', cl.handled && !!cl.background && /Got your image/.test(w.replies[0]));
    await cl.background!();
    check('…and previewed (1 task from the stubbed image reader)', w.ctx?.type === 'IMPORT_PREVIEW' && w.ctx.data.tasks[0].title === 'Electricity bills', w.replies);
    w = world(); w.files['https://cdn.example.com/a.jpg'] = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(50)]);
    w.llmImage = 'Task | Site\nCall vendor | Noida';
    await I.claimTaskImport(text('add tasks', 'wamid.I2'), w.io);
    cl = await I.claimTaskImport(image('', 'wamid.I3'), w.io);
    check('"add tasks" first, THEN a photo with no caption → claimed', cl.handled && !!cl.background);
    await cl.background!();
    check('…and previewed', w.ctx?.type === 'IMPORT_PREVIEW' && w.ctx.data.tasks.length === 1, w.replies);
    w = world(); w.files['https://cdn.example.com/a.jpg'] = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]);
    w.llmImage = 'NO_TASKS';
    cl = await I.claimTaskImport(image('tasks'), w.io); await cl.background!();
    check('captioned "tasks" but the picture is not a list → friendly "could not find a task list", state cleared', w.ctx === null && /could not find a task list/.test(w.replies[w.replies.length - 1]), w.replies);

    console.log('\n8. Files that cannot be read are explained, not ignored');
    w = world();
    cl = await I.claimTaskImport(doc('https://cdn.example.com/r.pdf', 'report.pdf'), w.io);
    check('PDF → claimed, told "I can\'t read PDFs yet", never downloaded', cl.handled && !cl.background && /can't read PDFs/.test(w.replies[0]) && w.downloads.length === 0);
    w = world(); w.files['https://cdn.example.com/x.bin'] = Buffer.from('just some random bytes here');
    cl = await I.claimTaskImport(doc('https://cdn.example.com/x.bin', 'thing.bin'), w.io); await cl.background!();
    check('unknown file type → friendly "images, Excel and text" message, state cleared', w.ctx === null && /Excel \(\.xlsx\) files and text/.test(w.replies[w.replies.length - 1]), w.replies);
    w = world(); w.files['https://cdn.example.com/p.bin'] = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(10)]);
    cl = await I.claimTaskImport(doc('https://cdn.example.com/p.bin', 'noext'), w.io); await cl.background!();
    check('a PDF with a misleading name is still recognised from its bytes', /can't read PDFs/.test(w.replies[w.replies.length - 1]));
    w = world(); w.files['https://cdn.example.com/o.xls'] = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(10)]);
    cl = await I.claimTaskImport(doc('https://cdn.example.com/o.xls', 'old.xls'), w.io); await cl.background!();
    check('old .xls → asked to save as .xlsx', /\.xlsx/.test(w.replies[w.replies.length - 1]), w.replies);
    w = world();
    cl = await I.claimTaskImport(doc('https://cdn.example.com/missing.xlsx', 't.xlsx'), w.io); await cl.background!();
    check('download fails → "please send it again", state cleared', w.ctx === null && /couldn't download/.test(w.replies[w.replies.length - 1]), w.replies);
    w = world();
    cl = await I.claimTaskImport(doc('http://cdn.example.com/t.xlsx', 't.xlsx'), w.io);
    check('a non-https link is refused without any download', cl.handled && w.downloads.length === 0 && /couldn't download/.test(w.replies[0]));
    w = world(); w.files['https://cdn.example.com/t.xlsx'] = await xlsx([['Task'], ['One']]);
    cl = await I.claimTaskImport(doc('https://cdn.example.com/t.xlsx', 't.xlsx', 'wamid.B1'), w.io);
    const again = await I.claimTaskImport(doc('https://cdn.example.com/t.xlsx', 't.xlsx', 'wamid.B2'), w.io);
    check('a second file while the first is still being read → "still reading", only one download', again.handled && !again.background && /still reading/.test(w.replies[w.replies.length - 1]));

    console.log('\n9. Downloading safely');
    check('https CDN link is allowed', I.isSafeMediaUrl('https://media.example.com/a/b.xlsx') === true);
    check('http, localhost, internal names and raw IPs are refused', ['http://a.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://db.internal/x', 'https://[::1]/x', 'ftp://a.com/x', 'not a url'].every(u => I.isSafeMediaUrl(u) === false));
    const resp = (body: Buffer | null, init: ResponseInit) => new Response(body as any, init);
    let f = await I.fetchMediaSafely('https://a.example.com/x', (async () => resp(Buffer.from('hello'), { status: 200, headers: { 'content-type': 'text/plain' } })) as any);
    check('a normal download returns the bytes', f.ok && f.buffer.toString() === 'hello');
    f = await I.fetchMediaSafely('https://a.example.com/x', (async () => resp(null, { status: 302, headers: { location: 'http://evil.example.com/y' } })) as any);
    check('a redirect to http is refused', !f.ok);
    f = await I.fetchMediaSafely('https://a.example.com/x', (async () => resp(null, { status: 302, headers: { location: 'https://169.254.169.254/' } })) as any);
    check('a redirect to an internal address is refused', !f.ok);
    f = await I.fetchMediaSafely('https://a.example.com/x', (async () => resp(Buffer.alloc(I.MAX_MEDIA_BYTES + 1), { status: 200 })) as any);
    check('a file over 10 MB is refused', !f.ok && /too large/.test((f as any).error));
    f = await I.fetchMediaSafely('https://a.example.com/x', (async () => resp(Buffer.from('x'), { status: 404 })) as any);
    check('HTTP 404 → failure value, no exception', !f.ok);
    f = await I.fetchMediaSafely('https://a.example.com/x', (async () => { throw new Error('network down'); }) as any);
    check('network error → failure value, no exception', !f.ok);

    console.log('\n10. Reading the provider payload');
    const e1 = I.extractCandidate(doc('https://cdn.example.com/t.xlsx', 'T.xlsx'));
    check('document: phone, url, file name, class', e1?.phone === PHONE && e1.mediaUrl === 'https://cdn.example.com/t.xlsx' && e1.fileName === 'T.xlsx' && e1.mediaClass === 'document', e1);
    const e2 = I.extractCandidate(image('tasks'));
    check('image with caption', e2?.mediaClass === 'image' && e2.text === 'tasks');
    check('plain text', I.extractCandidate(text('hi'))?.mediaClass === 'text');
    check('garbage / outbound / empty → null (never throws)', I.extractCandidate(null) === null && I.extractCandidate('x') === null && I.extractCandidate({}) === null && I.extractCandidate({ topic: 'message.sent.user', fromMe: true }) === null);

    console.log(failures === 0 ? '\n🎉 IMPORT STAGE 2 TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
