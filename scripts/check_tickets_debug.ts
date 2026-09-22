import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
    const { data: users } = await supabaseAdmin.from('users').select('id, email, full_name');
    console.log('=== USERS ===');
    console.log(users);

    const { data: emps } = await supabaseAdmin.from('employee_profiles').select('id, user_id, email, is_hr_authority, is_hr_manager_authority, is_director_authority, reporting_manager_id, employee_code');
    console.log('=== EMPLOYEES ===');
    console.log(emps);

    const { data: tickets } = await supabaseAdmin.from('hr_tickets').select('id, ticket_number, raised_by_user_id, assigned_to_user_id, status, ticket_type, is_confidential, organization_id');
    console.log('=== TICKETS ===');
    console.log(tickets);

    const { data: memberships } = await supabaseAdmin.from('organization_memberships').select('user_id, org_role, organization_id');
    console.log('=== MEMBERSHIPS ===');
    console.log(memberships);
}

main();
