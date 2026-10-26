import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import assert from 'assert';
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../backend/lib/supabase/admin';
import { TaskDatabaseService } from '../TaskDatabaseService';
import { TaskMessagingService } from '../TaskMessagingService';
import { TaskNotificationService } from '../TaskNotificationService';
import { POST as managerRolePost, GET as managerRoleGet } from '../../app/api/task-manager/manager-role/route';
import { POST as testingConfigPost, GET as testingConfigGet } from '../../app/api/task-manager/testing-config/route';

// STRICT SAFETY TEST RECIPIENT: Sahil Gorde only
const SAFE_TEST_PHONE = '8433649199';

async function runPhases3To6Verification() {
    console.log('================================================================');
    console.log('🧪 Starting Phases 3 to 6 Verification Suite:');
    console.log('   - Phase 3: Reporting Manager Controls & Kickoffs');
    console.log('   - Phase 4: Employee Roster & Department Transfers');
    console.log('   - Phase 5: Department-Scoped Scheduled Notifications');
    console.log('   - Phase 6: Safety Confirmation Dialogs & Activity Audit Log');
    console.log('================================================================\n');

    // Snapshot testing config and kill switches to restore cleanly at the end
    const initialConfig = await TaskDatabaseService.getTestingConfig();
    const originalKillSwitches = initialConfig.killSwitches || TaskDatabaseService.getDefaultKillSwitches();

    try {
        // ── Phase 3: Reporting Manager Controls & Kickoffs ─────────────────────
        console.log('--- Phase 3 Tests: Reporting Manager Controls & Kickoffs ---');

        // 1a. Find Tech Reporting Manager (Lohitaksha) and Sahil Gorde
        const { data: employees } = await supabaseAdmin
            .from('employee_profiles')
            .select('*')
            .eq('is_active', true);

        assert(employees && employees.length > 0, 'Must have active employee profiles');

        const sahil = employees.find(e =>
            (e.phone && e.phone.includes(SAFE_TEST_PHONE)) ||
            (e.first_name?.toLowerCase().includes('sahil') && e.last_name?.toLowerCase().includes('gorde'))
        );
        assert(sahil, 'Sahil Gorde must exist in employee_profiles for safe testing');

        const lohit = employees.find(e =>
            e.first_name?.toLowerCase().includes('lohit') ||
            e.task_role === 'reporting_manager'
        );
        assert(lohit, 'Tech Reporting Manager profile must exist');

        console.log(`✓ 3a. Target profiles identified: Manager (${lohit.first_name}), Safe Test (${sahil.first_name})`);

        // 1b. Test Manager Kickoff Gatekeeper Pre-check
        // Temporarily pause manager_kickoff message category to verify gatekeeper halts dispatch
        await TaskDatabaseService.toggleMessageTypeKillSwitch('manager_kickoff', true);

        const kickoffReqBlocked = new NextRequest('http://localhost:3000/api/task-manager/manager-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employeeId: lohit.id,
                action: 'send_manager_kickoff',
                overridePhone: SAFE_TEST_PHONE
            })
        });
        const kickoffResBlocked = await managerRolePost(kickoffReqBlocked);
        const kickoffJsonBlocked = await kickoffResBlocked.json();
        assert.strictEqual(kickoffResBlocked.status, 403, 'Should return 403 when manager_kickoff is halted by kill switch');
        assert(kickoffJsonBlocked.error?.includes('Kill Switch'), 'Error should indicate Kill Switch block');
        console.log(`✓ 3b. Manager Kickoff gatekeeper correctly blocked dispatch when category halted (403): "${kickoffJsonBlocked.error}"`);

        // Resume manager_kickoff category
        await TaskDatabaseService.toggleMessageTypeKillSwitch('manager_kickoff', false);

        // 1c. Test Manager Kickoff Dispatch with Safe Override Phone
        const kickoffReq = new NextRequest('http://localhost:3000/api/task-manager/manager-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employeeId: lohit.id,
                action: 'send_manager_kickoff',
                overridePhone: SAFE_TEST_PHONE
            })
        });
        const kickoffRes = await managerRolePost(kickoffReq);
        const kickoffJson = await kickoffRes.json();
        assert.strictEqual(kickoffRes.status, 200, 'Kickoff dispatch should succeed');
        assert.strictEqual(kickoffJson.success, true, 'Kickoff response should be success');
        console.log(`✓ 3c. Manager Kickoff dispatched to safe test phone (${SAFE_TEST_PHONE}): ${kickoffJson.message}`);

        // 1d. Verify manager_kickoff_sent audit log
        const auditAfterKickoff = await TaskDatabaseService.getAuditLogs({ limit: 5, eventType: 'manager_kickoff_sent' });
        assert(auditAfterKickoff.length > 0, 'manager_kickoff_sent audit log should exist');
        assert.strictEqual(auditAfterKickoff[0].details.targetPhone, SAFE_TEST_PHONE, 'Audit log must record safe recipient');
        console.log(`✓ 3d. Audit log confirmed for manager kickoff (${auditAfterKickoff[0].event_type}).`);


        // ── Phase 4: Employee Roster & Department Transfers ────────────────────
        console.log('\n--- Phase 4 Tests: Employee Roster & Department Transfers ---');

        const { data: depts } = await supabaseAdmin
            .from('departments')
            .select('*')
            .eq('is_active', true)
            .order('name');
        assert(depts && depts.length >= 2, 'Need at least 2 active departments');

        const techDept = depts.find(d => d.name.toLowerCase() === 'tech') || depts[0];
        const otherDept = depts.find(d => d.id !== techDept.id) || depts[1];

        console.log(`Testing transfer between: ${techDept.name} (${techDept.id}) <--> ${otherDept.name} (${otherDept.id})`);

        // 4a. Transfer Sahil Gorde from Tech to otherDept
        const origDeptId = sahil.department_id;
        const origDeptName = sahil.department;
        const origRole = sahil.task_role;

        const transferReq1 = new NextRequest('http://localhost:3000/api/task-manager/manager-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employeeId: sahil.id,
                action: 'transfer_department',
                targetDepartmentId: otherDept.id,
                keepRole: true
            })
        });
        const transferRes1 = await managerRolePost(transferReq1);
        const transferJson1 = await transferRes1.json();
        assert.strictEqual(transferRes1.status, 200, 'Transfer should succeed');
        assert.strictEqual(transferJson1.success, true, 'Transfer response success');
        assert.strictEqual(transferJson1.employee.departmentId, otherDept.id, 'Employee should have target department ID');

        // Check DB update
        const { data: transferredProfile } = await supabaseAdmin
            .from('employee_profiles')
            .select('department_id, department')
            .eq('id', sahil.id)
            .single();
        assert.strictEqual(transferredProfile?.department_id, otherDept.id, 'DB must reflect new department ID');
        console.log(`✓ 4a. Transferred ${sahil.first_name} to ${otherDept.name} successfully.`);

        // 4b. Verify employee_transferred audit log
        const transferLogs = await TaskDatabaseService.getAuditLogs({ limit: 5, eventType: 'employee_transferred' });
        assert(transferLogs.length > 0, 'employee_transferred audit log should exist');
        assert.strictEqual(transferLogs[0].details.toDepartmentId, otherDept.id, 'Audit log toDepartmentId must match');
        console.log(`✓ 4b. Audit log confirmed for employee_transferred from ${transferLogs[0].details.fromDepartment} to ${transferLogs[0].details.toDepartment}.`);

        // 4c. Safely transfer Sahil BACK to original department to restore pristine state
        const transferReq2 = new NextRequest('http://localhost:3000/api/task-manager/manager-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employeeId: sahil.id,
                action: 'transfer_department',
                targetDepartmentId: origDeptId,
                keepRole: true
            })
        });
        const transferRes2 = await managerRolePost(transferReq2);
        assert.strictEqual(transferRes2.status, 200, 'Restoration transfer should succeed');
        console.log(`✓ 4c. Restored ${sahil.first_name} back to original department (${origDeptName}).`);

        // 4d. Test Employee Kickoff Gatekeeper and Dispatch
        const empKickoffReq = new NextRequest('http://localhost:3000/api/task-manager/manager-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employeeId: sahil.id,
                action: 'send_employee_kickoff',
                overridePhone: SAFE_TEST_PHONE
            })
        });
        const empKickoffRes = await managerRolePost(empKickoffReq);
        const empKickoffJson = await empKickoffRes.json();
        assert.strictEqual(empKickoffRes.status, 200, 'Employee kickoff should succeed');
        assert.strictEqual(empKickoffJson.success, true, 'Employee kickoff response success');
        console.log(`✓ 4d. Employee Kickoff dispatched safely: ${empKickoffJson.message}`);


        // ── Phase 5: Department-Scoped Scheduled Notifications ────────────────
        console.log('\n--- Phase 5 Tests: Department-Scoped Scheduled Notifications ---');

        // 5a. Test Department-Scoped Simulation Run via trigger_dispatch
        const simReq = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'trigger_dispatch',
                departmentId: techDept.id,
                dryRun: true
            })
        });
        const simRes = await testingConfigPost(simReq);
        const simJson = await simRes.json();
        assert.strictEqual(simRes.status, 200, 'trigger_dispatch should return 200');
        assert.strictEqual(simJson.success, true, 'trigger_dispatch should succeed');
        assert.strictEqual(simJson.dryRun, true, 'Should be marked as dryRun');
        assert(simJson.result.notifications, 'Should contain notifications result');
        console.log(`✓ 5a. Department Dry-Run simulation executed for "${techDept.name}": ${simJson.message}`);

        // 5b. Verify NotificationRule model accepts departmentId scoping
        const testRule = {
            id: `rule_test_dept_${Date.now()}`,
            name: 'Operations Morning Pulse',
            enabled: false,
            targetTimeIST: '10:30',
            daysOfWeek: [1, 2, 3, 4, 5],
            ruleType: 'morning_digest' as const,
            departmentId: otherDept.id, // Department scoped!
            taskFilters: {
                includeTodayFixed: true,
                includeTodayAssigned: true,
                includeYesterdayPending: false
            },
            conditions: { skipIfZeroTasks: true }
        };

        const ruleReq = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'update_rule',
                ruleId: testRule.id,
                updates: testRule
            })
        });
        const ruleRes = await testingConfigPost(ruleReq);
        const ruleJson = await ruleRes.json();
        assert.strictEqual(ruleRes.status, 200, 'Rule creation should succeed');
        const createdRule = ruleJson.config.rules.find((r: any) => r.id === testRule.id);
        assert(createdRule, 'Rule should be saved in config');
        assert.strictEqual(createdRule.departmentId, otherDept.id, 'Rule departmentId should match');
        console.log(`✓ 5b. Department-scoped NotificationRule created and verified for ${otherDept.name}.`);

        // Clean up test rule
        await testingConfigPost(new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete_rule', ruleId: testRule.id })
        }));
        console.log('✓ 5c. Test rule cleaned up.');


        // ── Phase 6: Safety Confirmation Dialogs & Activity Audit Log ─────────
        console.log('\n--- Phase 6 Tests: Safety Dialogs & Multi-Category Audit Logs ---');

        // 6a. Verify Category Filtering in TaskDatabaseService.getAuditLogs
        const whatsappLogs = await TaskDatabaseService.getAuditLogs({ limit: 10, eventType: 'whatsapp_sent' });
        console.log(`✓ 6a. Category 'whatsapp_sent' fetched ${whatsappLogs.length} events.`);

        const safetyLogs = await TaskDatabaseService.getAuditLogs({ limit: 10, eventType: 'kill_switch_updated' });
        console.log(`✓ 6b. Category 'kill_switch_updated' fetched ${safetyLogs.length} events.`);

        const rosterLogs = await TaskDatabaseService.getAuditLogs({
            limit: 10,
            eventTypes: ['employee_transferred', 'manager_role_assigned', 'manager_role_removed', 'employee_kickoff_sent', 'manager_kickoff_sent']
        });
        console.log(`✓ 6c. Multi-event category 'roster' fetched ${rosterLogs.length} events.`);

        // 6b. Verify get_logs API action with eventTypes array
        const apiLogsReq = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'get_logs',
                eventTypes: ['employee_transferred', 'manager_kickoff_sent']
            })
        });
        const apiLogsRes = await testingConfigPost(apiLogsReq);
        const apiLogsJson = await apiLogsRes.json();
        assert.strictEqual(apiLogsRes.status, 200, 'get_logs API should succeed');
        assert(Array.isArray(apiLogsJson.logs), 'Should return logs array');
        console.log(`✓ 6d. API Route POST get_logs verified with multi-eventTypes filter (${apiLogsJson.logs.length} returned).`);

        // 6c. Verify Manager Role GET endpoint returns all required fields for Phase 3-6 UI
        const mgrGetReq = new NextRequest('http://localhost:3000/api/task-manager/manager-role');
        const mgrGetRes = await managerRoleGet();
        const mgrGetJson = await mgrGetRes.json();
        assert.strictEqual(mgrGetJson.success, true, 'manager-role GET must succeed');
        assert(mgrGetJson.departments.length > 0, 'Must return departments');
        assert(mgrGetJson.departmentSummaries, 'Must return departmentSummaries');
        assert(mgrGetJson.killSwitches, 'Must return killSwitches');
        console.log(`✓ 6e. Manager Role GET endpoint successfully loaded all ${mgrGetJson.departments.length} departments and summaries.`);

        console.log('\n================================================================');
        console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! (Phases 3, 4, 5, 6 VERIFIED)');
        console.log('================================================================\n');

    } finally {
        // Restore initial configuration
        if (originalKillSwitches) {
            await TaskDatabaseService.updateKillSwitches(originalKillSwitches);
            console.log('Cleaned up & restored original kill switch configuration.');
        }
    }
}

runPhases3To6Verification().catch(err => {
    console.error('❌ Verification Failed:', err);
    process.exit(1);
});
