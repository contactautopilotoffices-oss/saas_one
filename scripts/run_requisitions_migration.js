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
        const sqlPath = path.join(__dirname, '../backend/db/migrations/20260819_enhanced_monthly_requisitions.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Executing migration 20260819_enhanced_monthly_requisitions.sql ...');
        await pool.query(sql);
        console.log('Migration executed successfully!');

        // Verify tables and columns
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'property_monthly_requisitions'
            ORDER BY ordinal_position;
        `);
        console.log('Columns in property_monthly_requisitions:');
        console.table(res.rows);

        const res2 = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'requisition_items'
            ORDER BY ordinal_position;
        `);
        console.log('Columns in requisition_items:');
        console.table(res2.rows);

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

runMigration();
