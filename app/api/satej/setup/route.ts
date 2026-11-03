/**
 * GET ?organizationId= → is Meera ready to run end to end on this server?
 *
 * The Meera page shows this, so a missing key or an unmapped webhook is named
 * on screen instead of surfacing as a requirement that silently never moves.
 * Names only — no value of any setting is ever returned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import { getAgent } from '@/backend/lib/satej/clients/bolna';
import { missingKeys, satejConfig } from '@/backend/lib/satej/config';
import { isSatejPaused } from '@/backend/lib/satej/pipeline';
import { SATEJ_MIGRATION } from '@/backend/lib/satej/repo';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingSchemaError } from '@/backend/lib/procurement/catalogAccess';
import { CALL_VARIABLES, promptVariables } from '@/backend/lib/satej/prompts/voiceAgent';

export const dynamic = 'force-dynamic';

/** Variables Bolna fills on its own; the CSV does not need to supply them. */
const BOLNA_SYSTEM_VARIABLES = ['agent_id', 'execution_id', 'call_sid', 'from_number', 'to_number', 'current_date', 'current_time', 'timezone'];

export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId');
    const caller = await requireSatejCaller(organizationId);
    if (caller instanceof NextResponse) return caller;
    try {
        return NextResponse.json(await readiness(organizationId!));
    } catch (e) {
        console.error('[satej setup] readiness check failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'The readiness check failed' }, { status: 500 });
    }
}

async function readiness(organizationId: string) {
    const voice: {
        checked: boolean;
        found?: boolean;
        name?: string;
        webhookMapped?: boolean;
        webhookHost?: string | null;
        unfilledVariables?: string[];
        error?: string;
    } = { checked: false };

    if (satejConfig.mockMode) {
        voice.error = 'Mock mode: Bolna is not contacted';
    } else if (satejConfig.bolnaApiKey && satejConfig.bolnaAgentId) {
        try {
            const agent = await getAgent(satejConfig.bolnaAgentId);
            voice.checked = true;
            voice.found = !!agent;
            if (agent) {
                voice.name = agent.name;
                const expectedPath = '/api/satej/bolna?token=';
                let host: string | null = null;
                try {
                    host = agent.webhookUrl ? new URL(agent.webhookUrl).host : null;
                } catch {
                    host = null;
                }
                voice.webhookHost = host;
                voice.webhookMapped =
                    !!agent.webhookUrl
                    && agent.webhookUrl.includes(expectedPath)
                    && agent.webhookUrl.endsWith(`token=${encodeURIComponent(satejConfig.webhookToken)}`);
                voice.unfilledVariables = promptVariables(agent.promptText).filter(
                    (v) => !(CALL_VARIABLES as readonly string[]).includes(v) && !BOLNA_SYSTEM_VARIABLES.includes(v),
                );
            }
        } catch (e) {
            voice.error = e instanceof Error ? e.message : String(e);
        }
    }

    // Are Meera's tables there? A HEAD count is enough; nothing is read.
    const probe = satejConfig.mockMode
        ? { error: null }
        : await supabaseAdmin.from('satej_requirements').select('id', { count: 'exact', head: true }).limit(1);
    const database = probe.error
        ? { ready: false, error: isMissingSchemaError(probe.error) ? `Apply supabase/migrations/${SATEJ_MIGRATION}.` : probe.error.message }
        : { ready: true };

    return {
        database,
        missing: missingKeys(),
        mockMode: satejConfig.mockMode,
        autoStartCalls: satejConfig.autoStartCalls,
        whatsappConfigured: !!process.env.AISENSY_API_KEY,
        paused: await isSatejPaused(organizationId),
        voice,
    };
}
