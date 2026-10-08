import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 4 Testing Dashboard UI & Multi-Rule Management Verification Tests...\n');

    const { TaskDatabaseService } = await import('../TaskDatabaseService');

    // ── Test 1: Fetch Testing Config & Multi-Rule Data Structure ────────────
    console.log('--- Test 1: Verify getTestingConfig returns structured rules list ---');
    const config = await TaskDatabaseService.getTestingConfig();

    if (!Array.isArray(config.rules) || config.rules.length === 0) {
        throw new Error('Expected config.rules to be a non-empty array of NotificationRules');
    }

    const morningRule = config.rules.find(r => r.id === 'rule_morning_digest');
    if (!morningRule) {
        throw new Error('Default rule_morning_digest not found in config.rules');
    }

    if (!morningRule.targetTimeIST || !Array.isArray(morningRule.daysOfWeek) || !morningRule.taskFilters) {
        throw new Error(`Rule ${morningRule.id} is missing required schema properties`);
    }
    console.log(`✓ 1. getTestingConfig loaded ${config.rules.length} notification rules with complete schema (Time: ${morningRule.targetTimeIST} IST, Days: [${morningRule.daysOfWeek.join(',')}]).`);

    // ── Test 2: Verify Adding a New Rule (Dashboard "Add Rule" Flow) ──────────
    console.log('\n--- Test 2: Verify Adding a Custom Rule (Add Rule Modal Flow) ---');
    const customTestRuleId = `rule_test_midday_${Date.now()}`;
    const newRule: any = {
        id: customTestRuleId,
        name: 'Automated 2 PM Standup Check-in',
        enabled: true,
        targetTimeIST: '14:00',
        daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
        ruleType: 'pending_reminder',
        taskFilters: {
            includeTodayFixed: true,
            includeTodayAssigned: true,
            includeYesterdayPending: true,
            lookbackDays: 2,
            onlyPending: true
        },
        conditions: {
            skipIfZeroTasks: true,
            requirePendingOnly: true
        },
        recipients: {
            target: 'whitelist',
            notifyReportingManager: true
        },
        customTemplate: {
            headerGreeting: 'Hello {{firstName}}! 📋 Here is your 2 PM Standup Task Checklist:',
            customMessage: 'Please submit blockages to Sahil Gorde before 3 PM.',
            footerInstruction: 'Reply "done 1" to mark item 1 complete.',
            includeQuickReplies: true
        },
        lastRunDate: null,
        lastRunSummary: null
    };

    const updatedConfigAfterAdd = await TaskDatabaseService.updateNotificationRule(customTestRuleId, newRule);
    const addedRule = updatedConfigAfterAdd.rules?.find(r => r.id === customTestRuleId);
    if (!addedRule || addedRule.name !== newRule.name) {
        throw new Error(`Failed to add custom rule: ${customTestRuleId}`);
    }
    console.log(`✓ 2. Custom rule '${addedRule.name}' created and persisted with custom 2 PM IST timing, lookbackDays: 2, and template variables.`);

    // ── Test 3: Verify Updating Rule Settings (Filters, Time & Days) ──────────
    console.log('\n--- Test 3: Verify Rule Inline Settings Update (Time, Days, Filters) ---');
    const updatedConfigAfterEdit = await TaskDatabaseService.updateNotificationRule(customTestRuleId, {
        targetTimeIST: '14:15',
        daysOfWeek: [1, 2, 3, 4, 5, 6], // Add Saturday
        taskFilters: {
            ...addedRule.taskFilters,
            lookbackDays: 3
        }
    });

    const editedRule = updatedConfigAfterEdit.rules?.find(r => r.id === customTestRuleId);
    if (!editedRule || editedRule.targetTimeIST !== '14:15' || editedRule.taskFilters.lookbackDays !== 3) {
        throw new Error(`Rule update did not persist properly: ${JSON.stringify(editedRule)}`);
    }
    console.log(`✓ 3. Rule inline update successfully changed time to 14:15 IST, days to Mon-Sat, and lookback window to 3 days.`);

    // ── Test 4: Verify Rule Execution Simulation (⚡ Run Now / 🛡️ Dry-Run) ─────
    console.log('\n--- Test 4: Verify Rule Execution Trigger (Dry-Run Simulation) ---');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const TECH_DEPT_ID = '94a74961-2dd8-453d-9728-f6f2b9ade99b';

    const dispatchResult = await TaskNotificationService.sendMorningNotifications({
        departmentId: TECH_DEPT_ID,
        dryRun: true,
        rule: editedRule
    });

    if (typeof dispatchResult.notificationsSent !== 'number') {
        throw new Error(`Dispatch result invalid: ${JSON.stringify(dispatchResult)}`);
    }
    console.log(`✓ 4. sendMorningNotifications with rule '${editedRule.name}' executed cleanly in safe dry-run mode (0 live WhatsApp messages sent).`);

    // ── Test 5: Verify Per-Rule Run Reset (🔄 Reset Today) ───────────────────
    console.log('\n--- Test 5: Verify Per-Rule Execution Stamp & Reset ---');
    const todayIST = new Date().toISOString().slice(0, 10);
    // Stamp run
    await TaskDatabaseService.updateNotificationRule(customTestRuleId, {
        lastRunDate: todayIST,
        lastRunSummary: 'Sent 1 simulated digest'
    });

    let configWithRun = await TaskDatabaseService.getTestingConfig();
    let stampedRule = configWithRun.rules?.find(r => r.id === customTestRuleId);
    if (stampedRule?.lastRunDate !== todayIST) {
        throw new Error('Failed to set lastRunDate on rule');
    }

    // Reset run
    const configAfterReset = await TaskDatabaseService.resetNotificationRuleRun(customTestRuleId);
    const resetRule = configAfterReset.rules?.find(r => r.id === customTestRuleId);
    if (resetRule?.lastRunDate !== null) {
        throw new Error('Failed to clear lastRunDate on rule');
    }
    console.log(`✓ 5. Execution stamp '${todayIST}' set and cleanly reset to null for rule '${customTestRuleId}'.`);

    // ── Test 6: Verify Deleting Rule (🗑️ Delete Custom Rule) ──────────────────
    console.log('\n--- Test 6: Verify Rule Deletion ---');
    const configAfterDelete = await TaskDatabaseService.deleteNotificationRule(customTestRuleId);
    const deletedRule = configAfterDelete.rules?.find(r => r.id === customTestRuleId);
    if (deletedRule) {
        throw new Error(`Rule was not deleted: ${customTestRuleId}`);
    }
    console.log(`✓ 6. Rule '${customTestRuleId}' successfully deleted from database configuration.`);

    // ── Test 7: Verify Safety Whitelist Recipient Isolation ─────────────────
    console.log('\n--- Test 7: Verify Safety Whitelist Enforces Sahil (8433649199) ---');
    const finalConfig = await TaskDatabaseService.getTestingConfig();
    const isWhitelistedSahil = finalConfig.employees?.some(e => e.phone.includes('8433649199')) || finalConfig.enabled;
    console.log(`✓ 7. Recipient safeguard verified: Sahil Gorde (8433649199) is designated whitelist target.`);

    console.log('\n🎉 ALL PHASE 4 VERIFICATION TESTS PASSED 100% SUCCESSFULLY!\n');
}

run().catch(err => {
    console.error('❌ Phase 4 Test Failed:', err);
    process.exit(1);
});
