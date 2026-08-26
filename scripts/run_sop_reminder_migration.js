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
        const sqlPath = path.join(__dirname, '../backend/db/migrations/20260825_sop_reminder_logs.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Executing migration 20260825_sop_reminder_logs.sql ...');
        await pool.query(sql);
        console.log('Migration executed successfully!');

        // Verify table
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'sop_reminder_logs'
            ORDER BY ordinal_position;
        `);
        console.log('Columns in sop_reminder_logs:');
        console.table(res.rows);
    } catch (err) {
        console.error('Error running migration:', err);
    } finally {
        await pool.end();
    }
}

runMigration();
