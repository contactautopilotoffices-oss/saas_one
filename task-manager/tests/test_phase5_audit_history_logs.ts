import { TaskDatabaseService } from '../TaskDatabaseService';
import { TaskNotificationService } from '../TaskNotificationService';
import { NotificationRule } from '../types';

async function runPhase5AuditTests() {
    console.log('🧪 Starting Phase 5: Notification History & Audit Trail Test Suite...\n');
    let passed = 0;
    let failed = 0;

    const assert = (condition: boolean, testName: string, detail?: string) => {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
            failed++;
        }
    };

    // ── Test 1: Fetch Existing Audit Logs ──────────────────────────────────
    console.log('--- Test 1: getAuditLogs Service Method ---');
    const initialLogs = await TaskDatabaseService.getAuditLogs({ limit: 10, eventType: 'whatsapp_sent' });
    assert(Array.isArray(initialLogs), 'getAuditLogs returns an array');
    console.log(`  ℹ️ Fetched ${initialLogs.length} existing audit logs`);

    // ── Test 2: Trigger Dry-Run Dispatch with Rich Metadata Logging ─────────
    console.log('\n--- Test 2: Dispatch Dry-Run and Verify Audit Trail Recording ---');
    const testRule: NotificationRule = {
        id: 'rule_midday_checkin_test',
        name: 'Phase 5 Midday Check-in Test',
        enabled: true,
        targetTimeIST: '14:00',
        daysOfWeek: [1, 2, 3, 4, 5, 6],
        ruleType: 'pending_reminder',
        taskFilters: {
            includeTodayFixed: true,
            includeTodayAssigned: true,
            includeYesterdayPending: true,
            lookbackDays: 1,
            onlyPending: true
        },
        conditions: {
            skipIfZeroTasks: false,
            requirePendingOnly: false
        },
        customTemplate: {
            headerGreeting: 'Hello {{firstName}}! ⏳ Midday Progress Verification',
            customMessage: 'Automated Phase 5 Test Run',
            footerInstruction: 'Reply "done 1" when completed.',
            includeQuickReplies: true
        },
        recipients: {
            target: 'whitelist'
        }
    };

    const TECH_DEPARTMENT_ID = '94a74961-2dd8-453d-9728-f6f2b9ade99b';
    const dispatchResult = await TaskNotificationService.sendMorningNotifications({
        departmentId: TECH_DEPARTMENT_ID,
        dryRun: true,
        rule: testRule
    });

    assert(dispatchResult.success, 'sendMorningNotifications executed successfully');
    assert(dispatchResult.notificationsSent > 0, `Dispatched notifications (count: ${dispatchResult.notificationsSent})`);

    // Fetch the latest audit log
    const updatedLogs = await TaskDatabaseService.getAuditLogs({ limit: 5, eventType: 'whatsapp_sent' });
    assert(updatedLogs.length > 0, 'Audit logs retrieved after dispatch');

    const latestLog = updatedLogs[0];
    assert(latestLog.event_type === 'whatsapp_sent', 'Event type is "whatsapp_sent"');
    assert(latestLog.details?.dryRun === true, 'Audit log records dryRun: true');
    assert(latestLog.details?.status === 'simulated', 'Audit log records status: "simulated"');
    assert(latestLog.details?.ruleName === 'Phase 5 Midday Check-in Test', 'Audit log captures ruleName accurately');
    assert(typeof latestLog.details?.preview === 'string' && latestLog.details?.preview.length > 10, 'Audit log stores full message preview');

    // ── Test 3: Verify Recipient Phone Safeguard ────────────────────────────
    console.log('\n--- Test 3: Recipient Phone Safeguard Verification ---');
    const testingConfig = await TaskDatabaseService.getTestingConfig();
    console.log(`  ℹ️ Whitelist enabled: ${testingConfig.enabled}`);
    
    // In current dispatch, verify strictly isolated to Sahil
    for (const d of dispatchResult.details) {
        console.log(`  ℹ️ Dispatched to: ${d.employeeName} (${d.phone})`);
        if (testingConfig.enabled) {
            const isSahil = d.phone?.includes('8433649199') || d.employeeName?.toLowerCase().includes('sahil');
            assert(isSahil, `Recipient strictly isolated to Sahil Gorde (found: ${d.employeeName} - ${d.phone})`);
        }
    }

    // Also assert the latest audit log is for Sahil
    assert(
        latestLog.details?.phone?.includes('8433649199') || latestLog.details?.employeeName?.toLowerCase().includes('sahil'),
        `Latest audit log target is Sahil Gorde (${latestLog.details?.employeeName})`
    );

    // ── Test 4: Verify Custom Template Ingestion in Log Preview ─────────────
    console.log('\n--- Test 4: Message Preview Content Verification ---');
    const testPreview = latestLog.details?.preview || '';
    assert(testPreview.includes('Midday Progress Verification'), 'Preview contains custom greeting header');
    assert(testPreview.includes('Automated Phase 5 Test Run'), 'Preview contains custom message note');
    assert(testPreview.includes('Reply "done 1" when completed.'), 'Preview contains footer instructions');

    console.log('\n--- Final Results ---');
    console.log(`Passed: ${passed} | Failed: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    } else {
        console.log('🎉 All Phase 5 Notification History & Audit Trail tests passed!\n');
    }
}

runPhase5AuditTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
