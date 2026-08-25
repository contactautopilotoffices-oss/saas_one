import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function runTest() {
    console.log('🧪 Testing SOP Checklist Reminder Logic...');

    // Fetch active templates
    const { data: templates, error } = await supabase
        .from('sop_templates')
        .select('id, title, frequency, start_time, end_time, is_active, is_running, organization_id, property_id, assigned_to')
        .eq('is_active', true)
        .neq('frequency', 'on_demand');

    if (error) {
        console.error('Error fetching templates:', error);
        return;
    }

    console.log(`Found ${templates.length} total active non-on_demand templates.`);

    // Filter valid (daily, weekly, monthly)
    const valid = templates.filter(t => {
        const freq = (t.frequency || '').toLowerCase();
        return !(freq === 'hourly' || freq.startsWith('every_') || freq.includes('hour'));
    });

    console.log(`Found ${valid.length} valid templates (excluding hourly):`);
    valid.forEach(t => {
        console.log(` - [${t.frequency}] "${t.title}" | Shift: ${t.start_time || '09:00'} - ${t.end_time || '18:00'} | Assigned: ${JSON.stringify(t.assigned_to)}`);
    });

    // Check IST time
    const now = new Date();
    const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(istString);
    console.log(`\nCurrent IST Time: ${istString} (${istDate.getHours()}:${String(istDate.getMinutes()).padStart(2, '0')})`);

    console.log('\n✅ Logic verification complete.');
}

runTest();
