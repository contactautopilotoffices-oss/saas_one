import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 2 Task Filters & Carry-Forward Verification Tests...\n');

    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskNotificationService } = await import('../TaskNotificationService');

    // 1. Identify test employee (Sahil Gorde)
    const employees = await TaskDatabaseService.getAllEmployees();
    const sahil = employees.find(e => e.phone_number?.includes('8433649199') || e.name.toLowerCase().includes('sahil')) || employees[0];
    if (!sahil) throw new Error('Test employee not found');

    console.log(`Using test employee: ${sahil.name} (${sahil.phone_number})`);

    const todayStr = '2026-10-05';
    const yesterdayStr = '2026-10-04';
    const createdAssignmentIds: string[] = [];

    try {
        // Create an uncompleted task from yesterday for testing carry-forward
        const { data: yTask, error: yErr } = await supabaseAdmin
            .from('task_assignments')
            .insert({
                employee_id: sahil.id,
                title: 'Review Server Firewall Logs (Carry Forward Test)',
                assigned_date: yesterdayStr,
                status: 'pending'
            })
            .select('*')
            .single();

        if (yErr || !yTask) throw yErr || new Error('Failed to create yesterday test task');
        createdAssignmentIds.push(yTask.id);

        // Create a completed task for today
        const { data: tCompleted, error: tcErr } = await supabaseAdmin
            .from('task_assignments')
            .insert({
                employee_id: sahil.id,
                title: 'Daily Morning Standup Sync',
                assigned_date: todayStr,
                status: 'completed',
                completed_at: new Date().toISOString()
            })
            .select('*')
            .single();

        if (tcErr || !tCompleted) throw tcErr || new Error('Failed to create today completed task');
        createdAssignmentIds.push(tCompleted.id);

        // ── Test 1: getFilteredAssignments with carry-forward ────────────────
        console.log('\n--- Test 1: Verify Carry-Forward Querying ---');
        const tasksWithCarry = await TaskDatabaseService.getFilteredAssignments({
            employeeId: sahil.id,
            date: todayStr,
            filters: {
                includeTodayFixed: true,
                includeTodayAssigned: true,
                includeYesterdayPending: true,
                lookbackDays: 1,
                onlyPending: false
            }
        });

        const carried = tasksWithCarry.find(t => t.id === yTask.id);
        if (!carried || !carried.isCarriedForward) {
            throw new Error('Yesterday pending task was not carried forward with isCarriedForward=true');
        }
        console.log(`✓ 1. Successfully carried forward yesterday uncompleted task: "${carried.title}" (isCarriedForward: ${carried.isCarriedForward})`);

        // ── Test 2: getFilteredAssignments without carry-forward ─────────────
        console.log('\n--- Test 2: Verify Disabling Carry-Forward ---');
        const tasksWithoutCarry = await TaskDatabaseService.getFilteredAssignments({
            employeeId: sahil.id,
            date: todayStr,
            filters: {
                includeTodayFixed: true,
                includeTodayAssigned: true,
                includeYesterdayPending: false
            }
        });

        if (tasksWithoutCarry.some(t => t.id === yTask.id)) {
            throw new Error('Yesterday task appeared even though includeYesterdayPending was false');
        }
        console.log('✓ 2. Successfully excluded yesterday tasks when includeYesterdayPending is false.');

        // ── Test 3: getFilteredAssignments with onlyPending: true ────────────
        console.log('\n--- Test 3: Verify onlyPending filter ---');
        const pendingOnlyTasks = await TaskDatabaseService.getFilteredAssignments({
            employeeId: sahil.id,
            date: todayStr,
            filters: {
                includeTodayFixed: true,
                includeTodayAssigned: true,
                includeYesterdayPending: true,
                onlyPending: true
            }
        });

        if (pendingOnlyTasks.some(t => t.status === 'completed')) {
            throw new Error('Completed task found when onlyPending is true');
        }
        console.log(`✓ 3. onlyPending filter verified: ${pendingOnlyTasks.length} pending tasks returned, 0 completed.`);

        // ── Test 4: Dynamic Digest Formatting ────────────────────────────────
        console.log('\n--- Test 4: Verify Multi-Type Digest Builders ---');
        const morningDigest = TaskNotificationService.buildMorningDigest(sahil.name, tasksWithCarry);
        if (!morningDigest.includes('Carried Forward')) {
            throw new Error('Morning digest missing [Carried Forward] label');
        }
        console.log('✓ 4a. Morning digest includes [Carried Forward] indicator.');

        const middayReminder = TaskNotificationService.buildMiddayReminder(sahil.name, tasksWithCarry);
        if (!middayReminder.includes('Midday Progress Check-in')) {
            throw new Error('Midday reminder heading missing');
        }
        console.log('✓ 4b. Midday reminder generated with progress check-in format.');

        const eodSummary = TaskNotificationService.buildEODSummary(sahil.name, tasksWithCarry);
        if (!eodSummary.includes('End-of-Day Task Summary') || !eodSummary.includes('Completed today:')) {
            throw new Error('EOD summary missing summary statistics');
        }
        console.log('✓ 4c. End-of-Day summary generated with completion metrics.');

        // ── Test 5: End-to-End sendMorningNotifications with Rule (Dry-Run) ──
        console.log('\n--- Test 5: Verify sendMorningNotifications with Phase 2 Rule (Dry-Run) ---');
        const testRule: any = {
            id: 'rule_pending_reminder',
            name: 'Midday Progress Check-in',
            enabled: true,
            targetTimeIST: '14:30',
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
                skipIfZeroTasks: true,
                requirePendingOnly: true
            },
            recipients: {
                target: 'whitelist'
            }
        };

        const result = await TaskNotificationService.sendMorningNotifications({
            date: todayStr,
            dryRun: true, // Always safe dryRun
            rule: testRule
        });

        if (!result.success || result.notificationsSent === 0) {
            throw new Error(`Expected at least 1 notification generated in dry-run, got ${result.notificationsSent}`);
        }
        const sahilDetail = result.details.find(d => d.phone.includes('8433649199'));
        if (!sahilDetail?.digestPreview?.includes('Midday Progress Check-in')) {
            throw new Error('Digest preview did not use midday check-in format');
        }
        console.log(`✓ 5. sendMorningNotifications with Rule executed cleanly: ${result.notificationsSent} simulated digests generated.`);

    } finally {
        // Clean up test tasks
        if (createdAssignmentIds.length > 0) {
            await supabaseAdmin.from('task_assignments').delete().in('id', createdAssignmentIds);
            console.log(`\n🧹 Cleaned up ${createdAssignmentIds.length} temporary test task assignments.`);
        }
    }

    console.log('\n🎉 ALL PHASE 2 VERIFICATION TESTS PASSED 100% SUCCESSFULLY!\n');
}

run().catch(err => {
    console.error('❌ Phase 2 test failed:', err);
    process.exit(1);
});
