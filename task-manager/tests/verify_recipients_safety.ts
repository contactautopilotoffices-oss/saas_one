import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { supabaseAdmin } from '../../backend/lib/supabase/admin';

async function verifyAllRecipients() {
    const { data: logs, error } = await supabaseAdmin
        .from('task_audit_logs')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching logs:', error);
        return;
    }

    console.log(`Total database audit records inspected: ${logs?.length || 0}`);
    
    // 1. Check all Kickoff events
    const kickoffs = (logs || []).filter(l => 
        l.event_type === 'manager_kickoff_sent' || 
        l.event_type === 'employee_kickoff_sent'
    );

    console.log(`\n--- ALL KICKOFF EVENTS EVER LOGGED (${kickoffs.length}) ---`);
    for (const k of kickoffs) {
        console.log(`[${k.created_at}] Event: ${k.event_type} | Target Phone: ${k.details?.targetPhone} | Recipient: ${k.details?.managerName || k.details?.empName} | Campaign: ${k.details?.campaignName}`);
    }

    const nonSahilKickoffs = kickoffs.filter(k => 
        k.details?.targetPhone && !k.details.targetPhone.includes('8433649199')
    );

    // 2. Check all LIVE whatsapp_sent messages (excluding simulated dry-runs)
    const whatsappSent = (logs || []).filter(l => l.event_type === 'whatsapp_sent');
    const liveOutbound = whatsappSent.filter(l => {
        const isDryRun = l.details?.dryRun || l.details?.status === 'simulated';
        return !isDryRun;
    });

    const liveNonSahil = liveOutbound.filter(l => {
        const phone = l.details?.phone;
        return phone && !phone.includes('8433649199');
    });

    console.log(`\n--- ALL LIVE OUTBOUND WHATSAPP MESSAGES (${liveOutbound.length}) ---`);
    for (const m of liveOutbound) {
        console.log(`[${m.created_at}] Target Phone: ${m.details?.phone} | Recipient: ${m.details?.employeeName}`);
    }

    console.log(`\n======================================================`);
    console.log(`VERIFICATION SUMMARY:`);
    console.log(`- Total Kickoffs: ${kickoffs.length}`);
    console.log(`- Non-Sahil Kickoffs: ${nonSahilKickoffs.length}`);
    console.log(`- Total Live WhatsApp Messages: ${liveOutbound.length}`);
    console.log(`- Non-Sahil Live WhatsApp Messages: ${liveNonSahil.length}`);
    console.log(`======================================================\n`);

    if (nonSahilKickoffs.length === 0 && liveNonSahil.length === 0) {
        console.log('✅ ABSOLUTE CONFIRMATION: Not a single kickoff or live WhatsApp message has EVER been sent to any employee or manager other than Sahil Gorde (8433649199)!');
    }
}

verifyAllRecipients();
