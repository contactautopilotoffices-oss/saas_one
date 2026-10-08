import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 13 Natural Language Task Updates Tests...\n');

    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskNaturalLanguageService } = await import('../TaskNaturalLanguageService');

    // ── Test 1: Intent Parsing Unit Tests ────────────────────────────────────
    console.log('--- Test 1: Natural Language Intent Parsing ---');

    const mockTasks: any[] = [
        { id: '1', title: 'Clean Conference Room 101', status: 'pending' },
        { id: '2', title: 'Inspect HVAC Pantry Unit', status: 'pending' },
        { id: '3', title: 'Update Building Security Log', status: 'pending' },
    ];

    const testPhrases = [
        { text: 'I completed everything today', expectedIntent: 'COMPLETE_ALL_TODAY_TASKS' },
        { text: 'All my work is done', expectedIntent: 'COMPLETE_ALL_TODAY_TASKS' },
        { text: 'calling it a day, wrapped up', expectedIntent: 'COMPLETE_ALL_TODAY_TASKS' },
        { text: 'I finished Conference Room 101', expectedIntent: 'COMPLETE_TASKS', expectedNumber: 1 },
        { text: 'done with the pantry unit', expectedIntent: 'COMPLETE_TASKS', expectedNumber: 2 },
    ];

    for (const tp of testPhrases) {
        const parsed = await TaskNaturalLanguageService.parseIntent(tp.text, mockTasks);
        console.log(`  "${tp.text}" -> Intent: ${parsed.intent}, Tasks: ${parsed.task_numbers} (conf: ${parsed.confidence})`);
        if (parsed.intent !== tp.expectedIntent) {
            throw new Error(`Intent mismatch for "${tp.text}": expected ${tp.expectedIntent}, got ${parsed.intent}`);
        }
        if (tp.expectedNumber && !parsed.task_numbers.includes(tp.expectedNumber)) {
            throw new Error(`Expected task number ${tp.expectedNumber} for "${tp.text}", got ${parsed.task_numbers}`);
        }
    }
    console.log('✓ All natural language phrases classified accurately.');

    // ── Test 2: Database Update via Structured Intent ────────────────────────
    console.log('\n--- Test 2: Applying Natural Language Update to Database ---');
    const employees = await TaskDatabaseService.getAllEmployees();
    if (employees.length === 0) {
        throw new Error('No active employees found in database.');
    }
    const testEmployee = employees.find(e => e.phone_number && e.phone_number.length >= 10) || employees[0];
    const testDate = '2026-10-08';
    const phone = testEmployee.phone_number;

    const task = await TaskDatabaseService.createTaskAssignment({
        employeeId: testEmployee.id,
        title: '[PHASE13] Refill Water Dispensers',
        assignedDate: testDate,
        assignedBy: testEmployee.id
    });
    console.log(`✓ Seeded test task: "${task.title}" (ID: ${task.id})`);

    try {
        const nlResult = await TaskNaturalLanguageService.applyNaturalLanguageUpdate({
            phone,
            text: 'I completed everything today',
            date: testDate
        });

        console.log('Natural Language Update Result:', {
            success: nlResult.success,
            intent: nlResult.intent,
            progress: nlResult.progress,
            reply: nlResult.replyText
        });

        if (!nlResult.success || nlResult.intent !== 'COMPLETE_ALL_TODAY_TASKS') {
            throw new Error('Expected successful COMPLETE_ALL_TODAY_TASKS update');
        }

        // Verify task updated in Supabase
        const { data: dbTask } = await supabaseAdmin
            .from('task_assignments')
            .select('*')
            .eq('id', task.id)
            .single();

        if (dbTask.status !== 'completed' || !dbTask.completed_at) {
            throw new Error(`Task status in DB not updated: ${JSON.stringify(dbTask)}`);
        }
        console.log('✓ Verified task marked completed in Supabase via NL engine.');

        // Verify audit log
        const { data: auditLogs } = await supabaseAdmin
            .from('task_audit_logs')
            .select('*')
            .eq('event_type', 'ai_task_update')
            .eq('target_employee_id', testEmployee.id)
            .order('created_at', { ascending: false })
            .limit(1);

        if (!auditLogs || auditLogs.length === 0) {
            throw new Error('Expected ai_task_update audit log not found');
        }
        console.log('✓ Verified ai_task_update recorded in task_audit_logs.');

    } finally {
        // ── Cleanup ──────────────────────────────────────────────────────────
        console.log('\n--- Cleanup ---');
        await supabaseAdmin
            .from('task_assignments')
            .delete()
            .eq('id', task.id);
        console.log('✓ Cleaned up test task.');
    }

    console.log('\n🎉 ALL PHASE 13 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phase 13 Test Failed:', err);
    process.exit(1);
});
