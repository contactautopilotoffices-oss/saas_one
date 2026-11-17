/**
 * Owner 2026-10-28 — "Remark on completion", only the holder changes a task's status, and personal exceptions to the team
 * switches (100% OFFLINE: fake database and fake access checks; nothing real is read, written or sent).
 * Run: npx tsx task-manager/tests/test_person_settings_and_remark_2026_10_28.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
process.env.AISENSY_PROJECT_ID = 'fake-project';
process.env.AISENSY_PROJECT_API_KEY = 'fake-password';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (url: any) => { net.push(String(url)); throw new Error('network must not be used in this test'); };

    const WS = await import('../WorkspaceService');
    const { WorkspaceService, WorkspaceError } = WS;
    const { TaskAccessService } = await import('../TaskAccessService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { PermissionDeniedError } = await import('../PermissionService');
    const { withPersonalSwitch } = await import('../personalSwitch');
    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');

    console.log('\n1. The completion remark lives on its own line');
    const desc = 'Site: SS Plaza\nRemark: call the vendor\nGiven by Roohi on 27 Oct';
    const withR = WS.withCompletionRemark(desc, 'shared on the HR group');
    check('saved as its own line', withR.endsWith('\nCompletion remark: shared on the HR group'));
    check('read back', WS.completionRemarkOf(withR) === 'shared on the HR group');
    check('marking done again replaces it (one per task)', WS.completionRemarkOf(WS.withCompletionRemark(withR, 'second')) === 'second' && (WS.withCompletionRemark(withR, 'second').match(/Completion remark:/g) || []).length === 1);
    check('not listed as a note (so note editing keeps its line numbers)', !WS.noteLines(withR).some(n => n.text.includes('shared on the HR group')) && WS.noteLines(withR).length === 2);
    check('not in the notes the screens show', !String(WS.withoutHandoverNotes(withR)).includes('Completion remark'));
    check('none → null', WS.completionRemarkOf(desc) === null && WS.completionRemarkOf(null) === null);
    check('the giver\'s message carries it in the title (approved template, no new one)', WS.withRemarkLabel('Share letters', 'done') === 'Share letters (Remark: done)' && WS.withRemarkLabel('Share letters', null) === 'Share letters');

    console.log('\n2. setStatus: holder only, remark saved, "required" enforced');
    const people: Record<string, any> = {
        neeti: { id: 'neeti', name: 'Neeti', department_id: 'hr', role: 'employee', active: true },
        roohi: { id: 'roohi', name: 'Roohi', department_id: 'hr', role: 'reporting_manager', active: true },
    };
    const store: any = { row: null, updates: [] as any[], statuses: [] as any[], notified: [] as any[] };
    const reset = (row: any) => { store.row = { ...row }; store.updates = []; store.statuses = []; store.notified = []; };
    (supabaseAdmin as any).from = (table: string) => {
        if (table !== 'task_assignments') throw new Error(`unexpected table ${table}`);
        return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: store.row ? { ...store.row } : null, error: null }) }) }),
            update: (payload: any) => ({ eq: async () => { store.updates.push(payload); Object.assign(store.row, payload); return { error: null }; } }),
        };
    };
    const db: any = TaskDatabaseService; const access: any = TaskAccessService; const ws: any = WorkspaceService;
    db.getEmployeeById = async (id: string) => people[id] || null;
    db.logAudit = async () => {};
    db.updateAssignmentStatus = async (p: any) => { store.statuses.push(p.status); store.row.status = p.status; return { ...store.row }; };
    access.check = async () => ({ allowed: true, reason: 'ok', message: '' });
    let mode: 'off' | 'ask' | 'required' = 'ask';
    access.completionRemarkFor = async () => mode;
    ws.notifyAssignerOfCompletion = async (row: any) => { store.notified.push(row.title); };
    const task = { id: 't1', title: 'Share appointment letters', description: 'Site: SS Plaza', employee_id: 'neeti', assigned_by: 'roohi', status: 'pending' };

    reset(task);
    await WorkspaceService.setStatus('neeti', { taskId: 't1', status: 'completed', remark: '  shared on   the HR group ' });
    check('the holder marks it done with a remark: saved, tidied', store.statuses[0] === 'completed' && WS.completionRemarkOf(store.row.description) === 'shared on the HR group');
    check('the giver\'s notice carries the remark', store.notified[0] === 'Share appointment letters (Remark: shared on the HR group)', store.notified);

    reset(task);
    let err: any = null;
    try { await WorkspaceService.setStatus('roohi', { taskId: 't1', status: 'completed' }); } catch (e) { err = e; }
    check('her manager cannot mark it done (only the holder changes status)', err instanceof PermissionDeniedError && store.statuses.length === 0, err);
    err = null;
    try { await WorkspaceService.setStatus('roohi', { taskId: 't1', status: 'in_progress' }); } catch (e) { err = e; }
    check('…nor move it to in progress', err instanceof PermissionDeniedError && store.statuses.length === 0);

    reset(task); mode = 'required'; err = null;
    try { await WorkspaceService.setStatus('neeti', { taskId: 't1', status: 'completed' }); } catch (e) { err = e; }
    check('"required": no remark → refused, nothing changed', err instanceof WorkspaceError && err.code === 'REMARK_REQUIRED' && store.statuses.length === 0 && store.updates.length === 0, err);
    await WorkspaceService.setStatus('neeti', { taskId: 't1', status: 'completed', remark: 'sent all 12' });
    check('"required": with a remark → done', store.statuses[0] === 'completed');

    reset(task); mode = 'ask';
    await WorkspaceService.setStatus('neeti', { taskId: 't1', status: 'completed' });
    check('"ask": skipping is fine, no remark line, plain title to the giver', store.statuses[0] === 'completed' && store.updates.length === 0 && store.notified[0] === 'Share appointment letters');

    reset(task); err = null;
    try { await WorkspaceService.setStatus('neeti', { taskId: 't1', status: 'completed', remark: 'x'.repeat(301) }); } catch (e) { err = e; }
    check('a remark over 300 characters is refused', err instanceof WorkspaceError && store.statuses.length === 0);
    err = null;
    try { await WorkspaceService.setStatus('neeti', { taskId: 't1', status: 'in_progress', remark: 'hmm' }); } catch (e) { err = e; }
    check('a remark only goes with "done"', err instanceof WorkspaceError && store.statuses.length === 0);

    console.log('\n3. Personal exceptions win over the team, either way');
    const o = { byUser: new Map([['neeti', new Map([['team_assign', 'off'], ['due_dates', 'on'], ['completion_remark', 'required']])]]), tableMissing: false };
    check('personal OFF', TaskAccessService.switchFrom(o, 'neeti', 'team_assign') === false);
    check('personal ON', TaskAccessService.switchFrom(o, 'neeti', 'due_dates') === true);
    check('no exception → follows the team (null)', TaskAccessService.switchFrom(o, 'neeti', 'pending_on') === null && TaskAccessService.switchFrom(o, 'roohi', 'team_assign') === null);
    check('WhatsApp gates: personal ON adds their department, OFF removes it, none leaves it', withPersonalSwitch(new Set(), 'hr', true).has('hr') && !withPersonalSwitch(new Set(['hr']), 'hr', false).has('hr') && withPersonalSwitch(new Set(['hr']), 'hr', null).has('hr'));

    // Only the person-aware calls are wired (no department-only check left behind)
    const perm = read('task-manager/PermissionService.ts');
    check('who may assign: team sharing and "assign to anyone" ask about the person', /isPeerAssignEnabled\(actor\.department_id, actor\.id\)/.test(perm) && /isTeamAssignEnabled\(actor\.department_id, actor\.id\)/.test(perm));
    const wsSrc = read('task-manager/WorkspaceService.ts');
    check('no department-only feature check left in WorkspaceService', !/teamFeaturesFor\([a-z?.]*department_id\)/.test(wsSrc) && !/isDueDatesEnabled\(actor\.department_id\)/.test(wsSrc));
    check('the board is told the person\'s remark setting', /completionRemark: await TaskAccessService\.completionRemarkFor\(actor\)/.test(wsSrc));
    const sql = read('supabase/migrations/20261028100001_task_manager_person_settings_and_completion_remark.sql');
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    check('migration: additive, default ask, row level security, no destructive statement', /DEFAULT 'ask'/.test(code) && /ENABLE ROW LEVEL SECURITY/.test(code) && !/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im.test(code));

    console.log('\n4. Screens');
    const tab = read('frontend/components/procurement/ProcurementTasksTab.tsx');
    check('marking MY task done opens the box first (drag, keys, task window all go through it)', /onMove=\{move\}/.test(tab) && /status === 'completed' && remarkMode !== 'off' && t && t\.ownerId === meId/.test(tab));
    check('"required" has no Skip', /completing=\{remarkMode === 'required' \? 'required' : 'ask'\}/.test(tab) && /completing === 'ask' && onSkip/.test(read('frontend/components/procurement/tasks/RemarkDialog.tsx')));
    check('the remark shows on the card, the task window and Assigned by me', /<CompletionRemark text=\{task\.completionRemark\}/.test(read('frontend/components/procurement/tasks/Board.tsx'))
        && /Completion remark<\/h3>/.test(read('frontend/components/procurement/tasks/TaskView.tsx'))
        && /<CompletionRemark text=\{task\.completionRemark\}/.test(read('frontend/components/procurement/tasks/AssignedView.tsx')));
    const panel = read('frontend/components/task-manager/TaskAccessPanel.tsx');
    check('Control Center: Off / Ask / Required per team, a window per person, reset to team', /action: 'set_completion_remark'/.test(panel) && /function PersonSettingsDialog/.test(panel) && /action: 'set_person_setting'/.test(panel) && /action: 'reset_person_settings'/.test(panel));
    check('"Team manages notifications" is not offered per person', !/key: 'notifications_delegated'/.test(panel) && !/'notifications_delegated'/.test(read('task-manager/TaskAccessService.ts').split('PERSON_SWITCHES')[1]?.split('\n')[0] ?? ''));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 PERSON SETTINGS / REMARK TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
