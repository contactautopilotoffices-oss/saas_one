import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env', 'utf-8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].replace(/['"]+/g, '').trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].replace(/['"]+/g, '').trim();

const supabase = createClient(url, key);

async function run() {
    const keys = [
        'whatsapp_ticketing_enabled',
        'whatsapp_meeting_room_enabled',
        'whatsapp_ppm_enabled',
        'whatsapp_procurement_enabled',
        'whatsapp_crm_enabled'
    ];
    for (const k of keys) {
        const { error } = await supabase.from('system_config').insert({ key: k, value: true, description: `Toggle for ${k}` });
        if (error && error.code !== '23505') {
            console.error('Error inserting', k, error);
        } else {
            console.log('Inserted or already exists:', k);
        }
    }
}
run();
