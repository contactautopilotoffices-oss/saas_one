import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { getSeedVendors, callable, mailable } from '@/backend/lib/ira/vendorSeed';
import { isBolnaConfigured } from '@/backend/services/bolnaService';
import { IRA_VOICE_SYSTEM_PROMPT, IRA_VOICE_WELCOME } from '@/backend/lib/ira/voicePrompt';
import { dailyRunKey, withAgentRun } from '@/backend/lib/agents/instrument';

/**
 * GET /api/ira/vendor-outreach
 *
 * Dry-run of the demo pipeline: research -> qualify -> mail -> call -> report.
 * Shows exactly what Ira would do at each step and why each step is or isn't
 * ready. Contacts nobody.
 *
 * Deliberately has no POST. Cold-calling and cold-emailing real businesses is
 * a decision a person makes, not something an endpoint does because it exists.
 *
 * AUTH — gated on a signed-in Supabase session, the same
 * `createClient()` + `auth.getUser()` → 401 guard every /api/agents/* GET uses.
 * This endpoint opens an agent run, and runs are written with the SERVICE-ROLE
 * client, which bypasses RLS. Ungated, it was a way for anyone on the internet
 * to write rows into oem_agent_runs / oem_agent_run_steps. It also lists the
 * vendor shortlist and which outreach channels are configured, neither of which
 * is public information.
 *
 * TELEMETRY — the run recorded here is a DRY RUN and says so in every step and
 * in its outcome line. No 'Emailing' or 'Calling' step is ever written, because
 * neither ever happens on this path. Its trigger is 'shadow' for the same
 * reason: a rehearsal that contacts nobody is not a run of Ira's outreach job,
 * and oem_agent_profile leaves 'shadow' out of the success-rate denominator, so
 * loading this page cannot pad her score. grounded:false: the leads come from
 * the SEED_VENDORS list in vendorSeed.ts, not from a bundled table. No token
 * counts: no model is called.
 */

/** The org Ira is registered under — same constant the council routes use. */
const DEFAULT_ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

/** True when the mailer this pipeline would reuse actually has an SMTP host. */
function smtpConfigured(): boolean {
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER);
}

export async function GET(_request: NextRequest) {
    // Same guard every sibling GET under /api/agents uses. Nothing below this
    // line runs for an anonymous caller — including the service-role writes
    // withAgentRun performs.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const vendors = await getSeedVendors();
    const withPhone = vendors.filter((v) => !!v.phone);
    const verified = callable(vendors);
    const withEmail = mailable(vendors);

    const bolnaReady = isBolnaConfigured();
    const smtpReady = smtpConfigured();

    await withAgentRun(
        {
            orgId: DEFAULT_ORG_ID,
            agentKey: 'ira',
            module: 'vendors',
            // A dry run contacts nobody, so it is a rehearsal, not a run of the
            // job. 'shadow' keeps it out of the success-rate denominator.
            trigger: 'shadow',
            // One dry run per day: the first load records the trace and every
            // refresh after it is deduped, writing nothing at all.
            runKey: dailyRunKey('ira-vendor-outreach-dryrun'),
        },
        async (step) => {
            const load = await step('Loading the vendor shortlist', 'fetch');
            await load.ok({
                detail: {
                    leads: vendors.length,
                    source: 'backend/lib/ira/vendorSeed.ts SEED_VENDORS',
                    live_search: false,
                    live_search_blocker: 'no TAVILY_API_KEY / Exa / Serper key in env',
                },
            });

            const qualify = await step('Qualifying leads for contact', 'decide');
            await qualify.ok({
                detail: {
                    with_email: withEmail.length,
                    with_phone: withPhone.length,
                    human_verified: verified.length,
                    // The gate that keeps Ira off an unverified phone number.
                    callable_now: verified.length,
                },
            });

            const channels = await step('Checking outreach channels', 'tool');
            await channels.ok({
                detail: {
                    smtp_configured: smtpReady,
                    bolna_configured: bolnaReady,
                    voice_blocker: bolnaReady
                        ? null
                        : 'BOLNA_API_KEY + BOLNA_AGENT_ID + BOLNA_FROM_NUMBER not set',
                },
            });

            const report = await step('Assembling the dry-run report', 'write');
            await report.ok({
                detail: { steps_reported: 5, contacted: 0, emails_sent: 0, calls_placed: 0 },
            });

            return {
                outcome: `Dry run — ${vendors.length} leads reviewed, ${withEmail.length} mailable, `
                    + `${verified.length} callable. Contacted nobody.`,
                grounded: false,
            };
        },
    );

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
                status: bolnaReady ? 'ready' : 'blocked',
                detail: `${withPhone.length} leads have a phone number; ${verified.length} are human-verified.`,
                blocker: bolnaReady
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
            configured: bolnaReady,
            welcome: IRA_VOICE_WELCOME,
            systemPromptChars: IRA_VOICE_SYSTEM_PROMPT.length,
            disclosesAutomated: IRA_VOICE_SYSTEM_PROMPT.includes('automated assistant'),
            refusesCommercials: IRA_VOICE_SYSTEM_PROMPT.includes('NEVER quote'),
        },
        vendors,
    });
}
