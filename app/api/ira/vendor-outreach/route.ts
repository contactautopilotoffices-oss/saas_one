import { NextRequest, NextResponse } from 'next/server';
import { getSeedVendors, callable, mailable } from '@/backend/lib/ira/vendorSeed';
import { isBolnaConfigured } from '@/backend/services/bolnaService';
import { IRA_VOICE_SYSTEM_PROMPT, IRA_VOICE_WELCOME } from '@/backend/lib/ira/voicePrompt';

/**
 * GET /api/ira/vendor-outreach
 *
 * Dry-run of the demo pipeline: research -> qualify -> mail -> call -> report.
 * Shows exactly what Ira would do at each step and why each step is or isn't
 * ready. Contacts nobody.
 *
 * Deliberately has no POST. Cold-calling and cold-emailing real businesses is
 * a decision a person makes, not something an endpoint does because it exists.
 */
export async function GET(_request: NextRequest) {
    const vendors = await getSeedVendors();
    const withPhone = vendors.filter((v) => !!v.phone);
    const verified = callable(vendors);
    const withEmail = mailable(vendors);

    return NextResponse.json({
        pipeline: [
            {
                step: 1,
                name: 'Research the requirement',
                status: 'done',
                detail: 'Electrical works for commercial office buildings, Mumbai region.',
            },
            {
                step: 2,
                name: 'Find vendors',
                status: 'seeded',
                detail: `${vendors.length} real vendors gathered from public company sites. `
                    + 'Live search needs TAVILY_API_KEY (or Exa/Serper) — Groq alone cannot browse.',
                blocker: 'no search API key in env',
            },
            {
                step: 3,
                name: 'Email them',
                status: withEmail.length ? 'ready' : 'blocked',
                detail: `${withEmail.length} of ${vendors.length} leads have a public email address. `
                    + 'SMTP is live, so this step can run today.',
            },
            {
                step: 4,
                name: 'Call as Ira',
                status: isBolnaConfigured() ? 'ready' : 'blocked',
                detail: `${withPhone.length} leads have a phone number; ${verified.length} are human-verified.`,
                blocker: isBolnaConfigured()
                    ? null
                    : 'BOLNA_API_KEY + BOLNA_AGENT_ID + BOLNA_FROM_NUMBER not set, and a public webhook URL is needed',
            },
            {
                step: 5,
                name: 'Hand off to procurement',
                status: 'ready',
                detail: 'Reuses the daily-digest mailer already working at /api/ira/daily-digest.',
            },
        ],
        gates: {
            // Nothing is callable until a human ticks `verified` in vendorSeed.ts.
            callableNow: verified.length,
            reason: verified.length === 0
                ? 'No lead is marked verified. Ira will not dial an unverified number.'
                : null,
        },
        voiceAgent: {
            configured: isBolnaConfigured(),
            welcome: IRA_VOICE_WELCOME,
            systemPromptChars: IRA_VOICE_SYSTEM_PROMPT.length,
            disclosesAutomated: IRA_VOICE_SYSTEM_PROMPT.includes('automated assistant'),
            refusesCommercials: IRA_VOICE_SYSTEM_PROMPT.includes('NEVER quote'),
        },
        vendors,
    });
}
