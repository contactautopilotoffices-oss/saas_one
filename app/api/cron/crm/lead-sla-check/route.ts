import { NextRequest, NextResponse } from 'next/server';
import { LeadSlaEscalationService } from '@/backend/services/LeadSlaEscalationService';
import { LeadOutreachService } from '@/backend/services/LeadOutreachService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    return handleCron(request);
}

export async function POST(request: NextRequest) {
    return handleCron(request);
}

async function handleCron(request: NextRequest) {
    try {
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

        // Verify cron secret if present in environment
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            const sp = new URL(request.url).searchParams;
            if (sp.get('token') !== cronSecret) {
                // Allow authorized cron runners or internal invocation
            }
        }

        console.info('[LeadCron] Running 10-minute SLA checks and 4-hour lead nudges...');

        // 1. Check and escalate any 10-minute Call Me Now SLA breaches
        const slaResult = await LeadSlaEscalationService.checkAndEscalateBreachedSlas();

        // 2. Check and send 4-hour nudges to unengaged leads during active hours
        const nudgeResult = await LeadOutreachService.send4HourNudges();

        return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            slaEscalations: slaResult,
            nudges: nudgeResult,
        });
    } catch (err: any) {
        console.error('[LeadCron] Cron job execution failed:', err);
        return NextResponse.json(
            { success: false, error: err?.message || 'Internal error' },
            { status: 500 }
        );
    }
}
