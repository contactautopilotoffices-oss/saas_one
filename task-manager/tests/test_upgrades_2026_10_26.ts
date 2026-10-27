/* eslint-disable @typescript-eslint/no-explicit-any -- stubs replace services and DTOs on purpose (same as the other brain tests) */
/**
 * Task Manager upgrades (owner 2026-10-26) — OFFLINE: fake data, a scripted AI, recorders in place of the task functions;
 * no network, no database, no WhatsApp.
 *   1. Duplicate task alert (similar titles)      2. One look on every screen (page scale)
 *   3. Attachments: file type from the bytes       4. WhatsApp: remark with "done", change date / person, follow-up,
 *                                                     duplicate warning in the preview
 * Run: npx tsx task-manager/tests/test_upgrades_2026_10_26.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    console.log('\n1. Duplicate task alert');
    const S = await import('../taskSimilarity');
    check('same words, different punctuation/fillers → similar', S.isSimilarTitle('Call vendor for quotation for pantry chairs', 'call vendor - quotation, pantry chair'));
    check('same words in another order → similar', S.isSimilarTitle('Onboarding Sanjay', 'Sanjay onboarding'));
    check('a shorter title fully inside a longer one → similar', S.isSimilarTitle('Kone lift AMC renewal', 'Kone Lift AMC Renewal for Mafatlal'));
    check('one shared word only → not similar', !S.isSimilarTitle('Update candidate tracker', 'Update tracker for Bangalore drive'));
    check('different work → not similar', !S.isSimilarTitle('Carpet Installation PO', 'Damaged Ceiling Tile Replacement'));
    check('empty / filler-only titles → never similar', !S.isSimilarTitle('', 'anything') && !S.isSimilarTitle('please do the task', 'the task please'));
    check('similarOpenTasks returns only the matching tasks', S.similarOpenTasks('Onboarding Sanjay', [{ title: 'Sanjay onboarding' }, { title: 'Vendor call' }]).length === 1);

    console.log('\n2. One look on every screen');
    const Z = await import('../../frontend/hooks/useAppZoom');
    check('phones and small tablets (< 1024px) are never scaled', Z.zoomForWidth(390) === 1 && Z.zoomForWidth(1023) === 1);
    check('a 1536px laptop (Windows 125%) gets the balanced 85% look', Z.zoomForWidth(1536) === 0.85);
    check('a 1366px laptop stops at the readable floor (80%)', Z.zoomForWidth(1366) === 0.8);
    check('a 1920px monitor is scaled the same way (1.07)', Z.zoomForWidth(1920) === 1.07);
    check('very wide screens are capped (115%)', Z.zoomForWidth(2560) === 1.15 && Z.zoomForWidth(5000) === 1.15);
    check('nonsense widths are ignored', Z.zoomForWidth(NaN) === 1);
    const moved = Z.unzoomTransform({ x: 75, y: -30, scaleX: 1, scaleY: 1 }, 0.75);
    check('a drag offset is divided back by the scale', moved.x === 100 && moved.y === -40 && moved.scaleX === 1);
    check('no scale → the offset is unchanged', Z.unzoomTransform({ x: 5, y: 6 }, 1).x === 5 && Z.unzoomTransform(null, 0.75) === null);
    const css = read('app/globals.css');
    check('full-height layouts are divided back while scaled', /html\[data-app-zoom\] \.min-h-screen \{ min-height: calc\(100vh \/ var\(--app-zoom\)\); \}/.test(css) && /html\[data-app-zoom\] \.h-screen/.test(css));
    for (const f of ['app/(dashboard)/layout.tsx', 'app/org/[orgId]/layout.tsx', 'app/property/[propertyId]/layout.tsx', 'app/procurement/page.tsx', 'app/master/page.tsx']) {
        check(`the scale is applied in ${f}`, /<AppZoom \/>/.test(read(f)));
    }
    for (const f of ['frontend/components/procurement/tasks/Board.tsx', 'frontend/components/dashboard/widgets/WidgetGrid.tsx', 'frontend/components/ops/KanbanBoard.tsx', 'frontend/components/ops/TicketFlowMap.tsx']) {
        const src = read(f);
        check(`drag-and-drop stays under the pointer in ${f.split('/').pop()}`, /<ZoomSafeDragOverlay/.test(src) && !/<DragOverlay[\s>]/.test(src));
    }

    console.log('\n3. Attachments: the real file type');
    const A = await import('../TaskAttachmentService');
    const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
    const pdf = bytes(`%PDF-1.4\n${'x'.repeat(40)}\n%%EOF`);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const docx = bytes(`PK\u0003\u0004${'\u0000'.repeat(26)}[Content_Types].xml${'\u0000'.repeat(30)}word/document.xml`);
    const fakeZip = bytes(`PK\u0003\u0004${'\u0000'.repeat(26)}word/x`);
    check('a PDF is recognised from its bytes', A.attachmentType(pdf, 'quote.pdf') === 'application/pdf');
    check('a PNG is recognised from its bytes (whatever its name says)', A.attachmentType(png, 'screenshot.jpg') === 'image/png');
    check('a Word file needs both the .docx name and Word contents', A.attachmentType(docx, 'letter.docx')?.includes('wordprocessingml') === true && A.attachmentType(docx, 'letter.xlsx') === null);
    check('anything else is refused (e.g. a script renamed to .pdf)', A.attachmentType(bytes('#!/bin/sh\necho hi\n'), 'evil.pdf') === null);
    check('a zip that only pretends to be a Word file is refused', A.attachmentType(fakeZip, 'letter.docx') === null);
    check('the saved name always ends in the real type', A.safeFileName('Salary revision.pdf.bat', 'application/pdf') === 'Salary revision.pdf.pdf');
    check('right-to-left tricks and path characters are removed', A.safeFileName('invoice‮fdp.exe', 'application/pdf') === 'invoice_fdp.pdf' && A.safeFileName('../../x.png', 'image/png') === '.._.._x.png');
    const svc = read('task-manager/TaskAttachmentService.ts');
    check('files go to a private bucket and are only handed out as 10-minute links', /ATTACHMENT_BUCKET = 'task-attachments'/.test(svc) && /LINK_SECONDS = 10 \* 60/.test(svc) && /createSignedUrl/.test(svc));
    check('only people who may see the task may attach or open its files', /assertMaySee/.test(svc) && /hierarchy\.isAbove\(actor\.id, r\.employee_id\)/.test(svc));
    // Owner 2026-10-27: a file attached by mistake can be removed — but ONLY in remove(), nowhere else
    check('storage is only ever deleted by "remove a file" (one place)', (svc.match(/\.remove\(/g) || []).length === 1 && svc.indexOf('.remove(') > svc.indexOf('static async remove('));
    const mig = read('supabase/migrations/20261026000003_task_manager_upgrades.sql');
    const sql = mig.replace(/--.*$/gm, '');   // the rollback notes are comments
    check('the migration only adds (columns, a table, a private bucket)', /ADD COLUMN IF NOT EXISTS follow_up_of/.test(sql) && /CREATE TABLE IF NOT EXISTS public\.task_attachments/.test(sql) && /'task-attachments', 'task-attachments', false/.test(sql) && !/\b(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+public)\b/i.test(sql));

    console.log('\n4. WhatsApp');
    const L = await import('../brain/live');
    const { world } = await import('../brain/eval/worlds');
    const base = world('default');
    const GIVEN = [{ id: 'g1', title: 'Onboarding', ownerId: 'u2', ownerName: 'Vidya Nair', date: base.today }];
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const U = (intent: string, slots: any, summary = 'x') => ({ intent, slots, summary, confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null });
    const YES = U('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Yes');
    const mk = (script: (m: string) => any, extra: Record<string, unknown> = {}) => {
        const w: any = { state: null, sent: [] as string[], exec: [] as any[] };
        const llm = { complete: async (req: any) => {
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) {
                const need = (u.placeholders || []).filter((x: any) => x.required).map((x: any) => x.name).join(' ');
                return { text: JSON.stringify({ text: `Okay: ${need}${u.mustEndWithQuestion ? ' Shall I?' : ''}` }), tokensIn: 1, tokensOut: 1 };
            }
            return { text: JSON.stringify(script(u.message)), tokensIn: 1, tokensOut: 1 };
        } };
        w.io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp,
            checkAccess: async () => ({ allowed: true }), facilityActive: async () => false, openPingPending: async () => null,
            getState: async () => w.state, setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; }, clearState: async () => { w.state = null; },
            buildContext: async (_e: any, _p: string, o: any) => ({ ...world('default'), noteTargets: GIVEN, ...extra, pending: o.pending, recent: o.recent }),
            brain: { llm },
            exec: {
                setStatus: async (...a: any[]) => { w.exec.push(['setStatus', ...a.slice(0, 3)]); },
                assign: async (_a: string, i: any) => { w.exec.push(['assign', i.targetUserId, i.title, i.followUpOf ?? null]); },
                handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '',
                addNote: async (a: string, id: string, note: string, opts: any) => { w.exec.push(['note', a, id, note, !!opts?.tellGiver]); },
                changeTask: async (a: string, id: string, c: any) => { w.exec.push(['change', a, id, c]); },
                answerRequest: async (a: string, id: string, accept: boolean, why: string | null) => { w.exec.push(['answer', a, id, accept, why]); },
            },
            reply: async (_p: string, t: string) => { w.sent.push(t); }, audit: async () => {}, seenBefore: () => false, markSeen: () => {},
        };
        return w;
    };
    let n = 0;
    const turn = async (w: any, text: string) => { const c = await L.claimSmartChat({ topic: 'message.sender.user', data: { messages: [{ phone_number: '919999900004', id: `m${++n}`, message_type: 'text', text: { body: text } }] } }, w.io); if (c.background) await c.background(); return c; };
    const yesIfAsked = async (w: any) => { if (w.state?.data?.pending?.kind === 'confirm') await turn(w, 'yes'); };

    // a. remark with "done"
    let w = mk(m => (/done/i.test(m) ? U('complete_tasks', { which: { all: false, numbers: [1], hints: [] }, note: 'shared the PO with the vendor' }, 'Done 1.') : YES));
    await turn(w, 'done 1: shared the PO with the vendor', ); await yesIfAsked(w);
    check('"done 1: …" → task 1 marked done', w.exec.some((e: any[]) => e[0] === 'setStatus' && e[2] === 't1' && e[3] === 'completed'), w.exec);
    check('…and the remark saved on it, telling the giver', w.exec.some((e: any[]) => e[0] === 'note' && e[2] === 't1' && e[3] === 'shared the PO with the vendor' && e[4] === true), w.exec);
    w = mk(m => (/done/i.test(m) ? U('complete_tasks', { which: { all: false, numbers: [1], hints: [] }, note: 'vendor confirmed delivery by Friday' }, 'Done 1.') : YES));
    await turn(w, 'done 1'); await yesIfAsked(w);
    check('a remark the person never wrote (invented by the AI) → nothing done', !w.exec.some((e: any[]) => e[0] === 'note'), w.exec);

    // b. change date / person of a task they gave
    w = mk(m => (/move/i.test(m) ? U('change_task', { which: { all: false, numbers: [], hints: ['onboarding'] }, person: 'Vidya', date: '2026-10-30', to: 'Harsh' }, 'Move Vidya\'s onboarding.') : YES));
    await turn(w, 'move Vidya onboarding task to 30 Oct and give it to Harsh');
    check('"move Vidya\'s onboarding … give it to Harsh" → a preview first, nothing changed yet', w.exec.length === 0 && w.state?.data?.action?.type === 'change_task' && /Onboarding/.test(w.sent[0] ?? ''), { sent: w.sent, state: w.state?.data });
    await turn(w, 'yes');
    check('YES → changed through the checked function (new date and person)', JSON.stringify(w.exec) === JSON.stringify([['change', 'u1', 'g1', { date: '2026-10-30', toId: 'u4' }]]), w.exec);
    w = mk(() => U('change_task', { which: { all: false, numbers: [], hints: ['onboarding'] }, person: null, date: null, to: null }, 'Change onboarding.'));
    await turn(w, 'change the onboarding task');
    check('no new date or person given → asks, nothing changed', w.exec.length === 0 && w.state?.data?.action == null, w.state?.data);
    w = mk(() => U('change_task', { which: { all: false, numbers: [], hints: ['onboarding'] }, person: null, date: null, to: 'Neha' }, 'Give onboarding to Neha.'));
    await turn(w, 'give the onboarding task to Neha instead');
    check('a person they may not give work to → refused, nothing changed', w.exec.length === 0 && w.state?.data?.action == null, w.state?.data);

    // c. follow-up
    w = mk(m => (/follow/i.test(m) ? U('create_tasks', { assignee: 'me', tasks: [{ title: 'collect the signed contract', details: null }], date: null, follow_up: { numbers: [2], hints: [] } }, 'Follow-up of task 2.') : YES));
    await turn(w, 'follow up on task 2: collect the signed contract'); await yesIfAsked(w);
    check('"follow up on task 2: …" → the new task is linked to task 2', JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'collect the signed contract', 't2']]), w.exec);

    // d. duplicate warning
    w = mk(m => (/assign/i.test(m) ? U('create_tasks', { assignee: 'Vidya', tasks: [{ title: 'Onboarding', details: null }], date: null }, 'Assign Vidya onboarding.') : YES));
    await turn(w, 'assign Vidya onboarding');
    check('a similar open task already given to that person → always asks first, with the warning', w.exec.length === 0 && w.state?.data?.pending?.kind === 'confirm' && /similar open task/i.test(w.sent[0] ?? ''), { sent: w.sent, state: w.state?.data });
    await turn(w, 'yes');
    check('…YES still adds it', JSON.stringify(w.exec) === JSON.stringify([['assign', 'u2', 'Onboarding', null]]), w.exec);

    // e. answer a support request from another department (owner 2026-10-26)
    const REQ = { supportRequests: [{ id: 'r1', title: 'Share payroll variance sheet', fromName: 'Roohi Idrishi', fromDepartment: 'Human Resources' }] };
    w = mk(m => (/kar dunga/i.test(m) ? U('answer_request', { which: { all: false, numbers: [], hints: [] }, decision: 'accept', reason: null }, 'Accepts.') : YES), REQ);
    await turn(w, 'haan kar dunga');
    check('"haan kar dunga" → a preview first, nothing answered yet', w.exec.length === 0 && w.state?.data?.action?.type === 'answer_request', w.state?.data);
    await turn(w, 'yes');
    check('YES → accepted through the checked function', JSON.stringify(w.exec) === JSON.stringify([['answer', 'u1', 'r1', true, null]]), w.exec);
    w = mk(m => (/can't/i.test(m) ? U('answer_request', { which: { all: false, numbers: [], hints: [] }, decision: 'decline', reason: 'payroll is with the vendor' }, 'Declines.') : YES), REQ);
    await turn(w, "can't, payroll is with the vendor"); await turn(w, 'yes');
    check('"can\'t, payroll is with the vendor" → declined with their reason', JSON.stringify(w.exec) === JSON.stringify([['answer', 'u1', 'r1', false, 'payroll is with the vendor']]), w.exec);
    // Owner 2026-10-27: the reason is optional — "Can't do it" (the template's button) is confirmed once and sent without one
    w = mk(m => (/can't do it/i.test(m) ? U('answer_request', { which: { all: false, numbers: [], hints: [] }, decision: 'decline', reason: null }, 'Declines.') : YES), REQ);
    await turn(w, "Can't do it");
    check('"Can not do it" with no reason → nothing sent yet, one YES asked', w.exec.length === 0 && w.state?.data?.action != null, w.state?.data);
    await turn(w, 'yes');
    check('…and after YES the request is declined without a reason', JSON.stringify(w.exec) === JSON.stringify([['answer', 'u1', 'r1', false, null]]), w.exec);
    w = mk(() => U('answer_request', { which: { all: false, numbers: [], hints: [] }, decision: 'decline', reason: 'the vendor has not paid' }, 'Declines.'), REQ);
    await turn(w, "can't do it");
    check('a reason the person never wrote → not trusted, nothing sent', w.exec.length === 0 && w.state?.data?.action == null, w.state?.data);
    w = mk(() => U('answer_request', { which: { all: false, numbers: [], hints: [] }, decision: 'accept', reason: null }, 'Accepts.'));
    await turn(w, 'accept');
    check('nothing waiting → nothing answered', w.exec.length === 0 && w.state?.data?.action == null, w.state?.data);

    console.log('\n5. AI duplicate check (second pass after the word check)');
    const AI = await import('../aiDuplicate');
    const fake = (reply: string | Error, delayMs = 0) => ({ complete: async () => { if (delayMs) await new Promise(r => setTimeout(r, delayMs)); if (reply instanceof Error) throw reply; return { text: reply, tokensIn: 1, tokensOut: 1 }; } });
    const open = ['Onboarding - Sanjay', 'Call vendor for chair quotation'];
    check('the model says #2 → the second open task', await AI.aiSameTask(fake('{"reasoning":"same","match":2}'), 'Get quote from supplier for chairs', open) === 1);
    check('the model says null → no match', await AI.aiSameTask(fake('{"reasoning":"different","match":null}'), 'Order chairs', open) === null);
    check('a number outside the list → no match', await AI.aiSameTask(fake('{"match":7}'), 'x', open) === null);
    check('nonsense → no match', await AI.aiSameTask(fake('I think maybe'), 'x', open) === null);
    check('every model failing → no match (never blocks)', await AI.aiSameTask(fake(new Error('down')), 'x', open) === null);
    const t0 = Date.now();
    check('a slow model is cut off → no match', await AI.aiSameTask(fake('{"match":1}', 9000), 'x', open, ['m1']) === null && Date.now() - t0 < 6000);
    check('it can be switched off', AI.aiDuplicateEnabled({ TASK_AI_DUPLICATE_CHECK: 'off' }) === false && AI.aiDuplicateEnabled({}) === true);
    const wsSrc = read('task-manager/WorkspaceService.ts');
    check('the AI is asked only when the word check finds nothing', wsSrc.includes('const hit = similarOpenTasks(title, p.open)[0];') && wsSrc.includes('else if (p.open.length) rest.push(p)'));

    console.log('\n6. Cross-department collaboration rules');
    const cs = read('task-manager/CollaborationService.ts');
    check('only people in OTHER departments, never superusers, never yourself', cs.includes("e.role !== 'superuser'") && cs.includes('e.department_id !== actor.department_id') && cs.includes('e.id !== actor.id'));
    check('only people who use the Task Manager (unlocked)', cs.includes('TaskAccessService.partition(others, snapshot)'));
    check('a support request waits: only the receiver answers, and only once (conditional claim)', cs.includes('req.to_user_id !== actor.id') && cs.includes(".eq('state', 'awaiting').select('id').maybeSingle()"));
    check('declining: the reason is optional (owner 2026-10-27); the answer goes back to the sender in the app', cs.includes('Please keep the reason short') && cs.includes("can't take your request"));
    check("the receiver's manager is not told", !cs.includes('reporting_manager_id'));
    check('reminders only for tasks you gave to other departments', cs.includes('t.assigned_by === actor.id && !!holder?.department_id && holder.department_id !== actor.department_id'));
    const tv = read('frontend/components/procurement/tasks/TaskView.tsx');
    check('"Create follow-up" closes the task window first, so the new window is on top', tv.includes('onClick={() => { onClose(); actions.onFollowUp!(task); }}'));
    check('Edit has the Files section too', tv.includes('listFiles && <FilesSection taskId={task.id}'));

    console.log('\n7. The server keeps the rules');
    const ws = read('task-manager/WorkspaceService.ts');
    const edit = ws.slice(ws.indexOf('static async editTask('), ws.indexOf('static async findDuplicates('));
    check('edit: only the giver or a superuser, and a new person is checked like a new task', /row\.assigned_by !== actor\.id && actor\.role !== 'superuser'/.test(edit) && /assertCanAssignTask\(actor\.id, input\.targetUserId\)/.test(edit) && /TaskAccessService\.check/.test(edit));
    check('edit: fields not sent stay as they are (WhatsApp changes only date / person)', /keepTitle = input\.title === undefined/.test(edit) && /keepDetails \?/.test(edit));
    check('edit: a finished task cannot move to someone else', /already done, so it cannot move to someone else/.test(edit));
    check('the duplicate check never reveals a task title the person may not see', /title: mayRead \? hit\.title : null/.test(ws));
    check('WhatsApp changes are logged as via "whatsapp"', /editTask\(actorId, \{ taskId, date: change\.date, targetUserId: change\.toId, via: 'whatsapp' \}\)/.test(read('task-manager/brain/live.ts')));

    console.log('\n8. Removing a file attached by mistake (owner 2026-10-27)');
    const att = read('task-manager/TaskAttachmentService.ts');
    const rm = att.slice(att.indexOf('static async remove('));
    check('remove: only whoever attached it, or a superuser', /row\.uploaded_by !== actor\.id && actor\.role !== 'superuser'/.test(rm));
    check('remove: same visibility check as listing (task or request)', /assertMaySee\(actor, \[row\.task_id as string\]\)/.test(rm) && /requestFor\(actor,/.test(rm));
    check('remove: the stored file goes only when no other copy lists it', /\.eq\('storage_path', row\.storage_path\)/.test(rm) && /\(count \?\? 0\) === 0/.test(rm));
    check('remove: logged in the audit trail', /task_attachment_removed/.test(rm));
    check('the delete button shows only on files the server marks canDelete', /removeFile && f\.canDelete/.test(read('frontend/components/procurement/tasks/TaskView.tsx')));
    check('the route takes WHO from the session', /export async function DELETE[\s\S]*sessionUserId\(\)/.test(read('app/api/task-manager/attachments/route.ts')));

    const respondSrc = read('task-manager/CollaborationService.ts');
    check('server: a decline without a reason is accepted (only a too-long reason is refused)', /if \(!input\.accept && reason\.length > 300\)/.test(respondSrc) && /decline_reason: reason \|\| null/.test(respondSrc));
    check('website: "Send" works with the reason box empty', /disabled=\{busy === r\.id\} onClick=\{\(\) => void answer\(r\.id, false\)\}/.test(read('frontend/components/procurement/tasks/CrossDeptPanel.tsx')));

    console.log('\n9. "Work with other departments" switch, and no grey example text (owner 2026-10-27)');
    const xsql = read('supabase/migrations/20261027000002_task_manager_cross_department_switch.sql');
    check('migration: one column, ON by default, additive', /ADD COLUMN IF NOT EXISTS cross_dept_collab BOOLEAN NOT NULL DEFAULT true/.test(xsql) && !/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im.test(xsql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')));
    const collabSrc = read('task-manager/CollaborationService.ts');
    check('OFF: nobody to send to, and people in an OFF department are never offered', /if \(!\(await this\.enabledFor\(actor\)\)\) return \[\];/.test(collabSrc) && /on\(e\.department_id\)\)/.test(collabSrc));
    check('OFF: sending and the duplicate check are refused by the server', /You cannot send work to other departments/.test(collabSrc));
    check('OFF: answering a request already waiting still works (respond does not use the switch)', !/enabledFor/.test(collabSrc.slice(collabSrc.indexOf('static async respond('), collabSrc.indexOf('static async respond(') + 2500)));
    const accessSrc = read('task-manager/TaskAccessService.ts');
    check('before the SQL file everyone counts as ON; any other read problem = OFF (fail closed)', /allOff: !missing/.test(accessSrc) && /'cross_dept_collab'\] as const/.test(accessSrc));
    const tab = read('frontend/components/procurement/ProcurementTasksTab.tsx');
    check('Send tab: the other-departments side follows the switch', /const crossDeptOn = collab\.data\?\.enabled !== false/.test(tab) && /superCollab && crossDeptOn/.test(tab));
    check('Control Center: a "Work with other departments" switch', /label: 'Work with other departments'/.test(read('frontend/components/task-manager/TaskAccessPanel.tsx')));
    // Owner 2026-10-27 (b): WHO in a department may send — "Everyone" (default) or "Only selected people" (ticked)
    const psql = read('supabase/migrations/20261027000003_task_manager_cross_department_people.sql');
    check('migration: "everyone" by default, a CHECK on the value, a new table with row level security', /cross_dept_scope TEXT NOT NULL DEFAULT 'everyone'/.test(psql) && /CHECK \(cross_dept_scope IN \('everyone', 'selected'\)\)/.test(psql) && /task_manager_cross_dept_people ENABLE ROW LEVEL SECURITY/.test(psql));
    const may = accessSrc.slice(accessSrc.indexOf('static async maySendCrossDept('), accessSrc.indexOf('static async setCrossDeptScope('));
    check('may send = department ON and (everyone, or ticked); a read problem = nobody', /cross\.off\.has\(person\.department_id\) \|\| scope\.failClosed\) return false/.test(may) && /!scope\.selected\.has\(person\.department_id\) \|\| scope\.allowed\.has\(person\.id\)/.test(may));
    check('sending checks the person; RECEIVING only checks the other department (not the ticks)', /if \(!\(await this\.enabledFor\(actor\)\)\) return \[\];/.test(collabSrc) && /return TaskAccessService\.maySendCrossDept\(actor\)/.test(collabSrc) && /e\.department_id !== actor\.department_id && on\(e\.department_id\)\)/.test(collabSrc));
    check('before the SQL file: everyone (as today)', /failClosed: !missing/.test(accessSrc));
    const routeSrc = read('app/api/task-manager/access/route.ts');
    check('the Control Center route saves the choice and the ticks (admin-only, like every action there)', /action === 'set_cross_dept_scope'/.test(routeSrc) && /action === 'set_cross_dept_person'/.test(routeSrc) && /requireControlCentre/.test(routeSrc));
    const panelSrc = read('frontend/components/task-manager/TaskAccessPanel.tsx');
    check('Control Center: "Everyone / Only selected people" and a tick per person', /'Only selected people'/.test(panelSrc) && /Can send to other departments/.test(panelSrc));
    const tmFiles = ['AssignedView', 'Board', 'CrossDeptPanel', 'RemarkDialog', 'SuperuserPanel', 'TaskDialog', 'TaskView'].map(n => read(`frontend/components/procurement/tasks/${n}.tsx`));
    const leftover = tmFiles.join('\n').match(/placeholder=(?:"[^"]*"|\{`[^`]*`\})/g) || [];
    check('Task Manager screens: no grey example text left (search boxes keep their hint)', leftover.every(p => /Search/.test(p)), leftover);

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 UPGRADE TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
