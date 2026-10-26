/**
 * Step 2 — hierarchy rules from reporting_manager_id (100% OFFLINE, pure logic, no database, no network).
 * Names are illustrative; the shapes mirror the real cases: Procurement reports straight to the founder,
 * HR has a chain, and the data-quality checks (loops, missing managers) behave.
 */
import { OrgHierarchy, HierarchyPerson } from '../OrgHierarchy';

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
    if (ok) console.log(`  ✓ ${name}`);
    else { failures++; console.error(`  ✗ ${name}`, extra ?? ''); }
}

const P = (id: string, name: string, dept: string | null, role: string, mgr: string | null): HierarchyPerson => ({
    userId: id, profileId: `p-${id}`, name, departmentId: dept, departmentName: dept, taskRole: role, managerUserId: mgr,
});
const names = (xs: HierarchyPerson[]) => xs.map(x => x.name).sort();

// Founder chain: Ruhi → Sunil → (Procurement x4, HR: Neeti), Ruhi also has an HR report
const people: HierarchyPerson[] = [
    P('ruhi', 'Ruhi', 'Management', 'employee', null),
    P('sunil', 'Sunil', 'Management', 'superuser', 'ruhi'),
    P('pa', 'Proc A', 'Procurement', 'employee', 'sunil'),
    P('pb', 'Proc B', 'Procurement', 'employee', 'sunil'),
    P('pc', 'Proc C', 'Procurement', 'employee', 'sunil'),
    P('pd', 'Proc D', 'Procurement', 'employee', 'sunil'),
    P('neeti', 'Neeti', 'HR', 'employee', 'sunil'),
    P('hrjr', 'HR Junior', 'HR', 'employee', 'neeti'),
    P('lone', 'Lone', 'Ops', 'reporting_manager', null),   // label says manager, nobody reports to them
];
const h = new OrgHierarchy(people);

console.log('\n1. Who is the manager?');
check('Proc A reports to Sunil', h.managerOf('pa')?.name === 'Sunil');
check('Sunil reports to Ruhi', h.managerOf('sunil')?.name === 'Ruhi');
check('Ruhi has no manager', h.managerOf('ruhi') === null);

console.log('\n2. Below a person (direct + indirect)');
check('Sunil direct reports = 5', names(h.directReports('sunil')).join() === ['Neeti', 'Proc A', 'Proc B', 'Proc C', 'Proc D'].sort().join());
check('Ruhi all reports include indirect people (7)', h.allReports('ruhi').length === 7, names(h.allReports('ruhi')));
check('Ruhi sees HR Junior (indirect)', h.allReports('ruhi').some(p => p.name === 'HR Junior'));
check('chain up from HR Junior = Neeti, Sunil, Ruhi', h.chainUp('hrjr').map(p => p.name).join('>') === 'Neeti>Sunil>Ruhi');

console.log('\n3. Who can assign to whom');
check('Sunil → Proc A: yes', h.canAssign('sunil', 'pa'));
check('Ruhi → HR Junior (indirect): yes', h.canAssign('ruhi', 'hrjr'));
check('Proc A → Sunil: no', !h.canAssign('pa', 'sunil'));
check('Proc A → Proc B (peers): no by hierarchy alone', !h.canAssign('pa', 'pb'));
check('Neeti → Proc A (other branch): no', !h.canAssign('neeti', 'pa'));
check('nobody assigns to themselves via hierarchy', !h.canAssign('sunil', 'sunil'));

console.log('\n4. Departments');
const proc = h.departmentView('Procurement');
check('Procurement has 4 members', proc.members.length === 4);
check('Procurement has NO manager inside the team', proc.hasInternalManager === false);
check('Procurement team reports to Sunil (outside)', names(proc.externalManagers).join() === 'Sunil');
const hr = h.departmentView('HR');
check('HR: Neeti manages inside the team', hr.hasInternalManager && names(hr.internalManagers).join() === 'Neeti');
check('HR: above the team is Sunil', names(hr.externalManagers).join() === 'Sunil');

console.log('\n5. Old label vs real hierarchy');
check('Ruhi manages people but label is employee → flagged', h.labelMismatch('ruhi') === 'manager_by_hierarchy_but_label_employee');
check('Neeti manages HR Junior but label is employee → flagged', h.labelMismatch('neeti') === 'manager_by_hierarchy_but_label_employee');
check('Lone has label manager but no reports → flagged', h.labelMismatch('lone') === 'label_manager_but_no_reports');
check('Superuser label is never flagged', h.labelMismatch('sunil') === null);
check('Plain employee with no reports is fine', h.labelMismatch('pa') === null);

console.log('\n6. Data quality');
const clean = h.issues().filter(i => i.type !== 'no_manager');
check('clean data → no loops / missing managers', clean.length === 0, clean);
check('top-of-chain people are listed as informational', h.issues().filter(i => i.type === 'no_manager').map(i => i.name).sort().join() === 'Lone,Ruhi');

const bad = new OrgHierarchy([
    P('a', 'A', 'X', 'employee', 'b'),
    P('b', 'B', 'X', 'employee', 'c'),
    P('c', 'C', 'X', 'employee', 'a'),          // loop a→b→c→a
    P('d', 'D', 'X', 'employee', 'ghost'),      // manager not an active linked employee
    P('e', 'E', 'X', 'employee', 'e'),          // own manager
    P('f', 'F', 'X', 'employee', 'a'),          // hangs off the loop
]);
const badIssues = bad.issues();
check('loop detected for A, B, C only', badIssues.filter(i => i.type === 'cycle').map(i => i.name).sort().join() === 'A,B,C', badIssues);
check('missing manager detected for D', badIssues.some(i => i.type === 'manager_missing' && i.name === 'D'));
check('self-manager detected for E', badIssues.some(i => i.type === 'self_manager' && i.name === 'E'));
check('chainUp on a loop terminates', bad.chainUp('f').length <= 3);
check('allReports on a loop terminates', bad.allReports('a').length <= 4);
check('canAssign on a loop terminates', typeof bad.canAssign('a', 'f') === 'boolean');

console.log(failures === 0 ? '\n🎉 STEP 2 HIERARCHY TESTS PASSED (offline, no data touched)\n' : `\n❌ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
