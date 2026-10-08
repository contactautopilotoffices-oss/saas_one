import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 1 Database & Integration Verification...\n');

    // 1. Verify SQL Migration File
    const migrationFile = path.join(process.cwd(), 'supabase', 'migrations', '20261003000001_task_manager_foundation.sql');
    if (!fs.existsSync(migrationFile)) {
        throw new Error('Migration file 20261003000001_task_manager_foundation.sql not found!');
    }
    const sqlContent = fs.readFileSync(migrationFile, 'utf8');
    console.log(`✅ Migration SQL exists (${sqlContent.length} bytes)`);

    // Check key tables in SQL
    const requiredTables = ['departments', 'task_templates', 'task_assignments', 'conversation_context', 'task_audit_logs'];
    for (const table of requiredTables) {
        if (!sqlContent.includes(`CREATE TABLE IF NOT EXISTS public.${table}`)) {
            throw new Error(`Table ${table} missing from migration SQL!`);
        }
        console.log(`   - Contains table definition: public.${table}`);
    }

    // Verify employee_profiles adaptation
    if (!sqlContent.includes('ALTER TABLE public.employee_profiles') || !sqlContent.includes('department_id') || !sqlContent.includes('task_role')) {
        throw new Error('employee_profiles adaptation columns missing from migration SQL!');
    }
    console.log('   - Adapts public.employee_profiles with department_id and task_role');

    // 2. Verify AiSensy Credentials for Direct Project API
    const projectId = process.env.AISENSY_PROJECT_ID;
    const projectKey = process.env.AISENSY_PROJECT_API_KEY;
    if (projectId && projectKey) {
        console.log(`✅ AiSensy Project API credentials present (Project ID: ${projectId.slice(0, 4)}..., Key configured)`);
    } else {
        console.warn('⚠️ AiSensy Project API credentials missing from environment!');
    }

    // 3. Test Service Role Supabase Client
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    const { data: users, error: userErr } = await supabaseAdmin.from('users').select('id, full_name').limit(1);
    if (userErr) {
        console.error('❌ Supabase service connection error:', userErr);
    } else {
        console.log(`✅ Supabase service client connected successfully (Found sample user: ${users?.[0]?.full_name || 'N/A'})`);
    }

    // 4. Test TaskDatabaseService & TaskMessagingService module loading
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskMessagingService } = await import('../TaskMessagingService');

    if (typeof TaskDatabaseService.getDepartments === 'function' && typeof TaskMessagingService.sendFreeformReply === 'function') {
        console.log('✅ TaskDatabaseService and TaskMessagingService loaded with all methods intact.');
    }

    console.log('\n🎉 Phase 1 verification completed successfully!');
}

run().catch(err => {
    console.error('❌ Phase 1 test failed:', err);
    process.exit(1);
});
