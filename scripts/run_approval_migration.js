const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

async function runMigration() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL not found in environment');
        return;
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const sqlPath = path.join(__dirname, '../backend/db/migrations/20260903_user_approval_flow.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Executing migration 20260903_user_approval_flow.sql ...');
        await pool.query(sql);
        console.log('Migration executed successfully!');

        // Verify users columns
        const res = await pool.query(`
            SELECT column_name, data_type, column_default, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name IN ('is_approved', 'approval_status', 'approved_by', 'approved_at', 'rejection_reason')
            ORDER BY ordinal_position;
        `);
        console.log('Columns in users:');
        console.table(res.rows);

        // Check user approval counts
        const countRes = await pool.query(`
            SELECT approval_status, is_approved, count(*) 
            FROM users 
            GROUP BY approval_status, is_approved;
        `);
        console.log('User status breakdown:');
        console.table(countRes.rows);

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

runMigration();
