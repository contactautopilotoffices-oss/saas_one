/**
 * IRA DAILY DIGEST — the scheduled send.
 *
 * vercel.json fires this at 05:30 UTC = 11:00 IST, every day.
 *
 * WHY THE CRON TIME IS FIXED BUT THE AGENT'S IS NOT
 * Vercel's schedule is static in vercel.json; it cannot be changed from the
 * console. So this fires HOURLY-ACCURATE at 11:00 IST and then checks each
 * agent's own runtime.schedule_cron hour before sending. An operator moving the
 * digest to 09:00 in the console changes the send; the cron just wakes up.
 * Without that check, runtime.schedule_cron would stay decorative — which it is
 * today, read by nothing.
 *
 * Sending is still gated: IRA_SEND_ENABLED, a configured recipient list, and a
 * reply-to that the poller actually reads. Any of those missing = no send, and
 * the run says which.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { withAgentRun, dailyRunKey } from '@/backend/lib/agents/instrument';
import { scanPurchaseOrders } from '@/backend/lib/ira/procurement/detectLive';
import { windowFor, type Cadence } from '@/backend/lib/ira/procurement/cadence';
import { applyPriorDispositions, rememberFindings, loadDispositionStatuses, resolveVanishedFindings } from '@/backend/lib/ira/procurement/memory';
import { routeFindings } from '@/backend/lib/ira/procurement/router';
import { renderRecipientEmail, type FeedbackLinks } from '@/backend/lib/ira/procurement/render';
import { mintFeedbackLinks } from '@/backend/lib/ira/procurement/feedbackLinks';
import { replyTag, taggedSubject } from '@/backend/lib/ira/procurement/reply';
import { resolveDelivery } from '@/backend/lib/ira/procurement/delivery';
import { splitBySite, cityLookup, unmatchedProperties } from '@/backend/lib/ira/procurement/sites';
import { vetFindings } from '@/backend/lib/ira/procurement/vet';
import { reportToCouncil } from '@/backend/lib/ira/procurement/council';
import type { VettingStamp } from '@/backend/lib/ira/procurement/render';
import { sendDigest } from '@/backend/lib/ira/dailyDigest';
import type { RecipientKey } from '@/backend/lib/ira/procurement/types';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const AGENT_KEY = 'ira';
const DEFAULT_HOUR_IST = 11;

/** The hour an agent wants to be sent at, from its own cron. */
function hourFromCron(cron: string | undefined): number {
    const parts = (cron ?? '').trim().split(/\s+/);
    const h = Number(parts[1]);
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_HOUR_IST;
}

function istHour(now: Date): number {
    return Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false,
    }).format(now));
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const hourNow = istHour(now);
    const force = new URL(request.url).searchParams.get('force') === 'yes';

    const { data: agents } = await supabaseAdmin
        .from('oem_agents')
        .select('organization_id, runtime, status, display_name')
        .eq('agent_key', AGENT_KEY);

    const out: unknown[] = [];

    for (const a of agents ?? []) {
        const orgId = String(a.organization_id);
        const runtime = (a.runtime ?? {}) as { schedule_cron?: string; reports_to?: string | null };
        const wantHour = hourFromCron(runtime.schedule_cron);

        if (!force && wantHour !== hourNow) {
            out.push({ orgId, skipped: `wants ${wantHour}:00 IST, now ${hourNow}:00` });
            continue;
        }
        // A draft or paused agent does not mail anyone.
        if (!['live', 'shadow'].includes(String(a.status))) {
            out.push({ orgId, skipped: `status ${a.status}` });
            continue;
        }

        const delivery = await resolveDelivery(orgId, AGENT_KEY);
        const shadow = String(a.status) === 'shadow';

        const r = await withAgentRun(
            {
                orgId, agentKey: AGENT_KEY, module: 'procurement',
                trigger: shadow ? 'shadow' : 'cron',
                runKey: dailyRunKey('ira-digest'),
            },
            async (step) => {
                const cadence: Cadence = 'daily';
                const w = windowFor(cadence, now);

                const s = await step(`Scanning ${w.label}`, 'fetch');
                const { findings: raw, stats } = await scanPurchaseOrders(orgId, w.to, w);
                await s.ok({ detail: { ...stats, window: w.label } });

                const mem = await applyPriorDispositions(orgId, AGENT_KEY, raw);
                await rememberFindings(orgId, AGENT_KEY, null, mem.findings);

                /**
                 * Close what stopped being true.
                 *
                 * The stale-feed finding is the case that proved this is needed:
                 * raised on 5 Sept, the sync run an hour later, and the row still
                 * open and being quoted as current two days on.
                 *
                 * Only the singleton checks are eligible — a scan either raises
                 * them or does not, so absence is meaningful. Per-record findings
                 * (a specific duplicate) are excluded: they can vanish because the
                 * window moved, not because anything was fixed, and closing those
                 * would be a lie about coverage.
                 */
                const SINGLETON_CHECKS = ['po-feed-stale', 'vendor-name-variants', 'approved-without-workflow-state'];
                const stillPresent = raw.map((f) => f.key);
                const vanished = await resolveVanishedFindings(orgId, AGENT_KEY, SINGLETON_CHECKS, stillPresent);
                if (vanished.resolved.length) {
                    const v = await step(`${vanished.resolved.length} finding(s) no longer detected — closed`, 'decide');
                    await v.ok({ detail: { resolved: vanished.resolved } });
                }
                const statuses = await loadDispositionStatuses(orgId, AGENT_KEY, mem.findings.map((f) => f.key));
                const bundles = routeFindings(mem.findings);

                if (!bundles.length) {
                    return { outcome: `Nothing to send for ${w.label}.`, status: 'skipped' as const, grounded: true };
                }

                // The reviewer reads BEFORE the mail goes out. A failed or absent
                // review does not stop the send — the stamp just isn't there.
                let stamp: VettingStamp | null = null;
                if (runtime.reports_to) {
                    const v = await step(`Vetting by ${runtime.reports_to}`, 'decide', { reports_to: runtime.reports_to });
                    const vet = await vetFindings(orgId, AGENT_KEY, String(a.display_name ?? 'Ira'), runtime.reports_to, mem.findings, w.label);
                    if (vet.ok && vet.reviewer && vet.verdict) {
                        stamp = { reviewer: vet.reviewer.name, verdict: vet.verdict, concerns: vet.concerns.map((c) => ({ finding_key: c.finding_key, concern: c.concern })) };
                        await v.ok({ detail: { verdict: vet.verdict, concerns: vet.concerns.length, cost_usd: vet.costUsd, logged: Boolean(vet.loggedId) } });
                    } else {
                        await v.ok({ detail: { skipped: vet.why } });
                    }
                }

                // Escalations + the run note. This function existed with no callers.
                const council = await reportToCouncil(orgId, AGENT_KEY, mem.findings, { suppressed: mem.suppressed, reopened: mem.reopened });
                if (process.env.IRA_SEND_ENABLED !== 'true') {
                    return { outcome: `${bundles.length} bundle(s) ready but IRA_SEND_ENABLED is not true.`, status: 'skipped' as const, grounded: true };
                }

                const sent: string[] = [];
                const skipped: string[] = [];

                // A property's city is what makes "SS Plaza" a Bengaluru finding.
                // One query per run, not one per finding.
                const { data: props } = await supabaseAdmin
                    .from('properties').select('name, city').eq('organization_id', orgId);
                const cityOf = cityLookup(props ?? []);

                for (const b of bundles) {
                    const roleTo = delivery.to[b.recipient.key as RecipientKey] ?? [];

                    // One email per site owner, all to the same shared mailbox.
                    // With no site rules configured this yields a single slice and
                    // the mail is byte-identical to what it was before.
                    const slices = splitBySite(b, delivery.siteRules, roleTo, cityOf);

                    for (const slice of slices) {
                        const who = slice.label ? `${b.recipient.key}/${slice.label}` : b.recipient.key;
                        if (!slice.to.length) { skipped.push(`${who}: no address configured`); continue; }

                        const links: FeedbackLinks = b.recipient.canDisposition
                            ? await mintFeedbackLinks({ organizationId: orgId, userId: '', agentKey: AGENT_KEY, runId: null, findings: slice.bundle.findings })
                            : {};
                        const subjects: Record<string, string> = {};
                        for (const f of slice.bundle.findings) subjects[f.key] = taggedSubject(f.title, replyTag(orgId, AGENT_KEY, f.key));

                        const { subject, html } = renderRecipientEmail(
                            slice.bundle, orgId, now, links, [], delivery.replyTo, subjects, statuses,
                            slice.label ? { label: slice.label, owners: slice.ownerNames } : null,
                            stamp,
                        );

                        const st = await step(`Emailing ${who} (${slice.to.length})`, 'notify',
                            { recipient: b.recipient.key, site: slice.label || null, owners: slice.ownerNames, findings: slice.bundle.counts.total });
                        try {
                            // Shadow never mails anyone. It proves the run without the send.
                            if (shadow) { skipped.push(`${who}: shadow, not sent`); await st.ok({ detail: { shadow: true } }); continue; }
                            await sendDigest(slice.to.join(', '), subject, html, delivery.replyTo);
                            sent.push(`${who} → ${slice.to.join(', ')}`);
                            await st.ok();
                        } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e);
                            console.error('[ira-digest]', orgId, who, msg);
                            skipped.push(`${who}: ${msg}`);
                            await st.fail(e);
                        }
                    }
                }

                // A site nobody owns is a silent gap. Say it in the run, every run.
                const unmatched = unmatchedProperties(mem.findings, delivery.siteRules, cityOf);

                return {
                    outcome: `sent ${sent.length}, skipped ${skipped.length} · ${w.label}`,
                    status: (sent.length ? 'succeeded' : 'skipped') as 'succeeded' | 'skipped',
                    grounded: true,
                    result: { sent, skipped, unmatchedSites: unmatched, vetted: stamp ? { by: stamp.reviewer, verdict: stamp.verdict, concerns: stamp.concerns.length } : null, council: { escalated: council.escalated.length, noted: council.noted }, usingEnvFallback: delivery.usingEnvFallback },
                };
            },
        );
        out.push({ orgId, hour: wantHour, ...(r ?? {}) });
    }

    return NextResponse.json({ ok: true, istHour: hourNow, results: out });
}
