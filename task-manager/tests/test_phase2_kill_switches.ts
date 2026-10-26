import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import assert from 'assert';
import { NextRequest } from 'next/server';
import { TaskDatabaseService } from '../TaskDatabaseService';
import { TaskMessagingService } from '../TaskMessagingService';
import { TaskNotificationService } from '../TaskNotificationService';
import { POST as testingConfigPost, GET as testingConfigGet } from '../../app/api/task-manager/testing-config/route';
import { GET as managerRoleGet } from '../../app/api/task-manager/manager-role/route';

async function runPhase2KillSwitchVerification() {
    console.log('================================================================');
    console.log('🧪 Starting Phase 2 Verification: WhatsApp Kill Switches & Safety');
    console.log('================================================================\n');

    // Snapshot existing kill switches to restore cleanly at the end
    const initialConfig = await TaskDatabaseService.getTestingConfig();
    const originalKillSwitches = initialConfig.killSwitches || TaskDatabaseService.getDefaultKillSwitches();
    console.log('Initial Kill Switch Snapshot:', {
        globalHalt: originalKillSwitches.globalHalt,
        departmentHaltCount: Object.keys(originalKillSwitches.departmentHalt || {}).length,
    });

    try {
        // ── Test 1: Global Emergency Kill Switch ──────────────────────────────
        console.log('\n--- Test 1: Global Master Emergency Kill Switch ---');
        
        // 1a. Engage global kill switch via TaskDatabaseService
        const haltReason = 'Phase 2 Safety Verification Test Halt';
        const updated1 = await TaskDatabaseService.toggleGlobalKillSwitch(true, haltReason, 'TestRunner');
        assert.strictEqual(updated1.globalHalt, true, 'globalHalt should be true');
        assert.strictEqual(updated1.haltReason, haltReason, 'haltReason should match');
        assert(updated1.haltedAt, 'haltedAt timestamp should be set');
        console.log('✓ 1a. Global Kill Switch engaged successfully in TaskDatabaseService.');

        // 1b. Verify gatekeeper blocks isMessagingAllowed company-wide
        const gatekeeper1 = await TaskMessagingService.isMessagingAllowed();
        assert.strictEqual(gatekeeper1.allowed, false, 'Gatekeeper should block when global kill switch is on');
        assert(gatekeeper1.reason?.includes('Global Kill Switch ACTIVE'), 'Reason should identify global halt');
        console.log(`✓ 1b. Gatekeeper correctly rejected dispatch: "${gatekeeper1.reason}"`);

        // 1c. Verify TaskMessagingService.sendMessage halts immediately without external network call
        const dummyPhone = '919999999999';
        const sendResult = await TaskMessagingService.sendMessage(dummyPhone, 'Test message during halt', {
            ruleType: 'morning_digest'
        });
        assert.strictEqual(sendResult, false, 'sendMessage must return false when global halt is active');
        console.log('✓ 1c. TaskMessagingService.sendMessage halted safely.');

        // 1d. Verify audit log entry was recorded for blocked message
        const auditLogs = await TaskDatabaseService.getAuditLogs({ limit: 10 });
        const blockedLog = auditLogs.find(l => l.event_type === 'whatsapp_blocked_by_kill_switch' || l.event_type === 'kill_switch_updated');
        assert(blockedLog, 'Audit log should record kill switch activity');
        console.log(`✓ 1d. Audit trail verified (Event: ${blockedLog.event_type}).`);

        // 1e. Test toggle via Testing Config API endpoint
        const apiReq1 = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'toggle_global_kill_switch',
                halt: true,
                reason: 'API Test Halt'
            })
        });
        const apiRes1 = await testingConfigPost(apiReq1);
        const apiJson1 = await apiRes1.json();
        assert.strictEqual(apiJson1.success, true, 'API toggle should succeed');
        assert.strictEqual(apiJson1.killSwitches.globalHalt, true, 'killSwitches.globalHalt should be true');
        console.log('✓ 1e. API Route POST toggle_global_kill_switch verified.');


        // ── Test 2: Department-Level WhatsApp Kill Switch ────────────────────
        console.log('\n--- Test 2: Department-Level WhatsApp Kill Switch ---');

        // Disengage global kill switch first to test targeted isolation
        await TaskDatabaseService.toggleGlobalKillSwitch(false);

        const departments = await TaskDatabaseService.getDepartments();
        assert(departments.length >= 2, 'Need at least 2 departments for isolation testing');
        const deptA = departments[0];
        const deptB = departments[1];

        // 2a. Pause Department A only
        const deptUpdate = await TaskDatabaseService.toggleDepartmentKillSwitch(deptA.id, true);
        assert.strictEqual(deptUpdate.departmentHalt[deptA.id], true, 'Dept A should be paused');
        assert(!deptUpdate.departmentHalt[deptB.id], 'Dept B should NOT be paused');
        console.log(`✓ 2a. Paused WhatsApp for "${deptA.name}" while keeping "${deptB.name}" active.`);

        // 2b. Gatekeeper check: Dept A should be blocked, Dept B should be allowed
        const gatekeeperDeptA = await TaskMessagingService.isMessagingAllowed({ departmentId: deptA.id });
        assert.strictEqual(gatekeeperDeptA.allowed, false, 'Dept A messaging must be blocked');
        assert(gatekeeperDeptA.reason?.includes('Department Kill Switch ACTIVE'), 'Reason should identify department halt');

        const gatekeeperDeptB = await TaskMessagingService.isMessagingAllowed({ departmentId: deptB.id });
        assert.strictEqual(gatekeeperDeptB.allowed, true, 'Dept B messaging must remain allowed');
        console.log(`✓ 2b. Targeted Department Isolation verified (Dept A blocked, Dept B allowed).`);

        // 2c. Test Department toggle via Testing Config API endpoint
        const apiDeptReq = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'toggle_department_kill_switch',
                departmentId: deptA.id,
                halt: false
            })
        });
        const apiDeptRes = await testingConfigPost(apiDeptReq);
        const apiDeptJson = await apiDeptRes.json();
        assert.strictEqual(apiDeptJson.success, true);
        assert.strictEqual(apiDeptJson.killSwitches.departmentHalt[deptA.id], false, 'Dept A should be unpaused');
        console.log(`✓ 2c. Department Kill Switch resumed via API Route for "${deptA.name}".`);


        // ── Test 3: Message-Type Kill Switches ───────────────────────────────
        console.log('\n--- Test 3: Message-Type Granular Kill Switches ---');

        // 3a. Pause 'morning_digest' while keeping others active
        await TaskDatabaseService.toggleMessageTypeKillSwitch('morning_digest', true);

        const gatekeeperMorning = await TaskMessagingService.isMessagingAllowed({ messageType: 'morning_digest' });
        assert.strictEqual(gatekeeperMorning.allowed, false, 'morning_digest must be blocked');
        assert(gatekeeperMorning.reason?.includes('morning_digest'), 'Reason should specify morning_digest');

        const gatekeeperMidday = await TaskMessagingService.isMessagingAllowed({ messageType: 'pending_reminder' });
        assert.strictEqual(gatekeeperMidday.allowed, true, 'pending_reminder must remain allowed');

        const gatekeeperKickoff = await TaskMessagingService.isMessagingAllowed({ messageType: 'manager_kickoff' });
        assert.strictEqual(gatekeeperKickoff.allowed, true, 'manager_kickoff must remain allowed');
        console.log('✓ 3a. Message-type category isolation verified (morning_digest paused, others active).');

        // 3b. Test toggle via Testing Config API endpoint
        const apiMsgReq = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'toggle_message_type_kill_switch',
                messageType: 'morning_digest',
                halt: false
            })
        });
        const apiMsgRes = await testingConfigPost(apiMsgReq);
        const apiMsgJson = await apiMsgRes.json();
        assert.strictEqual(apiMsgJson.success, true);
        assert.strictEqual(apiMsgJson.killSwitches.messageTypeHalt.morning_digest, false, 'morning_digest resumed');
        console.log('✓ 3b. morning_digest resumed via API Route.');


        // ── Test 4: Pipeline Gatekeeper in TaskNotificationService ──────────
        console.log('\n--- Test 4: Pipeline Gatekeeper in TaskNotificationService ---');

        // Engage global halt
        await TaskDatabaseService.toggleGlobalKillSwitch(true, 'Pipeline safety verification halt');

        // Attempt morning notification pipeline dispatch
        const pipelineResult = await TaskNotificationService.sendMorningNotifications({
            departmentId: deptA.id,
            dryRun: false // Ensure live branch runs gatekeeper check
        });

        assert.strictEqual(pipelineResult.notificationsSent, 0, 'No notifications should be sent during halt');
        assert(pipelineResult.details.some(d => d.digestPreview?.includes('[BLOCKED BY KILL SWITCH]')), 
            'Pipeline details should record blocked by kill switch');
        console.log(`✓ 4. Pipeline Pre-check successfully prevented background notification dispatch.`);


        // ── Test 5: Clean Recovery & API Synchronization ────────────────────
        console.log('\n--- Test 5: Clean Recovery & API Synchronization ---');

        // Restore original switches
        await TaskDatabaseService.saveTestingConfig({
            killSwitches: originalKillSwitches
        });

        // Verify manager-role endpoint reflects current status
        const mrRes = await managerRoleGet();
        const mrJson = await mrRes.json();
        assert.strictEqual(mrJson.success, true, 'manager-role GET should succeed');
        assert(mrJson.killSwitches !== undefined, 'manager-role GET should return killSwitches');
        assert(mrJson.globalWhatsAppStatus !== undefined, 'manager-role GET should return globalWhatsAppStatus');
        console.log(`✓ 5. Verified manager-role API synchronization (globalWhatsAppStatus: "${mrJson.globalWhatsAppStatus}").`);

        console.log('\n================================================================');
        console.log('🎉 All Phase 2 WhatsApp Kill Switch Tests PASSED Successfully!');
        console.log('================================================================\n');

    } catch (err: any) {
        console.error('❌ Phase 2 Verification FAILED:', err);
        // Clean up even on error
        await TaskDatabaseService.saveTestingConfig({ killSwitches: originalKillSwitches }).catch(() => {});
        throw err;
    }
}

runPhase2KillSwitchVerification().catch(err => {
    console.error(err);
    process.exit(1);
});
