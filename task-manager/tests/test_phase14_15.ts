import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phases 14 & 15 Superuser AI Assistant & Controlled Tools Tests...\n');

    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { PermissionService, PermissionDeniedError } = await import('../PermissionService');
    const { ControlledTaskTools } = await import('../ControlledTaskTools');
    const { SuperuserAIAssistant } = await import('../SuperuserAIAssistant');

    const superuserId = '284eaccc-2c10-48f4-a524-2b448e40e012';
    const superuser = await PermissionService.getActor(superuserId);
    const superuserPhone = superuser.phone_number;
    const testDate = new Date().toISOString().slice(0, 10);

    console.log(`✓ Using Superuser: ${superuser.name}, Phone: ${superuserPhone}`);

    // ── Test 1: Controlled Tools Security ────────────────────────────────────
    console.log('\n--- Test 1: Controlled Tools Role-Based Guard ---');
    const employees = await TaskDatabaseService.getAllEmployees();
    const regularEmployee = employees.find(e => e.role === 'employee') || employees[0];

    // Verify non-superuser is blocked from organisation progress tool
    let blockedAsExpected = false;
    try {
        await ControlledTaskTools.get_organisation_progress(regularEmployee);
    } catch (err: any) {
        if (err instanceof PermissionDeniedError || err.name === 'PermissionDeniedError') {
            blockedAsExpected = true;
            console.log(`✓ Regular employee correctly blocked: ${err.message}`);
        }
    }
    if (!blockedAsExpected && regularEmployee.role === 'employee') {
        throw new Error('Security Failure: Non-superuser was NOT blocked from organisation tool');
    }

    // Verify superuser can execute organisation tool
    const orgToolResult = await ControlledTaskTools.get_organisation_progress(superuser, { date: testDate });
    console.log('Superuser Tool Execution Success:', {
        totalDepartments: orgToolResult.totalDepartments,
        overallCompletion: orgToolResult.overallCompletionPercentage
    });
    if (orgToolResult.totalDepartments !== 14) {
        throw new Error(`Expected 14 departments, got ${orgToolResult.totalDepartments}`);
    }
    console.log('✓ Phase 15: Controlled tools security verified.');

    // ── Test 2: Natural-Language Question Routing ────────────────────────────
    console.log('\n--- Test 2: Natural-Language Leadership Queries ---');

    const queries = [
        {
            q: 'How is Operations doing today?',
            expectedTool: 'get_department_progress',
            mustInclude: 'Operations'
        },
        {
            q: 'What is the Operations team working on?',
            expectedTool: 'get_department_tasks',
            mustInclude: 'Operations'
        },
        {
            q: "Who has not completed today's tasks?",
            expectedTool: 'get_pending_tasks',
            mustInclude: 'Pending Tasks'
        },
        {
            q: 'Show me organisation task progress overview',
            expectedTool: 'get_organisation_progress',
            mustInclude: 'Organisation'
        }
    ];

    for (const item of queries) {
        const result = await SuperuserAIAssistant.handleQuery({
            phone: superuserPhone,
            question: item.q,
            date: testDate
        });

        console.log(`\nQuestion: "${item.q}"`);
        console.log(`  -> Tool used: ${result.toolUsed}`);
        console.log(`  -> Reply snippet: ${result.replyText.slice(0, 100).replace(/\n/g, ' ')}...`);

        if (!result.success) {
            throw new Error(`Query failed: ${result.replyText}`);
        }
        if (result.toolUsed !== item.expectedTool) {
            throw new Error(`Tool mismatch for "${item.q}": expected ${item.expectedTool}, got ${result.toolUsed}`);
        }
        if (!result.replyText.toLowerCase().includes(item.mustInclude.toLowerCase())) {
            throw new Error(`Reply text missing expected keyword "${item.mustInclude}"`);
        }
    }
    console.log('\n✓ Phase 14: Superuser AI Assistant queries routed and formatted accurately.');

    // ── Test 3: Audit Trail ──────────────────────────────────────────────────
    console.log('\n--- Test 3: Audit Trail Verification ---');
    const { data: audits } = await supabaseAdmin
        .from('task_audit_logs')
        .select('*')
        .eq('event_type', 'ai_tool_call')
        .order('created_at', { ascending: false })
        .limit(1);

    if (!audits || audits.length === 0) {
        throw new Error('Expected ai_tool_call audit record not found');
    }
    console.log(`✓ Verified ai_tool_call audit recorded: ID=${audits[0].id}`);

    console.log('\n🎉 ALL PHASES 14 & 15 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phases 14 & 15 Test Failed:', err);
    process.exit(1);
});
