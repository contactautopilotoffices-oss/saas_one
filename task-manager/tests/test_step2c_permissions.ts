/**
 * Step 2C — assignment follows the reporting chain (OFFLINE, stubbed; no database, no network).
 * Procurement case: four members report straight to the founder (Saniel).
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const { PermissionService } = await import('../PermissionService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { HierarchyService } = await import('../HierarchyService');
    const { OrgHierarchy } = await import('../OrgHierarchy');

    const P = (id: string, name: string, mgr: string | null) => ({ userId: id, profileId: 'p' + id, name, departmentId: id === 'saniel' ? 'mgmt' : 'proc', departmentName: '', taskRole: 'employee', managerUserId: mgr });
    const hierarchy = new OrgHierarchy([P('saniel', 'Saniel', null), P('a', 'Proc A', 'saniel'), P('b', 'Proc B', 'saniel'), P('c', 'Proc C', 'saniel'), P('d', 'Proc D', 'saniel')]);
    (HierarchyService as any).load = async () => ({ hierarchy, activeProfiles: 5, withoutUserAccount: 0 });

    const emp = (id: string, role: string) => ({ id, name: id, role, department_id: id === 'saniel' ? 'mgmt' : 'proc', active: true });
    const people: Record<string, any> = { saniel: emp('saniel', 'superuser'), a: emp('a', 'employee'), b: emp('b', 'employee'), c: emp('c', 'employee'), d: emp('d', 'employee') };
    (TaskDatabaseService as any).getEmployeeById = async (id: string) => people[id] || null;
    (TaskDatabaseService as any).logAudit = async () => {};

    const can = async (actor: string, target: string) => { try { await PermissionService.assertCanAssignTask(actor, target); return true; } catch { return false; } };
    check('Saniel (superuser) can assign to each Procurement member', (await Promise.all(['a', 'b', 'c', 'd'].map(t => can('saniel', t)))).every(Boolean));
    check('a Procurement member cannot assign to Saniel', !(await can('a', 'saniel')));
    check('a Procurement member cannot assign to a peer (peer rule comes in Step 5)', !(await can('a', 'b')));

    check('a Procurement member can assign a task to THEMSELVES', await can('a', 'a'));

    // A department "manager" label no longer grants department-wide rights
    people.a.role = 'reporting_manager';
    check('old "reporting_manager" label alone no longer lets A assign to B', !(await can('a', 'b')));
    people.a.role = 'employee';

    const task = (owner: string) => ({ id: 't', employee_id: owner } as any);
    const ok = async (fn: () => Promise<void>) => { try { await fn(); return true; } catch { return false; } };
    check('Saniel can read/complete a Procurement member\'s task', await ok(() => PermissionService.assertCanReadTask('saniel', task('a'))) && await ok(() => PermissionService.assertCanCompleteTask('saniel', task('a'))));
    check('a member can complete their own task', await ok(() => PermissionService.assertCanCompleteTask('a', task('a'))));
    check('a member cannot complete a peer\'s task', !(await ok(() => PermissionService.assertCanCompleteTask('a', task('b')))));

    console.log(failures === 0 ? '\n🎉 STEP 2C PERMISSION TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
