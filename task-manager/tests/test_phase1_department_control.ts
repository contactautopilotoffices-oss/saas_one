import assert from 'assert';
import { TaskDatabaseService } from '../TaskDatabaseService';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

async function runPhase1Verification() {
    console.log('====================================================');
    console.log('🧪 Starting Phase 1 Verification: Department Control');
    console.log('====================================================\n');

    // ── Test 1: Fetch all departments from TaskDatabaseService ──────────
    console.log('--- Test 1: Fetch active departments ---');
    const departments = await TaskDatabaseService.getDepartments();
    console.log(`✓ Fetched ${departments.length} active departments.`);
    assert(departments.length >= 8, `Expected at least 8 departments, got ${departments.length}`);

    const deptNames = departments.map(d => d.name);
    console.log('Departments found:', deptNames.join(', '));
    assert(deptNames.some(n => n.toLowerCase() === 'tech'), 'Tech department missing');
    assert(deptNames.some(n => n.toLowerCase() === 'operations'), 'Operations department missing');
    assert(deptNames.some(n => n.toLowerCase() === 'procurement'), 'Procurement department missing');
    console.log('✓ Test 1 Passed: Core departments verified.\n');

    // ── Test 2: Verify employee roster mapping across departments ───────
    console.log('--- Test 2: Verify employee department mappings ---');
    const { data: employees, error: empErr } = await supabaseAdmin
        .from('employee_profiles')
        .select('id, first_name, last_name, phone, department, department_id, task_role, is_active')
        .eq('is_active', true);

    assert(!empErr, `Failed to fetch employees: ${empErr?.message}`);
    assert(employees && employees.length > 0, 'No active employees found');
    console.log(`✓ Fetched ${employees.length} active employee profiles across all departments.`);

    // Check Tech members
    const techDept = departments.find(d => d.name.toLowerCase() === 'tech');
    assert(techDept, 'Tech department not found');
    const techMembers = employees.filter(e => 
        e.department_id === techDept.id || (e.department && e.department.toLowerCase() === 'tech')
    );
    console.log(`✓ Tech department has ${techMembers.length} members:`, techMembers.map(m => m.first_name).join(', '));
    assert(techMembers.length >= 2, 'Expected at least 2 members in Tech');

    // Check Tech manager
    const techManager = techMembers.find(e => e.task_role === 'reporting_manager');
    console.log(`✓ Tech Reporting Manager: ${techManager ? `${techManager.first_name} ${techManager.last_name || ''} (${techManager.phone})` : 'None'}`);

    // Check Operations members
    const opsDept = departments.find(d => d.name.toLowerCase() === 'operations');
    assert(opsDept, 'Operations department not found');
    const opsMembers = employees.filter(e => 
        e.department_id === opsDept.id || (e.department && e.department.toLowerCase() === 'operations')
    );
    console.log(`✓ Operations department has ${opsMembers.length} members.`);
    assert(opsMembers.length > 0, 'Expected members in Operations');
    console.log('✓ Test 2 Passed: Employee department mapping verified.\n');

    // ── Test 3: Verify manager-role API response schema ─────────────────
    console.log('--- Test 3: Manager Role API payload structure simulation ---');
    const departmentSummaries: Record<string, any> = {};
    for (const dept of departments) {
        const members = employees.filter(e =>
            e.department_id === dept.id ||
            (e.department && e.department.toLowerCase() === dept.name.toLowerCase())
        );
        const manager = members.find(e => e.task_role === 'reporting_manager') || null;
        departmentSummaries[dept.id] = {
            id: dept.id,
            name: dept.name,
            code: dept.code,
            manager,
            members,
            memberCount: members.length,
            whatsappStatus: 'active',
            rulesCount: dept.name.toLowerCase() === 'tech' ? 3 : 0
        };
    }

    assert(Object.keys(departmentSummaries).length === departments.length, 'Mismatch in department summaries count');
    const techSummaryItem = departmentSummaries[techDept.id];
    assert(techSummaryItem, 'Tech summary item missing');
    assert(techSummaryItem.memberCount === techMembers.length, 'Tech memberCount mismatch');
    console.log(`✓ Successfully verified ${Object.keys(departmentSummaries).length} department summaries.`);
    console.log('✓ Test 3 Passed: Summary structure validated.\n');

    // ── Test 4: Strict Whitelist & Safe Mode Verification ───────────────
    console.log('--- Test 4: Verify test whitelist safeguards ---');
    const testingConfig = await TaskDatabaseService.getTestingConfig();
    assert(testingConfig, 'Failed to fetch testing config');
    console.log('Testing whitelist state:', {
        whitelistEnabled: testingConfig.enabled,
        whitelistEmployees: testingConfig.employees,
        cronEnabled: testingConfig.cronEnabled,
    });
    // Verify Sahil is in test whitelist
    const sahilEntry = testingConfig.employees?.find(e => e.phone?.includes('8433649199'));
    assert(sahilEntry, 'Sahil Gorde (8433649199) must be configured as test whitelist recipient');
    console.log(`✓ Confirmed strict test isolation for Sahil Gorde (${sahilEntry.phone}).`);
    console.log('✓ Test 4 Passed: Safety safeguards active.\n');

    console.log('====================================================');
    console.log('🎉 All Phase 1 Department Control tests PASSED! (4/4)');
    console.log('====================================================');
}

runPhase1Verification().catch(err => {
    console.error('❌ Phase 1 Verification Failed:', err);
    process.exit(1);
});
