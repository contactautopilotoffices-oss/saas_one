/**
 * Superuser natural language (OFFLINE: stubbed database and messaging, FAKE AI; no network, no WhatsApp).
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { classifyInsight, matchByName, parsePick } = await import('../TaskGateway');
    const { SuperuserAIInterpreter } = await import('../SuperuserAIInterpreter');

    console.log('\n1. Questions a superuser can ask (any of these wordings)');
    const q = (t: string) => classifyInsight(t);
    check('"How is Procurement doing today?" → procurement', q('How is Procurement doing today?')?.subject === 'Procurement'.toLowerCase());
    check('"how\'s the Operations team doing" → operations', q("how's the Operations team doing")?.subject === 'operations');
    check('"What is Dev working on?" → dev', q('What is Dev working on?')?.subject === 'dev');
    check('"Show me Satej\'s tasks" → satej', q("Show me Satej's tasks")?.subject === 'satej');
    check('"Procurement status" → procurement', q('Procurement status')?.subject === 'procurement');
    check('"tasks for Priya" → priya', q('tasks for Priya')?.subject === 'priya');
    check('"Who has pending tasks?" → pending', q('Who has pending tasks?')?.kind === 'pending_tasks');
    check('"anyone behind today" → pending', q('anyone behind today')?.kind === 'pending_tasks');
    check('"How is everyone doing?" → whole company', q('How is everyone doing?')?.kind === 'org_overview');
    check('"company progress overview" → whole company', q('company progress overview')?.kind === 'org_overview');
    check('"show my tasks" is NOT a company question', q('show my tasks') === null);
    check('"what do I have today?" is NOT a company question', q('what do I have today?') === null);
    check('"how\'s my progress" is NOT a company question', q("how's my progress") === null);
    check('"my tasks" is NOT a company question', q('my tasks') === null);

    console.log('\n2. Names: duplicates are never silently resolved');
    const people = [{ name: 'Rajesh Zore' }, { name: 'Rajesh Kadam' }, { name: 'Priya Pal' }];
    check('"Rajesh" matches BOTH Rajeshes', matchByName('Rajesh', people).length === 2);
    check('"Rajesh Kadam" matches exactly one', matchByName('Rajesh Kadam', people).length === 1);
    check('"priya" matches one', matchByName('priya', people).length === 1);
    check('an unknown name matches nothing', matchByName('Zorro', people).length === 0);
    check('pick: "2" of 3 is 2; "9" of 3 is nothing', parsePick('2', 3) === 2 && parsePick('9', 3) === null);

    console.log('\n3. The AI reader is checked before it is believed');
    const fake = (payload: unknown, ok = true) => (async () => ({ ok, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) })) as unknown as typeof fetch;
    const env = { GROQ_TASK_CHAT_API_KEY: 'k' };
    const msg = 'how are the folks in procurement getting along';
    const good = await SuperuserAIInterpreter.interpret(msg, { departments: ['Procurement'] }, { env, fetch: fake({ kind: 'department_progress', subject: 'procurement', title: null }) });
    check('a grounded answer is accepted', good?.kind === 'department_progress' && (good as any).subject === 'procurement', good);
    check('a name that is NOT in the message is rejected (invented)', await SuperuserAIInterpreter.interpret(msg, { departments: [] }, { env, fetch: fake({ kind: 'department_progress', subject: 'accounts', title: null }) }) === null);
    check('an unknown kind is rejected', await SuperuserAIInterpreter.interpret(msg, { departments: [] }, { env, fetch: fake({ kind: 'delete_everything', subject: 'procurement', title: null }) }) === null);
    check('"unclear" is treated as nothing', await SuperuserAIInterpreter.interpret(msg, { departments: [] }, { env, fetch: fake({ kind: 'unclear', subject: null, title: null }) }) === null);
    check('an assignment needs BOTH a grounded person and a grounded task', await SuperuserAIInterpreter.interpret('please get Satej onto the vendor call', { departments: [] }, { env, fetch: fake({ kind: 'assign_task', subject: 'Satej', title: 'ring the vendor' }) }) === null);
    const asg = await SuperuserAIInterpreter.interpret('please get Satej onto the vendor call', { departments: [] }, { env, fetch: fake({ kind: 'assign_task', subject: 'Satej', title: 'the vendor call' }) });
    check('a grounded assignment is accepted', asg?.kind === 'task_assign', asg);
    check('no key → no AI call, nothing returned', await SuperuserAIInterpreter.interpret(msg, { departments: [] }, { env: {}, fetch: (() => { throw new Error('must not be called'); }) as unknown as typeof fetch }) === null);
    check('a provider error → nothing returned (no crash)', await SuperuserAIInterpreter.interpret(msg, { departments: [] }, { env, fetch: fake({}, false) }) === null);

    // ── stubbed world for the router / executor ──────────────────────────────
    process.env.GROQ_TASK_CHAT_API_KEY = 'k'; // present, but fetch below is fake
    const aiCalls: string[] = [];
    (globalThis as any).fetch = async (_u: string, init: any) => {
        aiCalls.push(String(init?.body));
        const body = JSON.parse(init.body);
        const message = JSON.parse(body.messages[1].content).message as string;
        const out = /getting along/.test(message) ? { kind: 'department_progress', subject: 'procurement', title: null } : { kind: 'unclear', subject: null, title: null };
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(out) } }] }) };
    };

    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskMessagingService } = await import('../TaskMessagingService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { TaskMessageRouter } = await import('../TaskMessageRouter');
    const { ControlledTaskTools } = await import('../ControlledTaskTools');
    const db: any = TaskDatabaseService;

    const dept = (id: string, name: string) => ({ id, name });
    const departments = [dept('d-proc', 'Procurement'), dept('d-ops', 'Operations')];
    const mk = (id: string, name: string, dept_id: string, dept_name: string, role = 'employee') => ({ id, name, phone_number: '9876543210', department_id: dept_id, department_name: dept_name, role, active: true });
    const boss = mk('boss', 'Saniel Golechha', 'd-mgmt', 'Management', 'superuser');
    const everyone = [boss, mk('rz', 'Rajesh Zore', 'd-ops', 'Operations'), mk('rk', 'Rajesh Kadam', 'd-ops', 'Operations'), mk('pp', 'Priya Pal', 'd-proc', 'Procurement')];
    let me: any = boss;
    const contexts = new Map<string, any>();
    let replies: string[] = [];
    let created: any[] = [];
    let toolCalls: string[] = [];

    db.getTestingConfig = async () => ({ enabled: true, employees: [], nlGatewayEnabled: true });
    db.getEmployeeByPhone = async () => me;
    db.getDepartments = async () => departments;
    db.getAllEmployees = async () => everyone;
    db.getConversationContext = async (_p: string, s: string) => contexts.get(s) || null;
    db.setConversationContext = async (p: any) => { contexts.set(p.system, { context_type: p.contextType, context_data: p.contextData || {} }); return {}; };
    db.clearConversationContext = async (_p: string, s?: string) => { if (s) contexts.delete(s); else contexts.clear(); };
    db.getDailyAssignments = async () => [];
    db.logAudit = async () => {};
    db.createTaskAssignment = async (p: any) => { created.push(p); return { id: 'new', title: p.title }; };
    (TaskMessagingService as any).sendMessage = async (_p: string, t: string) => { replies.push(t); return true; };
    (TaskAccessService as any).check = async () => ({ allowed: true, reason: 'ok', message: '' });
    (TaskAccessService as any).isPeerAssignEnabled = async () => false;
    (ControlledTaskTools as any).get_department_progress = async (_a: any, p: any) => { toolCalls.push(`progress:${p.departmentNameOrId}`); return { departmentName: p.departmentNameOrId === 'd-proc' ? 'Procurement' : 'Operations', activeEmployees: 4, totalTasks: 8, completedTasks: 5, pendingTasks: 3, completionPercentage: '62%', employeeBreakdown: [] }; };
    (ControlledTaskTools as any).get_department_tasks = async (_a: any, p: any) => ({ department: 'X', date: 'd', total: 0, tasks: [] });
    (ControlledTaskTools as any).get_employee_tasks = async (_a: any, p: any) => { toolCalls.push(`person:${p.nameOrPhone}`); return { employee: everyone.find(e => e.id === p.nameOrPhone)?.name, department: 'Operations', date: 'd', total: 2, completed: 1, pending: 1, tasks: [{ title: 'Check meters', status: 'pending' }] }; };
    (ControlledTaskTools as any).get_pending_tasks = async () => { toolCalls.push('pending'); return { date: 'd', pendingCount: 1, pendingTasks: [{ title: 'Call vendor', assignedTo: 'Priya Pal' }] }; };
    (ControlledTaskTools as any).get_organisation_progress = async () => { toolCalls.push('org'); return { totalDepartments: 2, totalEmployees: 4, totalTasks: 9, completedTasks: 5, pendingTasks: 4, overallCompletionPercentage: '55%', departments: [] }; };
    const reset = () => { replies = []; created = []; toolCalls = []; contexts.clear(); aiCalls.length = 0; };
    const say = (t: string) => TaskMessageRouter.routeInboundMessage({ phone: '9876543210', text: t, date: '2026-10-07' });

    console.log('\n4. A superuser on WhatsApp');
    reset(); me = boss;
    await say('How is Procurement doing today?');
    check('a department question is answered with that department', toolCalls.includes('progress:d-proc') && /Procurement/.test(replies[0]), { toolCalls, replies });
    check('...without needing the AI', aiCalls.length === 0);

    reset();
    await say('Who has pending tasks?');
    check('company-wide pending is answered', toolCalls.includes('pending') && /Pending/i.test(replies[0]), replies);

    reset();
    await say('what is Rajesh working on?');
    check('two Rajeshes: asks "Which one?" and shows both', /Which one/.test(replies[0]) && /Rajesh Zore/.test(replies[0]) && /Rajesh Kadam/.test(replies[0]) && toolCalls.length === 0, replies);
    await say('2');
    check('picking 2 shows Rajesh Kadam\'s tasks', toolCalls.includes('person:rk') && /Rajesh Kadam/.test(replies[1]), { toolCalls, replies });

    reset();
    await say('how is Atlantis doing');
    check('an unknown department/person: says so, lists real departments, invents nothing', /couldn't find "atlantis"/i.test(replies[0]) && /Procurement/.test(replies[0]) && toolCalls.length === 0, replies);

    reset();
    await say('how are the folks in procurement getting along');
    check('unusual wording: the AI reads it, and the answer is still the real Procurement data', aiCalls.length === 1 && toolCalls.includes('progress:d-proc'), { aiCalls: aiCalls.length, toolCalls });

    reset();
    await say('help');
    check('"help" shows the superuser guide', /Superuser/.test(replies[0]) && /How is Procurement/.test(replies[0]), replies);

    console.log('\n5. Assigning by natural language (duplicate names)');
    reset();
    await say('give Rajesh a task to read the meters');
    check('two Rajeshes: asks which one, creates nothing', /Which one/.test(replies[0]) && created.length === 0, replies);
    await say('1');
    check('then asks to confirm with the exact person', /confirm/i.test(replies[1]) && /Rajesh Zore/.test(replies[1]) && created.length === 0, replies);
    await say('yes');
    check('YES creates the task for exactly that person', created.length === 1 && created[0].employeeId === 'rz' && created[0].title === 'read the meters', created);

    reset();
    await say('give Priya a task to send the quotation');
    await say('yes');
    check('a single match goes straight to confirm, then creates it for her', created.length === 1 && created[0].employeeId === 'pp', created);

    reset();
    await say('give Zorro a task to do something');
    check('an unknown person: says so, creates nothing', /couldn't find "Zorro"/i.test(replies[0]) && created.length === 0, replies);

    console.log('\n6. A normal employee gets none of it');
    reset(); me = mk('emp', 'Asha Rao', 'd-proc', 'Procurement');
    const r = await say('How is Procurement doing today?');
    check('not treated as a company question', toolCalls.length === 0 && !r.classification.insight, r.classification);
    check('the AI is never called for an employee', aiCalls.length === 0);
    reset();
    await say('help');
    check('"help" is not the superuser guide for an employee', !/Superuser/.test(replies.join(' ')));

    console.log('\n7. Making and removing a superuser');
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    let profiles: any[] = [
        { id: 'p1', user_id: 'boss', task_role: 'superuser', first_name: 'Saniel', last_name: 'Golechha', is_active: true },
        { id: 'p2', user_id: 'sahil', task_role: 'employee', first_name: 'Sahil', last_name: 'Gorde', is_active: true },
    ];
    const audits: any[] = [];
    db.logAudit = async (a: any) => { audits.push(a); };
    (supabaseAdmin as any).from = () => {
        const f: any = { rows: profiles, upd: null as any };
        const api: any = {
            select: () => api,
            update: (v: any) => { f.upd = v; return api; },
            eq: (c: string, v: any) => { f.rows = f.rows.filter((r: any) => r[c] === v); if (f.upd) { profiles = profiles.map(r => (r.user_id === v || f.rows.includes(r) ? { ...r, ...f.upd } : r)); } return api; },
            neq: (c: string, v: any) => { f.rows = f.rows.filter((r: any) => r[c] !== v); return api; },
            then: (res: any) => res({ data: f.rows, error: null }),
        };
        return api;
    };
    const expectError = async (fn: () => Promise<unknown>, re: RegExp) => { try { await fn(); return false; } catch (e: any) { return re.test(e.message); } };

    check('the LAST superuser cannot be removed', await expectError(() => TaskAccessService.setSuperuser('boss', false, 'admin'), /At least one superuser/));
    await TaskAccessService.setSuperuser('sahil', true, 'admin');
    check('making Sahil a superuser changes only his role', profiles.find(p => p.user_id === 'sahil').task_role === 'superuser' && profiles.find(p => p.user_id === 'boss').task_role === 'superuser');
    check('the change is recorded with who did it and the previous role', audits.some(a => a.event_type === 'task_access_superuser_updated' && a.details.previousRole === 'employee' && a.details.actor === 'admin'));
    await TaskAccessService.setSuperuser('sahil', false, 'admin');
    check('removing him again returns him to employee (Saniel stays a superuser)', profiles.find(p => p.user_id === 'sahil').task_role === 'employee' && profiles.find(p => p.user_id === 'boss').task_role === 'superuser');
    check('someone with no active profile is refused', await expectError(() => TaskAccessService.setSuperuser('nobody', true), /not found/));

    console.log(failures === 0 ? '\n🎉 SUPERUSER TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
