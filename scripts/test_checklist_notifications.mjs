import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function runLiveTest() {
    console.log('====================================================');
    console.log('🧪 SOP CHECKLIST WHATSAPP NOTIFICATION TEST SUITE');
    console.log('====================================================\n');

    // 1. Fetch current IST Time
    const now = new Date();
    const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(istString);
    const h = istDate.getHours();
    const m = istDate.getMinutes();
    const currentMins = h * 60 + m;

    console.log(`🕒 Current Time in IST: ${istString}`);
    console.log(`⏱️ Minutes from midnight: ${currentMins} (${h}:${String(m).padStart(2, '0')})\n`);

    // 2. Fetch active daily/weekly checklist templates
    const { data: templates, error } = await supabase
        .from('sop_templates')
        .select('id, title, frequency, start_time, end_time, assigned_to, property_id, organization_id')
        .eq('is_active', true)
        .neq('frequency', 'on_demand')
        .limit(5);

    if (error || !templates || templates.length === 0) {
        console.error('❌ Could not fetch templates:', error);
        return;
    }

    console.log(`📋 Found ${templates.length} Sample Active Checklists:\n`);

    for (const t of templates) {
        const rawStart = (t.start_time || '09:00:00').slice(0, 5);
        const rawEnd = (t.end_time || '18:00:00').slice(0, 5);
        const [sH, sM] = rawStart.split(':').map(Number);
        const [eH, eM] = rawEnd.split(':').map(Number);
        const startMins = sH * 60 + sM;
        const endMins = eH * 60 + eM;

        const leadMins = 10;
        const preStartMins = startMins - leadMins;

        let status = 'Inactive (Outside Window)';
        if (currentMins >= preStartMins && currentMins < startMins) {
            status = '🟡 In Pre-Start Reminder Window (10 mins before start)';
        } else if (currentMins >= startMins && currentMins < endMins) {
            status = '🟢 In Active Shift Window (Started Alert Triggered)';
        } else if (currentMins >= endMins) {
            status = '🔴 In Overdue Window (End time passed)';
        }

        console.log(`• Template: "${t.title}"`);
        console.log(`  Frequency: ${t.frequency} | Shift: ${rawStart} – ${rawEnd}`);
        console.log(`  Current State: ${status}\n`);
    }

    // 3. Inspect today's enqueued WhatsApp messages in whatsapp_queue
    const startOfTodayIST = new Date(istDate.getFullYear(), istDate.getMonth(), istDate.getDate()).toISOString();
    const { data: queued, error: qErr } = await supabase
        .from('whatsapp_queue')
        .select('id, phone, template_name, event_type, status, created_at')
        .in('event_type', ['CHECKLIST_SLOT_REMINDER', 'CHECKLIST_STARTED', 'CHECKLIST_OVERDUE', 'SOP_STARTED', 'SOP_OVERDUE'])
        .order('created_at', { ascending: false })
        .limit(5);

    console.log('----------------------------------------------------');
    console.log('📬 Recent Checklist WhatsApp Messages in Queue:');
    console.log('----------------------------------------------------');
    if (queued && queued.length > 0) {
        console.table(queued);
    } else {
        console.log('No checklist messages sent today yet.');
    }

    console.log('\n✅ Verification Complete.');
}

runLiveTest();
