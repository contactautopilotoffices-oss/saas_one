/**
 * Task Import — the per-department switch (100% OFFLINE: fake Supabase client, recorders for audit; no network,
 * no real database, no WhatsApp).
 * Run: npx tsx task-manager/tests/test_import_department_switch.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { TaskAccessService, AccessNotProvisionedError } = await import('../TaskAccessService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const db: any = TaskDatabaseService;
    const access: any = TaskAccessService;

    const realFrom = (supabaseAdmin as any).from;
    const audits: any[] = [];
    db.logAudit = async (a: any) => { audits.push(a); };
    db.getDepartmentById = async (id: string) => (id === 'd-proc' ? { id, name: 'Procurement' } : null);

    console.log('\n1. Reading which departments have Task import ON');
    (supabaseAdmin as any).from = () => ({ select: async () => ({ data: [
        { department_id: 'd-proc', task_import_enabled: true }, { department_id: 'd-tech', task_import_enabled: false }, { department_id: 'd-hr', task_import_enabled: null }], error: null }) });
    let r = await TaskAccessService.getTaskImportDepartments();
    check('only departments explicitly ON are returned', r.departments.size === 1 && r.departments.has('d-proc') && !r.columnMissing, [...r.departments]);
    check('isTaskImportEnabled: ON → true, OFF → false, unknown/empty → false',
        (await TaskAccessService.isTaskImportEnabled('d-proc')) === true && (await TaskAccessService.isTaskImportEnabled('d-tech')) === false &&
        (await TaskAccessService.isTaskImportEnabled('nope')) === false && (await TaskAccessService.isTaskImportEnabled(null)) === false && (await TaskAccessService.isTaskImportEnabled(undefined)) === false);
    (supabaseAdmin as any).from = () => ({ select: async () => ({ data: null, error: { code: '42703', message: 'column task_import_enabled does not exist' } }) });
    r = await TaskAccessService.getTaskImportDepartments();
    check('column not created yet (migration not run) → nobody has it, flagged as missing (FAIL CLOSED)', r.departments.size === 0 && r.columnMissing === true);
    check('…so no department can use Task import before the migration', (await TaskAccessService.isTaskImportEnabled('d-proc')) === false);
    (supabaseAdmin as any).from = () => ({ select: async () => { throw new Error('network down'); } });
    r = await TaskAccessService.getTaskImportDepartments();
    check('database unreadable → nobody has it, no exception (FAIL CLOSED)', r.departments.size === 0 && r.columnMissing === true);

    console.log('\n2. Switching a department ON / OFF');
    access.getSnapshot = async () => ({ provisioned: true, readable: true, departmentEnabled: new Map(), onboarded: new Map() });
    let upserted: any = null; let upsertError: any = null;
    (supabaseAdmin as any).from = (table: string) => ({ upsert: async (payload: any, opts: any) => { upserted = { table, payload, opts }; return { error: upsertError }; } });
    await TaskAccessService.setTaskImportEnabled('d-proc', true, 'Admin A');
    check('writes ONLY the new column for that department (other settings untouched)',
        upserted.table === 'task_manager_department_settings' && upserted.payload.department_id === 'd-proc' && upserted.payload.task_import_enabled === true &&
        !('peer_assign' in upserted.payload) && !('notifications_delegated' in upserted.payload) && !('enabled' in upserted.payload) && upserted.opts.onConflict === 'department_id', upserted);
    check('records who did it, in the audit log', audits.length === 1 && audits[0].event_type === 'task_access_task_import_updated' && audits[0].details.taskImportEnabled === true && audits[0].details.actor === 'Admin A' && audits[0].details.departmentName === 'Procurement', audits[0]);
    await TaskAccessService.setTaskImportEnabled('d-proc', false, 'Admin A');
    check('switching OFF writes false and is audited too', upserted.payload.task_import_enabled === false && audits[1].details.taskImportEnabled === false);
    let msg = ''; try { await TaskAccessService.setTaskImportEnabled('d-missing', true); } catch (e: any) { msg = e.message; }
    check('unknown department → refused', /Department not found/.test(msg), msg);
    upsertError = { code: '42703', message: 'column does not exist' }; msg = '';
    const before = audits.length;
    try { await TaskAccessService.setTaskImportEnabled('d-proc', true); } catch (e: any) { msg = e.message; }
    check('migration not run → friendly message naming the SQL file, and no audit row', /20261007000004_task_manager_task_import\.sql/.test(msg) && audits.length === before, msg);
    upsertError = null;
    access.getSnapshot = async () => ({ provisioned: false, readable: true, departmentEnabled: new Map(), onboarded: new Map() });
    let notProv = false; try { await TaskAccessService.setTaskImportEnabled('d-proc', true); } catch (e) { notProv = e instanceof AccessNotProvisionedError; }
    check('access tables not created at all → refused with the existing "not provisioned" error', notProv);

    console.log('\n3. Control Center overview');
    access.getSnapshot = async () => ({ provisioned: true, readable: true, departmentEnabled: new Map([['d-proc', true]]), onboarded: new Map() });
    db.getDepartments = async () => [{ id: 'd-proc', name: 'Procurement' }, { id: 'd-tech', name: 'Tech' }];
    access.getPeerAssignDepartments = async () => ({ departments: new Set(['d-tech']), columnMissing: false });
    access.getDelegatedDepartments = async () => ({ departments: new Set(), columnMissing: false });
    access.getTaskImportDepartments = async () => ({ departments: new Set(['d-proc']), columnMissing: false });
    (supabaseAdmin as any).from = () => ({ select: () => ({ eq: () => ({ not: async () => ({ data: [
        { user_id: 'u1', first_name: 'Priyanka', last_name: 'S', department_id: 'd-proc', task_role: 'employee' },
        { user_id: 'u2', first_name: 'Lohit', last_name: 'K', department_id: 'd-tech', task_role: 'reporting_manager' }], error: null }) }) }) });
    let o = await TaskAccessService.getOverview();
    const proc = o.departments.find(d => d.departmentId === 'd-proc')!; const tech = o.departments.find(d => d.departmentId === 'd-tech')!;
    check('each department row carries its own taskImportEnabled', proc.taskImportEnabled === true && tech.taskImportEnabled === false, o.departments);
    check('the other two buttons are unaffected', tech.peerAssign === true && proc.peerAssign === false && proc.notificationsDelegated === false);
    check('no column warning when the column exists', o.taskImportColumnMissing === false);
    access.getTaskImportDepartments = async () => ({ departments: new Set(), columnMissing: true });
    o = await TaskAccessService.getOverview();
    check('column missing → the overview says so (the panel shows the yellow "run one more SQL file" banner)', o.taskImportColumnMissing === true && o.departments.every(d => d.taskImportEnabled === false));
    (supabaseAdmin as any).from = realFrom;

    console.log('\n4. The migration file and the old global switch');
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261007000004_task_manager_task_import.sql'), 'utf8');
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    check('migration only ADDS one boolean column, default false, IF NOT EXISTS', /ALTER TABLE public\.task_manager_department_settings\s+ADD COLUMN IF NOT EXISTS task_import_enabled BOOLEAN NOT NULL DEFAULT false;/.test(code));
    check('migration contains nothing destructive (no DROP / DELETE / UPDATE / INSERT / TRUNCATE outside comments)', !/\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/i.test(code), code);
    check('the global switch is gone from the settings type and the database service', !/taskImportEnabled/.test(fs.readFileSync(path.join(__dirname, '../types.ts'), 'utf8')) && !/taskImportEnabled|setTaskImport\b/.test(fs.readFileSync(path.join(__dirname, '../TaskDatabaseService.ts'), 'utf8')));
    check('the panel has no global switch and has the per-department button', (() => {
        const panel = fs.readFileSync(path.join(__dirname, '../../frontend/components/task-manager/TaskAccessPanel.tsx'), 'utf8');
        return !/useState\(false\);\s*\n?.*const \[taskImport,/.test(panel) && !/'task-import'/.test(panel) && /Task import: \{d\.taskImportEnabled/.test(panel) && /action: 'set_task_import', departmentId/.test(panel);
    })());

    console.log(failures === 0 ? '\n🎉 TASK IMPORT DEPARTMENT SWITCH TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
