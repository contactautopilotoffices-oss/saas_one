/**
 * Carry forward / pending / completed sections (owner 2026-10-16) — 100% OFFLINE: fake data only, no network, no database,
 * no WhatsApp. Covers the "tasks" reply, the employee's midday check-in (chat + template line), the team summary (chat +
 * template line), and the numbered list keeping carried-forward tasks finished today.
 * Run: npx tsx task-manager/tests/test_sections_carry_forward.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const T = await import('../brain/text');
    const { buildNumberedList, isCompletedOn } = await import('../TaskDatabaseService');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const { planExact } = await import('../brain/frontDoor');
    const A = await import('../taskAlerts');

    // ── 1. the shared sections ──────────────────────────────────────────────
    console.log('\n1. Sections: carry forward → pending today → completed');
    const items = [
        { carried: true, done: false, line: '1. Fix login bug (from 13 Oct) ⏳' },
        { carried: true, done: false, line: '2. Update API docs (from 14 Oct) 🔄' },
        { carried: false, done: true, line: '3. Review PR ✅' },
        { carried: false, done: false, line: '4. Write test cases ⏳' },
        { carried: true, done: true, line: '5. Update vendor sheet (from 12 Oct) ✅' },
    ];
    const s = T.sectionedList(items);
    check('order is Carry forward, Pending today, Completed, with counts',
        s === '🔄 *Carry forward* (2)\n1. Fix login bug (from 13 Oct) ⏳\n2. Update API docs (from 14 Oct) 🔄\n\n⏳ *Pending today* (1)\n4. Write test cases ⏳\n\n✅ *Completed* (2)\n3. Review PR ✅\n5. Update vendor sheet (from 12 Oct) ✅', s);
    check('a carried-forward task finished today goes under Completed (not Carry forward)', s.split('✅ *Completed*')[1].includes('5. Update vendor sheet'));
    check('empty sections are left out', T.sectionedList([{ carried: false, done: false, line: '1. A ⏳' }]) === '⏳ *Pending today* (1)\n1. A ⏳');
    const one = T.sectionedOneLine(items);
    check('one line for templates: labelled groups, no line breaks', one === 'Carry forward: 1. Fix login bug (from 13 Oct) ⏳ | 2. Update API docs (from 14 Oct) 🔄 — Pending today: 4. Write test cases ⏳ — Completed: 3. Review PR ✅ | 5. Update vendor sheet (from 12 Oct) ✅' && !one.includes('\n'), one);
    const long = T.sectionedOneLine(Array.from({ length: 40 }, (_, i) => ({ carried: false, done: false, line: `${i + 1}. A fairly long task title number ${i + 1} ⏳` })), 300);
    check('a long one-line list is cut under the limit with "…and N more"', long.length <= 320 && /…and \d+ more$/.test(long), long.length);

    // ── 2. the numbered list keeps carried-forward tasks finished today ────
    console.log('\n2. The numbered list: a carried-forward task finished today stays (numbers stable)');
    const mk = (id: string, title: string, assigned_date: string, status: string, completed_at: string | null = null, created_at = `${assigned_date}T04:00:00Z`) =>
        ({ id, title, assigned_date, status, completed_at, created_at, employee_id: 'u1' }) as any;
    const today = [mk('t3', 'Review PR', '2026-10-16', 'completed', '2026-10-16T06:00:00Z'), mk('t4', 'Write test cases', '2026-10-16', 'pending')];
    const earlier = [
        mk('c1', 'Fix login bug', '2026-10-13', 'pending'),
        mk('c2', 'Update vendor sheet', '2026-10-14', 'completed', '2026-10-16T05:00:00Z'),   // 10:30 IST today
        mk('c3', 'Old finished', '2026-10-12', 'completed', '2026-10-15T12:00:00Z'),          // yesterday
    ];
    const before = buildNumberedList(today, earlier);
    check('without a day given: exactly the old list (finished carried tasks drop out)', before.map(t => t.id).join() === 'c1,t3,t4', before.map(t => t.id));
    const after = buildNumberedList(today, earlier, '2026-10-16');
    check('with the day: the carried task finished TODAY stays (marked done); one finished yesterday still drops out',
        after.map(t => `${t.listNumber}:${t.id}`).join() === '1:c1,2:c2,3:t3,4:t4', after.map(t => `${t.listNumber}:${t.id}`));
    const morning = buildNumberedList(today.map(t => ({ ...t, status: 'pending', completed_at: null })), earlier.map(t => t.id === 'c2' ? { ...t, status: 'pending', completed_at: null } : t), '2026-10-16');
    check('numbers do not move after finishing a carried task: "Write test cases" is 4 in the morning and still 4 after',
        morning.find(t => t.id === 't4')?.listNumber === 4 && after.find(t => t.id === 't4')?.listNumber === 4);
    check('India-time day: 00:10 IST counts as today, 23:50 IST the day before does not',
        isCompletedOn({ status: 'completed', completed_at: '2026-10-15T18:40:00Z' }, '2026-10-16') && !isCompletedOn({ status: 'completed', completed_at: '2026-10-15T18:20:00Z' }, '2026-10-16'));
    check('an open task is never "completed on" a day', !isCompletedOn({ status: 'pending', completed_at: null }, '2026-10-16'));

    // ── 3. the "tasks" reply ──────────────────────────────────────────────────
    console.log('\n3. "tasks" reply');
    const ctx: any = {
        today: '2026-10-16', sender: { id: 'u1', name: 'Harsh Patil', department: 'Tech', role: 'employee' }, people: [], assignableIds: [], departments: [], pending: null,
        tasks: [
            { n: 1, id: 'c1', title: 'Fix login bug', status: 'pending', from: '2026-10-13' },
            { n: 2, id: 'c4', title: 'Update API docs', status: 'in_progress', from: '2026-10-14' },
            { n: 3, id: 't3', title: 'Review PR', status: 'completed' },
            { n: 4, id: 't4', title: 'Write test cases', status: 'pending' },
            { n: 5, id: 'c2', title: 'Update vendor sheet', status: 'completed', from: '2026-10-12' },
        ],
    };
    const view: any = planExact({ kind: 'view' } as any, ctx);
    check('three sections in the recommended order, numbers kept',
        view?.kind === 'reply' && view.text === '📋 *Your tasks today*\n\n🔄 *Carry forward* (2)\n1. Fix login bug (from 13 Oct) ⏳\n2. Update API docs (from 14 Oct) 🔄\n\n⏳ *Pending today* (1)\n4. Write test cases ⏳\n\n✅ *Completed* (2)\n3. Review PR ✅\n5. Update vendor sheet (from 12 Oct) ✅\n\nReply *done 1* when you finish task 1.', view?.text);
    const allDone: any = planExact({ kind: 'view' } as any, { ...ctx, tasks: ctx.tasks.map((t: any) => ({ ...t, status: 'completed' })) });
    check('everything done → only Completed, and "All done for today ✅"', allDone.text.includes('✅ *Completed* (5)') && !allDone.text.includes('Carry forward') && allDone.text.endsWith('All done for today ✅'));

    // ── 4. the employee's midday check-in ────────────────────────────────────
    console.log('\n4. Midday check-in (chat and template)');
    const list: any[] = [
        { id: 'c1', title: 'Fix login bug', status: 'pending', assigned_date: '2026-10-13', isCarriedForward: true, listNumber: 1 },
        { id: 'c4', title: 'Update API docs', status: 'in_progress', assigned_date: '2026-10-14', isCarriedForward: true, listNumber: 2 },
        { id: 't3', title: 'Review PR', status: 'completed', assigned_date: '2026-10-16', isCarriedForward: false, listNumber: 3 },
        { id: 't4', title: 'Write test cases', status: 'pending', assigned_date: '2026-10-16', isCarriedForward: false, listNumber: 4 },
        { id: 'c2', title: 'Update vendor sheet', status: 'completed', assigned_date: '2026-10-12', isCarriedForward: true, listNumber: 5 },
    ];
    const midday = TaskNotificationService.buildChatMessage({ ruleType: 'pending_reminder' } as any, 'Harsh Patil', list, '2026-10-16');
    check('chat: greeting, three sections, then the reply hint with the first open number',
        midday === 'Hi Harsh! ⏳ Midday check-in\n\n🔄 *Carry forward* (2)\n1. Fix login bug (from 13 Oct) ⏳\n2. Update API docs (from 14 Oct) 🔄\n\n⏳ *Pending today* (1)\n4. Write test cases ⏳\n\n✅ *Completed* (2)\n3. Review PR ✅\n5. Update vendor sheet (from 12 Oct) ✅\n\nReply "done 1" when you finish a task, or "tasks" to see your full list.', midday);
    const doneMidday = TaskNotificationService.buildChatMessage({ ruleType: 'pending_reminder' } as any, 'Harsh Patil', list.map(t => ({ ...t, status: 'completed' })), '2026-10-16');
    check('chat: all done → the existing "completed all" line', doneMidday === 'Hi Harsh! 🌟 You have completed all your tasks for today. Great work!');
    const tpl = TaskNotificationService.buildTemplateTaskParam('pending_reminder', list);
    check('template: the same grouping on ONE line with real marks', tpl === 'Carry forward: 1. Fix login bug ⏳ | 2. Update API docs 🔄 — Pending today: 4. Write test cases ⏳ — Completed: 3. Review PR ✅ | 5. Update vendor sheet ✅' && !tpl.includes('\n'), tpl);
    const morningTpl = TaskNotificationService.buildTemplateTaskParam('morning_digest', list);
    check('the morning template line is unchanged (still "Carry forward: … — Today: …")', morningTpl.startsWith('Carry forward: 1. Fix login bug ⏳') && morningTpl.includes(' — Today: '), morningTpl);

    // ── 5. the team summary ──────────────────────────────────────────────────
    console.log('\n5. Team summary (chat and template)');
    const input = {
        recipientName: 'Lohitaksha Ranganathan', scope: 'Tech Department', date: '2026-10-15', members: 3, completed: 3, pending: 1,
        rows: [
            { label: 'Harsh Patil', done: 0, total: 0, carriedDone: 2, carriedPending: 1 },
            { label: 'Lohitaksha Ranganathan', done: 1, total: 1, carriedDone: 0, carriedPending: 0 },
            { label: 'Sahil Gorde', done: 2, total: 3, carriedDone: 0, carriedPending: 1 },
        ],
    };
    const chat = A.teamDigestChat({ ...input, rowsArePeople: true });
    check('chat: the approved layout (Completed / Pending split into Today and Carried forward, then Today\'s Team Status)',
        chat === "📊 Daily Team Progress Summary\n\nHello Lohitaksha,\n\nHere is today's task completion summary for Tech Department:\n\n📅 Date: 15 Oct 2026\n👥 Total Members: 3\n\n✅ Completed\n• Today: 3 (Lohitaksha 1, Sahil 2)\n• Carried forward: 2 (Harsh 2)\n\n⏳ Pending\n• Today: 1 (Sahil 1)\n• Carried forward: 2 (Harsh 1, Sahil 1)\n\n📋 Today's Team Status:\n• Harsh Patil: 0/0 Done (no tasks)\n• Lohitaksha Ranganathan: 1/1 Done (100% ✅)\n• Sahil Gorde: 2/3 Done (1 Pending ⏳)\n\nReview your full team board on the portal.", chat);
    const noCarry = A.teamDigestChat({ ...input, rows: input.rows.map(r => ({ ...r, carriedDone: 0, carriedPending: 0 })), rowsArePeople: true });
    check('chat: nothing carried → no "Carried forward" lines at all', !noCarry.includes('Carried forward'));
    const params = A.teamDigestParams(input);
    check('template: the status line starts with "Today:" and notes carried-forward work per person',
        params[6] === 'Today: • Harsh Patil: 0/0 Done (no tasks) · Carried forward: 2 done, 1 pending | • Lohitaksha Ranganathan: 1/1 Done (100% ✅) | • Sahil Gorde: 2/3 Done (1 Pending ⏳) · Carried forward: 1 pending', params[6]);
    check('template: today\'s numbers are untouched (3 completed, 1 pending)', params[4] === '3' && params[5] === '1');
    check('template: the line never has a line break', !params[6].includes('\n'));
    const supers = A.teamDigestChat({ ...input, scope: 'All Active Departments', rows: [{ label: 'Procurement', done: 4, total: 5, carriedDone: 1, carriedPending: 0 }], completed: 4, pending: 1, rowsArePeople: false });
    check('superuser version names departments (not first names)', supers.includes('• Carried forward: 1 (Procurement 1)') && supers.includes('• Today: 4 (Procurement 4)'));

    check('nothing in this test touched the network', net.length === 0, net);
    console.log(failures ? `\n❌ ${failures} FAILED` : '\n🎉 SECTIONS / CARRY-FORWARD TESTS PASSED');
    process.exit(failures ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
