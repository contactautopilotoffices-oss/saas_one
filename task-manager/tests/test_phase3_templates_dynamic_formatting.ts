import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 3 Dynamic Templates & Custom Formatting Verification Tests...\n');

    const { TaskNotificationService } = await import('../TaskNotificationService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');

    // 1. Identify test employee (Sahil Gorde)
    const employees = await TaskDatabaseService.getAllEmployees();
    const sahil = employees.find(e => e.phone_number?.includes('8433649199') || e.name.toLowerCase().includes('sahil')) || employees[0];
    if (!sahil) throw new Error('Test employee not found');

    console.log(`Using test employee: ${sahil.name} (${sahil.phone_number})`);

    const targetDate = '2026-10-05';

    // ── Test 1: Variable Substitution Engine ─────────────────────────────────
    console.log('\n--- Test 1: Verify Template Variable Substitution ---');
    const rawTemplate = 'Hi {{firstName}} ({{fullName}})! You have {{totalTasks}} tasks today ({{pendingTasks}} pending, {{completedTasks}} done) on {{date}}.';
    const substituted = TaskNotificationService.applyTemplateVariables(rawTemplate, {
        firstName: 'Sahil',
        fullName: 'Sahil Gorde',
        totalTasks: 5,
        pendingTasks: 3,
        completedTasks: 2,
        date: targetDate
    });

    const expected = `Hi Sahil (Sahil Gorde)! You have 5 tasks today (3 pending, 2 done) on ${targetDate}.`;
    if (substituted !== expected) {
        throw new Error(`Variable substitution mismatch!\nExpected: "${expected}"\nGot: "${substituted}"`);
    }
    console.log('✓ 1. All dynamic variables ({{firstName}}, {{fullName}}, {{totalTasks}}, {{pendingTasks}}, {{completedTasks}}, {{date}}) substituted correctly.');

    // ── Test 2: Overdue Task Alert Formatter ──────────────────────────────────
    console.log('\n--- Test 2: Verify Overdue Task Alert Formatter ---');
    const sampleOverdueTasks: any = [
        {
            id: 'task-overdue-1',
            title: 'Fix Database Connection Pool Leak',
            status: 'pending',
            assigned_date: '2026-10-02' // 3 days overdue
        }
    ];

    const overdueAlert = TaskNotificationService.buildOverdueAlert(sahil.name, sampleOverdueTasks, targetDate);
    if (!overdueAlert.includes('Overdue Task Alert') || !overdueAlert.includes('3d overdue')) {
        throw new Error(`Overdue alert did not format properly:\n${overdueAlert}`);
    }
    console.log('✓ 2. Overdue task alert correctly calculates days overdue (3d overdue) and applies urgent alert banner.');

    // ── Test 3: Custom Rule Template Rendering ───────────────────────────────
    console.log('\n--- Test 3: Verify Custom Rule Template Rendering in buildFormattedDigest ---');
    const customRule: any = {
        id: 'rule_custom_test',
        name: 'Sprint Kickoff Alert',
        enabled: true,
        targetTimeIST: '09:00',
        daysOfWeek: [1, 2, 3, 4, 5, 6],
        ruleType: 'morning_digest',
        taskFilters: {
            includeTodayFixed: true,
            includeTodayAssigned: true,
            includeYesterdayPending: false
        },
        conditions: {
            skipIfZeroTasks: false
        },
        recipients: {
            target: 'whitelist'
        },
        customTemplate: {
            headerGreeting: '🚀 Good morning {{firstName}}, let\'s crush the sprint!',
            customMessage: '📢 Reminder: Team sync is scheduled at 4:00 PM today.',
            footerInstruction: '⚡ Please update your task status promptly throughout the day.',
            includeQuickReplies: true
        }
    };

    const sampleTasks: any = [
        {
            id: 'task-1',
            title: 'Review PR for Multi-Rule Notification Engine',
            status: 'pending',
            assigned_date: targetDate
        }
    ];

    const customDigest = TaskNotificationService.buildFormattedDigest(customRule, sahil.name, sampleTasks, targetDate);

    if (!customDigest.includes('Good morning Sahil, let\'s crush the sprint!') ||
        !customDigest.includes('Team sync is scheduled at 4:00 PM') ||
        !customDigest.includes('Review PR for Multi-Rule Notification Engine') ||
        !customDigest.includes('Please update your task status promptly')) {
        throw new Error(`Custom template did not render expected sections:\n${customDigest}`);
    }
    console.log('✓ 3. Custom rule template rendered with personalized greeting, announcement text, task list, and custom footer.');

    // ── Test 4: sendMorningNotifications with Custom Rule (Safe Dry-Run) ─────
    console.log('\n--- Test 4: Verify sendMorningNotifications with Phase 3 Custom Template (Dry-Run) ---');
    const result = await TaskNotificationService.sendMorningNotifications({
        date: targetDate,
        dryRun: true, // Always safe dryRun
        rule: customRule
    });

    if (!result.success || result.notificationsSent === 0) {
        throw new Error(`Expected at least 1 simulated notification in dry-run, got ${result.notificationsSent}`);
    }
    const sahilDetail = result.details.find(d => d.phone.includes('8433649199'));
    if (!sahilDetail?.digestPreview?.includes('crush the sprint!')) {
        throw new Error('Dry-run preview did not use the custom template formatting');
    }
    console.log(`✓ 4. sendMorningNotifications with custom template generated simulated digest cleanly for Sahil (${sahil.phone_number}).`);

    console.log('\n🎉 ALL PHASE 3 VERIFICATION TESTS PASSED 100% SUCCESSFULLY!\n');
}

run().catch(err => {
    console.error('❌ Phase 3 test failed:', err);
    process.exit(1);
});
