const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function run() {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DATABASE_URL;
    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261003000001_task_manager_foundation.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    if (!dbUrl) {
        console.log('\n======================================================================');
        console.log('📌 NOTE FOR PHASE 1 DATABASE MIGRATION');
        console.log('======================================================================');
        console.log('DATABASE_URL is not set in your .env or .env.local.');
        console.log('To apply the database tables:');
        console.log('1. Open your Supabase Dashboard SQL Editor.');
        console.log('2. Copy and paste the contents of:');
        console.log(`   ${migrationPath}`);
        console.log('3. Click "Run" to create departments, employees, task_templates, task_assignments, and conversation_context.');
        console.log('======================================================================\n');
        return;
    }

    const pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Connecting to PostgreSQL database...');
        console.log('Executing 20261003000001_task_manager_foundation.sql...');
        await pool.query(sql);
        console.log('✅ Phase 1 Task Manager migration applied successfully to PostgreSQL!');
    } catch (err) {
        console.error('❌ Migration execution error:', err);
    } finally {
        await pool.end();
    }
}

run();
