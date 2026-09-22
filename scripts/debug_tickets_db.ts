import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xyz.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Read .env manually
import fs from 'fs';
import path from 'path';

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

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    console.log('--- ALL TICKETS IN DB ---');
    const { data: tickets } = await supabaseAdmin
        .from('hr_tickets')
        .select('id, ticket_number, organization_id, raised_by_user_id, assigned_to_user_id, status, ticket_type, is_confidential, is_anonymous, created_at');
    console.table(tickets);

    console.log('--- ALL USERS ---');
    const { data: users } = await supabaseAdmin.from('users').select('id, email, full_name');
    console.table(users);

    console.log('--- ALL EMPLOYEE PROFILES ---');
    const { data: emps } = await supabaseAdmin.from('employee_profiles').select('id, user_id, email, is_hr_authority, is_hr_manager_authority, is_director_authority, reporting_manager_id, organization_id');
    console.table(emps);

    console.log('--- ALL MEMBERSHIPS ---');
    const { data: mems } = await supabaseAdmin.from('organization_memberships').select('user_id, org_role, organization_id');
    console.table(mems);
}

run();
