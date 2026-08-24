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
        const sqlPath = path.join(__dirname, '../supabase/migrations/20260824000001_property_monthly_requisition_budgets.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Executing migration 20260824000001_property_monthly_requisition_budgets.sql ...');
        await pool.query(sql);
        console.log('Migration executed successfully!');

        // Check rows in property_monthly_requisition_budgets
        const res = await pool.query(`
            SELECT pmrb.id, pmrb.site_name, pmrb.floor_tag, pmrb.hk_budget, pmrb.beverage_budget, pmrb.total_budget, p.name as prop_name
            FROM property_monthly_requisition_budgets pmrb
            LEFT JOIN properties p ON p.id = pmrb.property_id
            ORDER BY pmrb.total_budget DESC;
        `);
        console.log(`Seeded ${res.rows.length} property budgets:`);
        console.table(res.rows);
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

runMigration();
