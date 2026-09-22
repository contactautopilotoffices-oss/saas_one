const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) envPath = path.join(process.cwd(), '.env.local');

if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    for (const line of envConfig.split('\n')) {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            const value = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
            if (key && !process.env[key]) process.env[key] = value;
        }
    }
}

async function run() {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DATABASE_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL not found in environment');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Connecting to PostgreSQL database...');
        const filePath = path.join(process.cwd(), 'supabase', 'migrations', '20260919000006_fix_hr_tickets_status_constraint.sql');
        const sql = fs.readFileSync(filePath, 'utf8');
        console.log('Executing migration 20260919000006_fix_hr_tickets_status_constraint.sql...');
        await pool.query(sql);
        console.log('✅ Status constraint migration applied successfully to PostgreSQL!');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        await pool.end();
    }
}

run();
