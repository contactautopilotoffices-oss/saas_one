import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function runSimulation() {
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    const { WhatsAppService } = await import('@/backend/services/WhatsAppService');
    const { processIncomingMessage } = await import('@/backend/lib/whatsapp/processMessage');

    console.log('================================================================');
    console.log('📱 LIVE WHATSAPP SIMULATION: HEAD OFFICE TASK MANAGER');
    console.log('================================================================\n');

    const senderPhone = process.env.TEST_WHATSAPP_PHONE || '8433649199';

    // Intercept outbound WhatsApp replies so we can display them formatted
    const outboundReplies: string[] = [];
    const originalSendAsync = WhatsAppService.sendAsync;
    (WhatsAppService as any).sendAsync = async (phone: string, options: any) => {
        outboundReplies.push(options.message);
        return true;
    };
    (WhatsAppService as any)._send = async (phone: string, options: any) => {
        outboundReplies.push(options.message);
        return true;
    };

    async function simulateWhatsAppMessage(incomingText: string) {
        outboundReplies.length = 0; // Clear buffer
        console.log(`\n💬 [USER → WHATSAPP] Phone (${senderPhone}):`);
        console.log(`   "${incomingText}"`);

        // Send through the exact system entry point used by webhooks
        await processIncomingMessage(
            senderPhone,
            incomingText,
            null, null, false,
            null, null, false,
            null,
            `sim_${Date.now()}`
        );

        console.log(`\n🤖 [SYSTEM → WHATSAPP REPLY]:`);
        if (outboundReplies.length === 0) {
            console.log(`   (No outbound reply triggered)`);
        } else {
            outboundReplies.forEach(reply => {
                const boxed = reply.split('\n').map(l => `   | ${l}`).join('\n');
                console.log(boxed);
            });
        }
    }

    try {
        // Step 1: Natural language task creation in 3rd person (user's exact example)
        await simulateWhatsAppMessage('today he will be working on project deployment');

        // Step 2: Natural language task creation in 1st person
        await simulateWhatsAppMessage('Today I will be working on client contract review and GST reconciliation');

        // Step 3: View active tasks
        await simulateWhatsAppMessage('my tasks');

        // Step 4: Natural completion without command syntax
        await simulateWhatsAppMessage('Finished project deployment');

        // Step 5: Submit End-of-Day Daily Report
        await simulateWhatsAppMessage('daily report: Finalized project deployment specs and reviewed GST reconciliation.');

        // Step 6: Superuser AI query about department progress
        await simulateWhatsAppMessage('What did Tech work on today?');

        // Step 7: Superuser AI query for missing EOD reports
        await simulateWhatsAppMessage("Who hasn't submitted their daily report today?");

        // Step 8: Facility issue guardrail check (must NOT be intercepted by Task Manager)
        await simulateWhatsAppMessage('AC in the conference room is leaking water');

        console.log('\n================================================================');
        console.log('✅ SIMULATION COMPLETE: All actions logged to DB and live dashboard.');
        console.log('================================================================\n');
    } finally {
        (WhatsAppService as any).sendAsync = originalSendAsync;
    }
}

runSimulation().catch(err => {
    console.error('Simulation error:', err);
    process.exit(1);
});
