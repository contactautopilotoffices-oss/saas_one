import { createClient } from '@supabase/supabase-js';
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
    const orgId = '211e1330-ad83-446d-941f-dcea48396798';
    const userId = '990965fe-039a-4144-8880-9e7a9f5f175b';
    const role = 'hr_head';

    let query = supabaseAdmin
        .from('hr_tickets')
        .select(`
            *,
            category:hr_ticket_categories(*),
            raised_by:users!raised_by_user_id(id, email, full_name),
            assigned_to:users!assigned_to_user_id(id, email, full_name)
        `)
        .order('created_at', { ascending: false });

    if (orgId) {
        query = query.eq('organization_id', orgId);
    }

    const normalizedRole = (role || '').toLowerCase();
    
    let isHrAuthorityUser = false;
    if (userId) {
        const { data: hrCheck } = await supabaseAdmin
            .from('employee_profiles')
            .select('is_hr_authority, is_hr_manager_authority')
            .eq('user_id', userId)
            .maybeSingle();
        if (hrCheck?.is_hr_authority || hrCheck?.is_hr_manager_authority) {
            isHrAuthorityUser = true;
        }
    }
    console.log('isHrAuthorityUser:', isHrAuthorityUser);
    console.log('normalizedRole:', normalizedRole);

    if (isHrAuthorityUser || ['hr', 'hr_head', 'hr_manager', 'hr_ops', 'org_super_admin', 'ops_super_admin', 'master_admin', 'org_admin'].includes(normalizedRole)) {
        query = query.or('is_confidential.eq.false,is_confidential.is.null');
    }

    const { data, error } = await query;
    console.log('Query result count:', data?.length, error);
    if (data) {
        data.forEach(t => console.log('Returned ticket:', t.ticket_number, 'raised_by:', t.raised_by?.email, 'assigned_to:', t.assigned_to?.email, 'confidential:', t.is_confidential));
    }
}

run();
