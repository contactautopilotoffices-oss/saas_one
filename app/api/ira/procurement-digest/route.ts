/**
 * IRA · PROCUREMENT DIGEST — per-recipient, deterministic, link-verified.
 *
 *   GET  ?orgId=&recipient=ceo|procurement|technical   → renders that email. Sends nothing.
 *   GET  ?orgId=&format=json                           → the routed bundles as data.
 *   POST ?orgId=                                       → SENDS. Gated hard (see below).
 *
 * GET is a preview and opens a run with trigger 'shadow', so rehearsals never
 * score Ira — the same posture as ira/daily-digest.
 *
 * SENDING IS DELIBERATELY HARD TO DO BY ACCIDENT. POST requires all of:
 *   · IRA_SEND_ENABLED=true
 *   · a valid CRON_SECRET, or a signed-in user passing ?confirm=yes
 *   · an explicit `to` map in the body — recipients are NEVER inferred, looked up,
 *     or defaulted. An address this route was not given is an address it cannot mail.
 *
 * That last one is the important one: nobody gets mailed because a config file
 * happened to contain their address.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { dailyRunKey, withAgentRun } from '@/backend/lib/agents/instrument';
import { fixtureFindings } from '@/backend/lib/ira/procurement/detect';
import { routeFindings } from '@/backend/lib/ira/procurement/router';
import type { RecipientKey } from '@/backend/lib/ira/procurement/types';
import { renderRecipientEmail } from '@/backend/lib/ira/procurement/render';
import { sendDigest } from '@/backend/lib/ira/dailyDigest';
import { mintFeedbackLinks } from '@/backend/lib/ira/procurement/feedbackLinks';
import { isOrgMember } from '@/backend/lib/ira/procurement/guard';
import type { FeedbackLinks } from '@/backend/lib/ira/procurement/render';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS: RecipientKey[] = ['ceo', 'procurement', 'technical'];

function isKey(v: string): v is RecipientKey {
    return (KEYS as string[]).includes(v);
}

export async function GET(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = new URL(request.url).searchParams;
    const orgId = sp.get('orgId') ?? '';
    if (!UUID_RE.test(orgId)) {
        return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });
    }

    // A UUID shape is not authorisation. Without this, any signed-in user could
    // name another org — its id is in every dashboard URL — and be handed live
    // tokens stamped with that org.
    if (!(await isOrgMember(orgId, user.id))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const bundles = routeFindings(fixtureFindings());

    await withAgentRun(
        {
            orgId,
            agentKey: 'ira',
            module: 'procurement',
            // A preview is a REHEARSAL. Nothing is sent, so it must not be scored.
            trigger: 'shadow',
            runKey: dailyRunKey('ira-procurement-digest-preview'),
        },
        async (step) => {
            const s = await step('Routing findings to recipients', 'decide');
            await s.ok({ detail: { recipients: bundles.map((b) => b.recipient.key) } });
            return {
                outcome: `${bundles.length} recipient bundle(s) from ${fixtureFindings().length} findings`,
                grounded: false, // fixture findings, not live SQL — see detect.ts
            };
        },
    );

    if (sp.get('format') === 'json') {
        return NextResponse.json({
            ok: true,
            grounded: false,
            bundles: bundles.map((b) => ({
                recipient: b.recipient,
                counts: b.counts,
                findings: b.findings.map((f) => ({
                    key: f.key, priority: f.priority, title: f.title,
                    amount: f.amount, actions: f.actions,
                })),
            })),
        });
    }

    const want = sp.get('recipient') ?? 'ceo';
    if (!isKey(want)) {
        return NextResponse.json({ error: `recipient must be one of ${KEYS.join(', ')}` }, { status: 400 });
    }
    const bundle = bundles.find((b) => b.recipient.key === want);
    if (!bundle) {
        // Genuinely nothing for this person. Not an empty email — no email.
        return new NextResponse(
            `<p style="font:14px system-ui;padding:40px">Nothing for <strong>${want}</strong> today. No email would be sent.</p>`,
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
    }

    // GET IS A REHEARSAL AND MINTS NOTHING. It used to call mintFeedbackLinks,
    // which INSERTed four live 72-hour single-use tokens per finding on every
    // page refresh — and rendered them into the response body. Previews now
    // always get inert links; only the send path mints.
    const links: FeedbackLinks = {};
    if (bundle.recipient.canDisposition) {
        for (const f of bundle.findings) {
            if (f.priority === 'closed') continue;
            links[f.key] = { done: '#', not_an_issue: '#', in_progress: '#', blocked: '#', need_info: '#' };
        }
    }

    const { html } = renderRecipientEmail(bundle, orgId, new Date(), links);
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function POST(request: NextRequest) {
    const sp = new URL(request.url).searchParams;
    const orgId = sp.get('orgId') ?? '';
    if (!UUID_RE.test(orgId)) {
        return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });
    }

    if (process.env.IRA_SEND_ENABLED !== 'true') {
        return NextResponse.json({ error: 'IRA_SEND_ENABLED is not true — refusing to send.' }, { status: 403 });
    }

    const secret = request.headers.get('x-cron-secret');
    const fromCron = Boolean(process.env.CRON_SECRET) && secret === process.env.CRON_SECRET;
    if (!fromCron) {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (sp.get('confirm') !== 'yes') {
            return NextResponse.json({ error: 'Add ?confirm=yes to send.' }, { status: 400 });
        }
        if (!(await isOrgMember(orgId, user.id))) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
    }

    const body = (await request.json().catch(() => ({}))) as {
        to?: Partial<Record<RecipientKey, string>>;
        /** users.id per recipient — required to mint close-links for them. */
        userIds?: Partial<Record<RecipientKey, string>>;
    };
    // NOTE: `evidence` was removed from this body. EvidenceItem carries a
    // `fetch: () => Promise<Buffer>`; a function cannot survive JSON, so every
    // item silently fell through to the linked branch and nothing could ever
    // attach. Attachments must be resolved server-side from storage paths, not
    // handed in by the caller. resolveAttachments() stays, unwired, until then.
    const to = body.to ?? {};
    if (!Object.keys(to).length) {
        return NextResponse.json(
            { error: 'Body must carry { to: { ceo?, procurement?, technical? } }. Addresses are never inferred.' },
            { status: 400 },
        );
    }

    const bundles = routeFindings(fixtureFindings());
    const sent: string[] = [];
    const skipped: string[] = [];

    await withAgentRun(
        { orgId, agentKey: 'ira', module: 'procurement', trigger: fromCron ? 'cron' : 'manual',
          runKey: dailyRunKey('ira-procurement-digest') },
        async (step) => {
            for (const bundle of bundles) {
                const address = to[bundle.recipient.key];
                if (!address) { skipped.push(`${bundle.recipient.key} (no address given)`); continue; }
                // Links are minted PER RECIPIENT: a token is bound to one user, and
                // one person's feedback link must never be usable by another.
                const userId = body.userIds?.[bundle.recipient.key];
                const links = userId
                    ? await mintFeedbackLinks({
                          organizationId: orgId, userId, agentKey: 'ira',
                          runId: null, findings: bundle.findings,
                      })
                    : {};
                if (!userId) skipped.push(`${bundle.recipient.key}: no userId — sent without feedback links`);

                const { subject, html } = renderRecipientEmail(bundle, orgId, new Date(), links);
                const s = await step(`Emailing ${bundle.recipient.key}`, 'notify',
                    { recipient: bundle.recipient.key, findings: bundle.counts.total });
                try {
                    await sendDigest(address, subject, html);
                    sent.push(`${bundle.recipient.key} → ${address}`);
                    await s.ok();
                } catch (e) {
                    // s.fail() is a no-op until the runtime tables exist, so the
                    // failure would otherwise vanish and the route still return 200.
                    const msg = e instanceof Error ? e.message : String(e);
                    console.error(`[ira procurement-digest] send to ${bundle.recipient.key} failed:`, msg);
                    skipped.push(`${bundle.recipient.key}: send failed — ${msg}`);
                    await s.fail(e);
                }
            }
            return { outcome: `sent ${sent.length}, skipped ${skipped.length}`, grounded: false };
        },
    );

    return NextResponse.json({ ok: true, sent, skipped });
}
