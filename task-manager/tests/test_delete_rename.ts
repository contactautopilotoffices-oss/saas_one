/**
 * Delete and rename a task from WhatsApp (owner request 2026-10-13) — OFFLINE: fake data, a scripted AI, recorders in place
 * of the task functions; no network, no database, no WhatsApp. Every change is previewed first and happens only after YES.
 * Run: npx tsx task-manager/tests/test_delete_rename.ts
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
    const L = await import('../brain/live');
    const { world } = await import('../brain/eval/worlds');

    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const U = (intent: string, slots: any, summary = 'x') => ({ intent, slots, summary, confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null });
    const YES = U('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Yes');
    const mk = (script: (m: string) => any, over: any = {}) => {
        const w: any = { state: null, sent: [] as string[], exec: [] as any[], ...over };
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
            buildContext: async (_e: any, _p: string, o: any) => ({ ...world('default'), pending: o.pending, recent: o.recent }),
            brain: { llm },
            exec: {
                setStatus: async (...a: any[]) => { w.exec.push(['setStatus', ...a]); }, assign: async () => {}, handOver: async () => ({ toName: '' }), readPerson: async () => null, readInsight: async () => '',
                deleteTask: async (a: string, id: string) => { if (w.deleteFails === id) throw new Error('This task repeats every working day. Unlock it first, then delete it.'); w.exec.push(['delete', a, id]); },
                renameTask: async (a: string, id: string, t: string) => { w.exec.push(['rename', a, id, t]); },
            },
            reply: async (_p: string, t: string) => { w.sent.push(t); }, audit: async () => {}, seenBefore: () => false, markSeen: () => {},
        };
        return w;
    };
    const turn = async (w: any, text: string, id: string) => { const c = await L.claimSmartChat({ topic: 'message.sender.user', data: { messages: [{ phone_number: '919999900004', id, message_type: 'text', text: { body: text } }] } }, w.io); if (c.background) await c.background(); return c; };

    console.log('\n1. Delete');
    let w = mk(m => (/delete/i.test(m) ? U('delete_tasks', { which: { all: false, numbers: [2], hints: [] } }, 'Delete task 2.') : YES));
    await turn(w, 'delete task 2', 'd1');
    check('"delete task 2" → a preview naming the task; nothing deleted yet', w.exec.length === 0 && w.state?.data?.action?.type === 'delete_tasks' && /Kone Lift AMC Renewal/.test(w.sent[0]), w.sent[0]);
    await turn(w, 'yes', 'd2');
    check('YES → deleted through the checked function', JSON.stringify(w.exec) === '[["delete","u1","t2"]]', w.exec);
    w = mk(m => (/remove/i.test(m) ? U('delete_tasks', { which: { all: false, numbers: [], hints: ['carpet'] } }, 'Remove the carpet task.') : U('answer_pending', { answer: 'no', pick: null, instruction: null }, 'No')));
    await turn(w, 'remove the carpet one', 'd3');
    check('by words ("the carpet one") → the right task', w.state?.data?.action?.taskIds?.[0] === 't1', w.state?.data?.action);
    await turn(w, 'no', 'd4');
    check('"no" → nothing deleted', w.exec.length === 0 && !w.state);
    w = mk(() => U('delete_tasks', { which: { all: false, numbers: [], hints: ['amc'] } }, 'Delete the AMC task.'));
    await turn(w, 'delete the amc task', 'd5');
    check('two tasks fit ("AMC") → asks which, never guesses', w.state?.data?.pending?.kind === 'pick' && w.exec.length === 0, w.state?.data);
    w = mk(() => U('delete_tasks', { which: { all: true, numbers: [], hints: [] } }, 'Delete everything.'));
    await turn(w, 'delete all my tasks', 'd6');
    // Owner 2026-10-15: "delete all" is now allowed, but ONLY after the full list is shown and the person replies YES.
    check('"delete all" → nothing deleted yet: the whole list is shown and waits for YES', w.state?.data?.pending?.kind === 'confirm' && w.state?.data?.action?.type === 'delete_tasks' && w.state.data.action.taskIds.length > 1 && w.exec.length === 0, w.state?.data);
    w = mk(m => (/delete/i.test(m) ? U('delete_tasks', { which: { all: false, numbers: [9], hints: [] } }, 'Delete task 9.') : YES));
    await turn(w, 'delete task 9', 'd7');
    check('a number not on the list → says so, nothing proposed', w.state?.data?.action == null && /task 9/.test(w.sent[0] + JSON.stringify(w.state)), w.sent[0]);
    w = mk(m => (/delete/i.test(m) ? U('delete_tasks', { which: { all: false, numbers: [3], hints: [] } }, 'Delete task 3.') : YES), { deleteFails: 't3' });
    await turn(w, 'delete task 3', 'd8'); await turn(w, 'yes', 'd9');
    check('a task that repeats every day → refused by the checked function, and the person is told why', w.exec.length === 0 && /repeats every working day/.test(w.sent[1]), w.sent[1]);

    console.log('\n2. Rename');
    w = mk(m => (/rename/i.test(m) ? U('rename_task', { which: { all: false, numbers: [1], hints: [] }, new_title: 'Carpet PO for Mafatlal' }, 'Rename task 1.') : YES));
    await turn(w, 'rename task 1 to Carpet PO for Mafatlal', 'r1');
    check('"rename task 1 to …" → a preview "old → new"; nothing changed yet', w.exec.length === 0 && /Carpet Installation PO/.test(w.sent[0]) && /Carpet PO for Mafatlal/.test(w.sent[0]), w.sent[0]);
    await turn(w, 'yes', 'r2');
    check('YES → renamed through the checked function', JSON.stringify(w.exec) === '[["rename","u1","t1","Carpet PO for Mafatlal"]]', w.exec);
    w = mk(() => U('rename_task', { which: { all: false, numbers: [1], hints: [] }, new_title: null }, 'Rename task 1.'));
    await turn(w, 'rename task 1', 'r3');
    check('no new name given → asks "what should the new name be?"', w.exec.length === 0 && w.state?.data?.action == null, w.state?.data);
    w = mk(() => U('rename_task', { which: { all: false, numbers: [1], hints: [] }, new_title: 'Quarterly budget review' }, 'Rename task 1.'));
    await turn(w, 'rename task 1 please', 'r4');
    check('a new name the person never said (invented by the AI) → not trusted', w.state?.data?.action == null && w.exec.length === 0, w.state?.data);

    console.log('\n3. The checked functions (same rules as the Tasks tab)');
    const ws = read('task-manager/WorkspaceService.ts');
    const rn = ws.slice(ws.indexOf('static async renameTask('), ws.indexOf('static async deleteTask('));
    check('rename: same permission rule as delete (own / below you / superuser / you gave it)', /if \(row\.assigned_by !== actor\.id\) await PermissionService\.assertCanCompleteTask\(actor\.id, row as TaskAssignment\);/.test(rn) && /requireUnlockedActor/.test(rn));
    check('rename: a repeating (locked) task is refused, like delete', /This task repeats every working day\. Unlock it first, then rename it\./.test(rn));
    check('rename: name checked (not empty, at most 200 characters) and logged', /The new name is empty/.test(rn) && /at most\)/.test(rn) && /eventType: 'task_renamed'/.test(rn));
    check('WhatsApp changes are logged as via "whatsapp"', /deleteTask\(actorId, \{ taskId, via: 'whatsapp' \}\)/.test(read('task-manager/brain/live.ts')) && /renameTask\(actorId, \{ taskId, title, via: 'whatsapp' \}\)/.test(read('task-manager/brain/live.ts')));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 DELETE / RENAME TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
