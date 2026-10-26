/**
 * Task Import, Stage 1 — the smart parser (OFFLINE: in-memory Excel + stubbed AI; no network, no database, no WhatsApp).
 * Run: npx tsx task-manager/tests/test_import_parser_stage1.ts
 */
import ExcelJS from 'exceljs';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function sheet(rows: (string | null)[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    rows.forEach(r => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
}

async function run() {
    const P = await import('../TaskImportParser');
    const TODAY = '2026-10-07';

    // An AI stub that records calls — so we can prove when the AI was NOT used.
    let imageCalls = 0, structureCalls = 0;
    let structureReply: unknown = [];
    let throwOnCall = false;
    let imageReply = '';
    const llm: import('../TaskImportParser').ImportLlm = {
        async imageToText() { imageCalls++; if (throwOnCall) throw new Error('boom'); return imageReply; },
        async structureText() { structureCalls++; if (throwOnCall) throw new Error('boom'); return structureReply; }
    };
    const reset = () => { imageCalls = 0; structureCalls = 0; throwOnCall = false; };

    console.log('\n1. Excel shaped like the real sample (date row, blank row, headers, WIP rows)');
    const sample = await sheet([
        ['25-Sep-26', null, null, null, null, null],
        [null, null, null, null, null, null],
        ['Sr. No', 'Today Task List', 'Site Name', 'Remark', 'Status', 'Final Status'],
        ['1', 'Opex 2nd Cycle', 'All Center', 'Payment align', 'WIP', 'Have to send for approval'],
        ['2', 'Hk Material Feedback', 'All Center', 'Feedback regarding the new housekeeping material vendor', 'WIP', 'Email to be sent'],
        ['3', 'Item standardisation', 'All Center', 'Add the standardised item list to the app', 'WIP', 'Meeting with lohit and Harsh'],
        ['4', 'Electricity bills', 'All Sites', 'Consolidating electricity bills for all sites into one email', 'WIP', 'Coordinating with site teams'],
        ['5', 'Hk material', 'Noida', 'Urgent requirement for housekeeping materials', 'WIP', 'Material to be delivered by 2nd half'],
        ['6', 'Audio-Visual Quotation', 'VFS', 'Follow up with vendors for quotations', 'WIP', null]
    ]);
    reset();
    let r = await P.parseTaskImport({ kind: 'excel', buffer: sample }, { llm, today: TODAY });
    check('ok with 6 tasks', r.ok && r.tasks.length === 6, r);
    check('date comes from the sheet (25-Sep-26 → 2026-09-25)', r.date === '2026-09-25' && r.dateFromSource === true, r.date);
    check('structured by rules — the AI was never called', r.structuredBy === 'rules' && structureCalls === 0 && imageCalls === 0);
    check('title / site / remark mapped', r.tasks[0].title === 'Opex 2nd Cycle' && r.tasks[0].site === 'All Center' && r.tasks[0].remark === 'Payment align', r.tasks[0]);
    check('WIP → in_progress', r.tasks.every(t => t.status === 'in_progress'));
    check('final status kept; empty one is null', r.tasks[0].finalStatus === 'Have to send for approval' && r.tasks[5].finalStatus === null);
    check('serial-number column is not a task', !r.tasks.some(t => /^\d+$/.test(t.title)));

    console.log('\n2. Excel variations');
    r = await P.parseTaskImport({ kind: 'excel', buffer: await sheet([['Task', 'Status'], ['Call vendor', 'Done'], ['Send PO', ''], ['Call vendor', 'Done']]) }, { llm, today: TODAY });
    check('no date in sheet → today; Done → completed; blank → pending', r.date === TODAY && r.dateFromSource === false && r.tasks[0].status === 'completed' && r.tasks[1].status === 'pending', r);
    check('exact duplicate row is dropped in the batch', r.tasks.length === 2, r.tasks);
    reset(); structureReply = [{ title: 'Fallback task', status: 'WIP' }];
    r = await P.parseTaskImport({ kind: 'excel', buffer: await sheet([['foo', 'bar'], ['Order chairs', 'urgent']]) }, { llm, today: TODAY });
    check('unrecognised headers → falls back to the AI once', r.ok && r.structuredBy === 'llm' && structureCalls === 1 && r.tasks[0].status === 'in_progress', r);
    r = await P.parseTaskImport({ kind: 'excel', buffer: Buffer.from('this is not an excel file') }, { llm, today: TODAY });
    check('corrupt file → friendly error, no throw', !r.ok && /Excel/.test(r.error || ''), r);
    r = await P.parseTaskImport({ kind: 'excel', buffer: Buffer.alloc(0) }, { llm, today: TODAY });
    check('empty file → friendly error', !r.ok && !!r.error, r);
    const many = await sheet([['Task'], ...Array.from({ length: 150 }, (_, i) => [`Task number ${i}`])]);
    r = await P.parseTaskImport({ kind: 'excel', buffer: many }, { llm, today: TODAY });
    check(`capped at ${P.MAX_TASKS_PER_IMPORT} tasks`, r.ok && r.tasks.length === P.MAX_TASKS_PER_IMPORT, r.tasks.length);

    console.log('\n3. Text');
    reset();
    r = await P.parseTaskImport({ kind: 'text', text: 'Tasks for 25/09/2026\n1. Call vendor X\n2) Send the PO\n- Check stock' }, { llm, today: TODAY });
    check('numbered/bulleted list → rules, AI not called', r.ok && r.structuredBy === 'rules' && structureCalls === 0 && r.tasks.length === 3, r);
    check('date found in the text heading (day first)', r.date === '2026-09-25' && r.dateFromSource, r.date);
    structureReply = { tasks: [{ title: 'Follow up Noida material', site: 'Noida', status: 'wip' }] };
    structureReply = (structureReply as any).tasks;
    r = await P.parseTaskImport({ kind: 'text', text: 'need to follow up on the noida material today and also chase the quotes' }, { llm, today: TODAY });
    check('free text → one AI structuring call', r.ok && r.structuredBy === 'llm' && structureCalls === 1 && r.tasks[0].site === 'Noida', r);
    r = await P.parseTaskImport({ kind: 'text', text: '   ' }, { llm, today: TODAY });
    check('blank text → friendly error', !r.ok, r);

    console.log('\n4. Image (the AI reads the picture, then the same structuring step)');
    reset();
    imageReply = '25-Sep-26\nSr | Task | Site | Remark | Status\n1 | Electricity bills | All Sites | Consolidate into one email | WIP';
    structureReply = [{ title: 'Electricity bills', site: 'All Sites', remark: 'Consolidate into one email', status: 'WIP' }];
    r = await P.parseTaskImport({ kind: 'image', buffer: Buffer.from('fakepng'), mimeType: 'image/png' }, { llm, today: TODAY });
    check('clean aligned table → 1 vision call, mapped by rules, no second AI call', r.ok && imageCalls === 1 && structureCalls === 0 && r.structuredBy === 'rules' && r.tasks.length === 1 && r.tasks[0].status === 'in_progress', r);
    check('date read from the picture text', r.date === '2026-09-25' && r.dateFromSource, r.date);
    reset();
    imageReply = 'Sr | Task | Site | Remark | Status | Final Status\n1 | Call vendor | Noida | Chase | WIP | Waiting\n2 | Send PO | Noida | WIP';
    structureReply = [{ title: 'Call vendor', status: 'WIP' }, { title: 'Send PO', status: 'WIP' }];
    r = await P.parseTaskImport({ kind: 'image', buffer: Buffer.from('x'), mimeType: 'image/png' }, { llm, today: TODAY });
    check('a row with a dropped cell → rules refuse to guess, AI structuring is used instead', r.ok && r.structuredBy === 'llm' && structureCalls === 1, r);
    reset(); imageReply = 'NO_TASKS';
    r = await P.parseTaskImport({ kind: 'image', buffer: Buffer.from('x'), mimeType: 'image/png' }, { llm, today: TODAY });
    check('not a task list → friendly error, structuring not called', !r.ok && structureCalls === 0, r);

    console.log('\n5. The AI misbehaving never breaks the flow');
    reset(); throwOnCall = true;
    r = await P.parseTaskImport({ kind: 'image', buffer: Buffer.from('x'), mimeType: 'image/png' }, { llm, today: TODAY });
    check('AI throws → friendly error value, no exception', !r.ok && !!r.error, r);
    reset(); structureReply = 'not an array';
    r = await P.parseTaskImport({ kind: 'text', text: 'chase the vendor about the quotation' }, { llm, today: TODAY });
    check('AI returns garbage → no tasks, friendly error', !r.ok, r);
    reset(); structureReply = [{ title: '' }, { nope: 1 }, null, 'str', { title: 'x'.repeat(500), status: 'Completed' }];
    r = await P.parseTaskImport({ kind: 'text', text: 'chase the vendor about the quotation' }, { llm, today: TODAY });
    check('bad rows dropped; long title trimmed; status normalised', r.ok && r.tasks.length === 1 && r.tasks[0].title.length === P.MAX_TITLE_LENGTH && r.tasks[0].status === 'completed', r);

    console.log('\n5b. Engy primary → secondary fallback (stubbed network)');
    const calls: string[] = [];
    const mk = (script: Record<string, { vision?: string | Error; chat?: string | Error }>) => P.createEngyImportLlm(['PRIMARY', 'SECONDARY'], {
        async vision(model) { calls.push(`vision:${model}`); const v = script[model]?.vision; if (v instanceof Error) throw v; return v ?? ''; },
        async chat(model) { calls.push(`chat:${model}`); const v = script[model]?.chat; if (v instanceof Error) throw v; return v ?? ''; }
    });
    const ok = '{"tasks":[{"title":"A"}]}';
    check('default models are qwen3.8-27b then glm-5.3-flash', P.IMPORT_MODELS.join() === 'qwen3.8-27b,glm-5.3-flash' && P.IMPORT_PRIMARY_MODEL === 'qwen3.8-27b');
    calls.length = 0;
    let t = await mk({ PRIMARY: { vision: 'table' } }).imageToText(Buffer.from('x'), 'image/png');
    check('primary works → secondary is never called', t === 'table' && calls.join() === 'vision:PRIMARY', calls);
    calls.length = 0;
    t = await mk({ PRIMARY: { vision: new Error('HTTP 503') }, SECONDARY: { vision: 'table2' } }).imageToText(Buffer.from('x'), 'image/png');
    check('primary errors → secondary answers', t === 'table2' && calls.join() === 'vision:PRIMARY,vision:SECONDARY', calls);
    calls.length = 0;
    t = await mk({ PRIMARY: { vision: '   ' }, SECONDARY: { vision: 'table3' } }).imageToText(Buffer.from('x'), 'image/png');
    check('primary returns blank → secondary answers', t === 'table3', calls);
    calls.length = 0;
    t = await mk({ PRIMARY: { vision: 'NO_TASKS' }, SECONDARY: { vision: 'table' } }).imageToText(Buffer.from('x'), 'image/png');
    check('primary says NO_TASKS → that is a real answer, secondary is NOT called', t === 'NO_TASKS' && calls.join() === 'vision:PRIMARY', calls);
    calls.length = 0;
    let rows: any = await mk({ PRIMARY: { chat: 'sorry, here you go: not json' }, SECONDARY: { chat: ok } }).structureText('x');
    check('primary returns unparseable JSON → secondary answers', rows.length === 1 && calls.join() === 'chat:PRIMARY,chat:SECONDARY', calls);
    calls.length = 0;
    rows = await mk({ PRIMARY: { chat: '```json\n' + ok + '\n```' } }).structureText('x');
    check('JSON wrapped in a code fence is tolerated', rows.length === 1 && calls.join() === 'chat:PRIMARY', calls);
    calls.length = 0;
    rows = await mk({ PRIMARY: { chat: '{"tasks":[]}' }, SECONDARY: { chat: ok } }).structureText('x');
    check('primary says "no tasks" ([]) → valid, secondary NOT called', rows.length === 0 && calls.join() === 'chat:PRIMARY', calls);
    let threw = false;
    try { await mk({ PRIMARY: { vision: new Error('a') }, SECONDARY: { vision: new Error('b') } }).imageToText(Buffer.from('x'), 'image/png'); } catch { threw = true; }
    check('both fail → throws, so the parser turns it into a friendly error', threw);
    r = await P.parseTaskImport({ kind: 'image', buffer: Buffer.from('x'), mimeType: 'image/png' }, { llm: mk({ PRIMARY: { vision: new Error('a') }, SECONDARY: { vision: new Error('b') } }), today: TODAY });
    check('end to end: both models down → friendly error value, no exception', !r.ok && !!r.error, r);

    console.log('\n6. Helpers');
    check('detect: png → image', P.detectInputKind('image/png') === 'image');
    check('detect: xlsx mime → excel', P.detectInputKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') === 'excel');
    check('detect: .xlsx filename → excel', P.detectInputKind(null, 'Tasks.XLSX') === 'excel');
    check('detect: PDF is unsupported (skipped on purpose)', P.detectInputKind('application/pdf', 'a.pdf') === null);
    check('dates: 25-Sep-26, 25 September 2026, 2026-09-25, 31/02/2026 (invalid)',
        P.findDateInText('25-Sep-26') === '2026-09-25' && P.findDateInText('25 September 2026') === '2026-09-25' &&
        P.findDateInText('2026-09-25') === '2026-09-25' && P.findDateInText('31/02/2026') === null);
    check('statuses', P.normalizeStatus('WIP') === 'in_progress' && P.normalizeStatus('In progress') === 'in_progress' &&
        P.normalizeStatus('Done') === 'completed' && P.normalizeStatus('') === 'pending' && P.normalizeStatus('blocked') === 'pending');
    check('todayInIndia uses India date (18:45 UTC on 6 Oct is already 7 Oct in IST)', P.todayInIndia(new Date('2026-10-06T18:45:00Z')) === '2026-10-07');

    console.log(failures === 0 ? '\n🎉 IMPORT PARSER STAGE 1 TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
