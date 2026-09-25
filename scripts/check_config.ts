import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
    const { data: orgSettings } = await supabaseAdmin.from('organization_settings').select('hr_escalation_config, notification_matrix').limit(1).maybeSingle();
    console.log('--- ORG SETTINGS CONFIG ---');
    console.log('hr_escalation_config:', JSON.stringify(orgSettings?.hr_escalation_config, null, 2));
    console.log('notification_matrix:', JSON.stringify(orgSettings?.notification_matrix, null, 2));

    const { data: harshUsers } = await supabaseAdmin.from('users').select('id, email, full_name, user_photo_url').or('full_name.ilike.%harsh%,email.ilike.%harsh%,email.ilike.%admin.ho%');
    console.log('--- HARSH PATIL USERS ---', JSON.stringify(harshUsers, null, 2));

    const res = await supabaseAdmin.from('hr_tickets').select('id, ticket_number').limit(1);
    console.log('HR TICKETS RES:', res);
}

main().catch(console.error);
