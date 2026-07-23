import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function main() {
    const keys = [
        'whatsapp_ticketing_enabled',
        'whatsapp_ppm_enabled',
        'whatsapp_procurement_enabled',
        'whatsapp_crm_enabled'
    ];
    for (const key of keys) {
        await supabaseAdmin.from('system_config').upsert({
            key,
            value: false,
            updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
        console.log(`Disabled ${key}`);
    }
    
    // Explicitly enable meeting room
    await supabaseAdmin.from('system_config').upsert({
        key: 'whatsapp_meeting_room_enabled',
        value: true,
        updated_at: new Date().toISOString()
    }, { onConflict: 'key' });
    console.log(`Enabled whatsapp_meeting_room_enabled`);
}

main().catch(console.error);
