const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function run() {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DATABASE_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL not found in .env or .env.local');
        console.error('Please either:');
        console.error('1. Add DATABASE_URL to .env / .env.local');
        console.error('2. Or paste the SQL from supabase/migrations/20261002000001_task_manager_schema.sql into the Supabase Dashboard SQL Editor.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Connecting to PostgreSQL database...');
        const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261002000001_task_manager_schema.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');
        console.log('Executing 20261002000001_task_manager_schema.sql...');
        await pool.query(sql);
        console.log('✅ Task Manager migration applied successfully to PostgreSQL!');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        await pool.end();
    }
}

run();
