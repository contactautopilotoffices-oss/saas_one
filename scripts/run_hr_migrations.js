const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function applyHRMigrations() {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL not found in .env.local or .env');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Connecting to PostgreSQL database...');
        const migrationFiles = [
            '20260910000001_hr_ticketing_module.sql',
            '20260910000002_seed_employee_master.sql'
        ];

        for (const file of migrationFiles) {
            const filePath = path.join(__dirname, '..', 'supabase', 'migrations', file);
            console.log(`Executing migration: ${file}...`);
            const sql = fs.readFileSync(filePath, 'utf8');
            await pool.query(sql);
            console.log(`✅ Migration ${file} executed successfully.`);
        }

        const resEmp = await pool.query('SELECT COUNT(*) FROM public.employee_profiles;');
        console.log(`\n🎉 All HR Module migrations & seeds executed cleanly! Seeded ${resEmp.rows[0].count} employee profiles.`);
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        await pool.end();
    }
}

applyHRMigrations();
