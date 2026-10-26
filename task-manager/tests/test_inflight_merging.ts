/**
 * Test for Zero-Delay In-Flight Merging of rapid follow-up messages.
 * Run: npx tsx task-manager/tests/test_inflight_merging.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import * as L from '../brain/live';
import * as F from '../brain/frontDoor';
import type { BrainContext, BrainTask } from '../brain/types';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => {
    if (ok) console.log(`  ✓ ${n}`);
    else { failures++; console.error(`  ✗ ${n}`, x ?? ''); }
};

const PHONE = '918433649199';
const emp: any = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' };
const body = (text: string, id: string) => ({
    topic: 'message.sender.user',
    data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] }
});

function makeHarness(initialTasks: BrainTask[]) {
    let tasks = [...initialTasks];
    const sent: string[] = [];
    const exec: any[] = [];
    let state: any = null;

    const io: any = {
        getSmartChatDepartments: async () => new Set(['d1']),
        getConfig: async () => ({ enabled: false, employees: [] }),
        getEmployee: async () => emp,
        checkAccess: async () => ({ allowed: true }),
        facilityActive: async () => false,
        getState: async () => state,
        setState: async (_p: string, s: any) => { state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
        clearState: async () => { state = null; },
        frontDoorOn: async () => true,
        teamReportsOn: async () => false,
        buildContext: async (_e: any, _p: string, opts: any): Promise<BrainContext> => ({
            today: '2026-10-18',
            sender: { id: 'u1', name: 'Priyanka Shah', role: 'employee', department: 'Procurement' },
            tasks: tasks.map(t => ({ ...t })),
            people: [{ id: 'u1', name: 'Priyanka Shah', role: 'employee', department: 'Procurement' }],
            assignableIds: ['u1'],
            departments: ['Procurement'],
            pending: opts.pending,
            recent: opts.recent,
        }),
        brain: {
            llm: {
                complete: async () => { throw new Error('LLM should not be called for exact commands'); }
            }
        },
        exec: {
            setStatus: async (actorId: string, taskId: string, status: any) => {
                exec.push(['setStatus', actorId, taskId, status]);
                const t = tasks.find(x => x.id === taskId);
                if (t) t.status = status;
            },
            notifyCompleted: async () => {},
        },
        undo: {
            currentStatus: async (taskId: string) => tasks.find(t => t.id === taskId)?.status ?? null,
            setStatus: async (actorId: string, taskId: string, status: any) => {
                exec.push(['undo', actorId, taskId, status]);
                const t = tasks.find(x => x.id === taskId);
                if (t) t.status = status;
            },
            findCreated: async () => null,
            deleteTask: async () => {},
        },
        reply: async (_p: string, t: string) => { sent.push(t); },
        audit: async () => {},
        seenBefore: () => false,
        markSeen: () => {},
    };

    return {
        io,
        getSent: () => sent,
        getExec: () => exec,
        getState: () => state,
        getTasks: () => tasks,
    };
}

async function runTests() {
    console.log('\n--- 1. Two rapid messages in a burst ("done 1" + "done 2") ---');
    L.resetInFlightQueues();
    const tasks1: BrainTask[] = [
        { id: 't1', title: 'Carpet PO', status: 'pending', n: 1 },
        { id: 't2', title: 'Vendor Call', status: 'pending', n: 2 },
    ];
    const h1 = makeHarness(tasks1);

    // Message 1 arrives
    const claim1 = await L.claimSmartChat(body('done 1', 'msg-1'), h1.io);
    check('claim 1 handled', claim1.handled === true && typeof claim1.background === 'function');

    // Message 1 background begins
    const bg1Promise = claim1.background!();

    // Message 2 arrives almost immediately while Message 1 is running
    const claim2 = await L.claimSmartChat(body('done 2', 'msg-2'), h1.io);
    check('claim 2 captured by in-flight queue without starting separate runner', claim2.handled === true && !claim2.background);

    // Wait for the combined background runner to complete
    await bg1Promise;

    const sent1 = h1.getSent();
    check('only ONE combined reply was sent via WhatsApp', sent1.length === 1, sent1);
    check('combined reply includes summary for task 1', /Carpet PO/.test(sent1[0]), sent1[0]);
    check('combined reply includes summary for task 2', /Vendor Call/.test(sent1[0]), sent1[0]);
    check('only ONE undo hint is present at the end', (sent1[0].match(/Reply \*undo\* within 10 minutes/g) || []).length === 1, sent1[0]);

    // Check that both tasks were marked completed
    check('both tasks marked completed in database',
        h1.getTasks().find(t => t.id === 't1')?.status === 'completed' &&
        h1.getTasks().find(t => t.id === 't2')?.status === 'completed'
    );

    // Now test Undo on the merged burst
    console.log('\n--- 2. "undo" reverses both tasks from the merged burst ---');
    const claimUndo = await L.claimSmartChat(body('undo', 'msg-3'), h1.io);
    if (claimUndo.background) await claimUndo.background();

    check('undo sent a reply', sent1.length === 2);
    check('undo reversed task 1', /Carpet PO → back to to do/.test(sent1[1]), sent1[1]);
    check('undo reversed task 2', /Vendor Call → back to to do/.test(sent1[1]), sent1[1]);
    check('both tasks restored in database',
        h1.getTasks().find(t => t.id === 't1')?.status === 'pending' &&
        h1.getTasks().find(t => t.id === 't2')?.status === 'pending'
    );

    console.log('\n--- 3. Rapid message with non-existent task ("done 1" + "done task 2" with only 1 task) ---');
    L.resetInFlightQueues();
    const tasks3: BrainTask[] = [
        { id: 't1', title: 'Single Task', status: 'pending', n: 1 },
    ];
    const h3 = makeHarness(tasks3);

    const c1 = await L.claimSmartChat(body('done 1', 'm-1'), h3.io);
    const bgPromise3 = c1.background!();

    const c2 = await L.claimSmartChat(body('done task 2', 'm-2'), h3.io);
    check('c2 queued into in-flight', c2.handled === true && !c2.background);

    await bgPromise3;

    const sent3 = h3.getSent();
    check('only ONE reply sent', sent3.length === 1, sent3);
    check('marked task 1 done', /Single Task/.test(sent3[0]), sent3[0]);
    check('includes clear note that task 2 was not found', /Task 2 was not found on your open tasks list/.test(sent3[0]), sent3[0]);

    console.log('\n--- 4. Single message (zero latency / no merge) ---');
    L.resetInFlightQueues();
    const tasks4: BrainTask[] = [
        { id: 't1', title: 'Solo Task', status: 'pending', n: 1 },
    ];
    const h4 = makeHarness(tasks4);
    const cSolo = await L.claimSmartChat(body('done 1', 'solo-1'), h4.io);
    if (cSolo.background) await cSolo.background();
    const sent4 = h4.getSent();
    check('single message reply works as normal', sent4.length === 1 && /Solo Task/.test(sent4[0]));

    if (failures === 0) {
        console.log('\n🎉 ALL IN-FLIGHT MERGING TESTS PASSED SAFELY!\n');
    } else {
        console.error(`\n❌ ${failures} TEST(S) FAILED.\n`);
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal error in tests:', err);
    process.exit(1);
});
