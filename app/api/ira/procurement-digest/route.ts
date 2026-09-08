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
import { scanPurchaseOrders } from '@/backend/lib/ira/procurement/detectLive';
import { windowFor, CADENCES, type Cadence } from '@/backend/lib/ira/procurement/cadence';
import { applyPriorDispositions, rememberFindings, loadDispositionStatuses } from '@/backend/lib/ira/procurement/memory';
import { replyTag, taggedSubject } from '@/backend/lib/ira/procurement/reply';
import type { Finding } from '@/backend/lib/ira/procurement/types';
import { routeFindings } from '@/backend/lib/ira/procurement/router';
import type { RecipientKey } from '@/backend/lib/ira/procurement/types';
import { renderRecipientEmail } from '@/backend/lib/ira/procurement/render';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { sendDigest } from '@/backend/lib/ira/dailyDigest';
import { resolveDelivery } from '@/backend/lib/ira/procurement/delivery';
import { splitBySite, cityLookup } from '@/backend/lib/ira/procurement/sites';
import { vetFindings } from '@/backend/lib/ira/procurement/vet';
import type { VettingStamp } from '@/backend/lib/ira/procurement/render';
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

const AGENT_KEY = 'ira';

/**
 * WHERE REPLIES ARE ASKED TO GO.
 *
 * This used to read env only, and fell through to IRA_FROM_EMAIL — the Resend
 * SENDING identity, which is not a mailbox anyone polls. So every digest from
 * this path told people to reply to an address nothing reads, and that is
 * exactly what happened: a real answer from procurement went to
 * ira.mehta@autopilotoffices.com and sat there unread.
 *
 * The cron path was moved onto resolveDelivery weeks ago; this one was missed.
 * It now reads the same console config, and env survives only as a fallback.
 * A reply-to that nobody polls is the precise failure the delivery module was
 * written to prevent.
 */
async function replyAddressFor(orgId: string): Promise<string | null> {
    const d = await resolveDelivery(orgId, AGENT_KEY);
    return d.replyTo ?? ((process.env.IRA_REPLY_TO || '').trim() || null);
}

/**
 * The scan, end to end: window -> live SQL -> what people already answered ->
 * persist -> route.
 *
 * Order matters and is not arbitrary. Prior dispositions are applied BEFORE
 * anything is emailed, so a line closed yesterday is never raised again today;
 * and findings are remembered AFTER that filter, so `last_seen_at` reflects what
 * the scan actually saw rather than what it chose to report.
 */
async function runScan(orgId: string, cadence: Cadence, now: Date) {
    const window = windowFor(cadence, now);
    const { findings: raw, stats } = await scanPurchaseOrders(orgId, window.to, window);

    const memory = await applyPriorDispositions(orgId, AGENT_KEY, raw);
    const findings: Finding[] = memory.findings;

    // Persist BEFORE emailing: a reply can arrive within seconds of the send, and
    // it needs a row to land on.
    const remembered = await rememberFindings(orgId, AGENT_KEY, null, findings);

    const statuses = await loadDispositionStatuses(orgId, AGENT_KEY, findings.map((f) => f.key));
    return { window, findings, stats, memory, statuses, remembered };
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

    const cadenceParam = (sp.get('cadence') ?? 'daily') as Cadence;
    const cadence: Cadence = CADENCES.includes(cadenceParam) ? cadenceParam : 'daily';

    const scan = await runScan(orgId, cadence, new Date());
    const bundles = routeFindings(scan.findings);

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
            const s = await step(`Scanning purchase orders · ${scan.window.label}`, 'fetch');
            await s.ok({ detail: { ...scan.stats, cadence, window: scan.window.label } });

            const r = await step('Routing findings to recipients', 'decide');
            await r.ok({
                detail: {
                    recipients: bundles.map((b) => b.recipient.key),
                    suppressed: scan.memory.suppressed.length,
                    reopened: scan.memory.reopened.length,
                    memory_degraded: scan.memory.degraded,
                },
            });
            return {
                outcome: scan.findings.length === 0
                    ? `Nothing new in ${scan.window.label}. ${scan.memory.suppressed.length} closed line(s) stayed closed.`
                    : `${scan.findings.length} finding(s) to ${bundles.length} recipient(s) · ${scan.window.label}`,
                // Now genuinely derived from rows in zoho_purchase_orders.
                grounded: true,
            };
        },
    );

    if (sp.get('format') === 'json') {
        return NextResponse.json({
            ok: true,
            grounded: true,
            cadence,
            window: { label: scan.window.label, scope: scan.window.scope, from: scan.window.from, to: scan.window.to },
            stats: scan.stats,
            memory: { suppressed: scan.memory.suppressed, reopened: scan.memory.reopened, degraded: scan.memory.degraded, persisted: scan.remembered },
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

    const subjects: Record<string, string> = {};
    for (const f of bundle.findings) subjects[f.key] = taggedSubject(f.title, replyTag(orgId, AGENT_KEY, f.key));

    const { html } = renderRecipientEmail(
        bundle, orgId, new Date(), links, [], await replyAddressFor(orgId), subjects, scan.statuses,
    );
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

    const cadencePost = ((sp.get('cadence') ?? 'daily') as Cadence);
    const scan = await runScan(orgId, CADENCES.includes(cadencePost) ? cadencePost : 'daily', new Date());
    const bundles = routeFindings(scan.findings);
    const sent: string[] = [];
    const skipped: string[] = [];
    // A holder, not a `let`: TS narrows a let assigned inside the async
    // callback to `never` at the return below and rejects the read.
    const vet: { stamp: VettingStamp | null } = { stamp: null };

    await withAgentRun(
        { orgId, agentKey: 'ira', module: 'procurement', trigger: fromCron ? 'cron' : 'manual',
          runKey: dailyRunKey('ira-procurement-digest') },
        async (step) => {
            // Site ownership is read from the agent's config, not the request
            // body. The manual send and the cron must split mail identically —
            // two send paths that disagree about who owns Bengaluru is worse
            // than one that never split at all.
            const delivery = await resolveDelivery(orgId, AGENT_KEY);
            const replyTo = delivery.replyTo;
            const { data: props } = await supabaseAdmin
                .from('properties').select('name, city').eq('organization_id', orgId);
            const cityOf = cityLookup(props ?? []);

            // Same reviewer, same rule as the cron: the manual send is vetted too,
            // or the two paths would mail different things under the same name.
            const { data: agentRow } = await supabaseAdmin
                .from('oem_agents').select('display_name, runtime').eq('organization_id', orgId).eq('agent_key', AGENT_KEY).maybeSingle();
            const reportsTo = ((agentRow?.runtime ?? {}) as { reports_to?: string | null }).reports_to ?? null;
            if (reportsTo) {
                const v = await step(`Vetting by ${reportsTo}`, 'decide', { reports_to: reportsTo });
                const r = await vetFindings(orgId, AGENT_KEY, String(agentRow?.display_name ?? 'Ira'), reportsTo, scan.findings, scan.window.label);
                if (r.ok && r.reviewer && r.verdict) {
                    vet.stamp = { reviewer: r.reviewer.name, verdict: r.verdict, concerns: r.concerns.map((c) => ({ finding_key: c.finding_key, concern: c.concern })) };
                    await v.ok({ detail: { verdict: r.verdict, reasoning: r.reasoning, concerns: r.concerns, cost_usd: r.costUsd, logged: Boolean(r.loggedId) } });
                } else {
                    await v.ok({ detail: { skipped: r.why, cost_usd: r.costUsd } });
                }
            }

            for (const bundle of bundles) {
                const address = to[bundle.recipient.key];
                if (!address) { skipped.push(`${bundle.recipient.key} (no address given)`); continue; }
                // The caller named the address; site rules only decide the SPLIT
                // and the header, never a recipient the caller did not ask for.
                const slices = splitBySite(bundle, delivery.siteRules, [address], cityOf);

                for (const slice of slices) {
                    const who = slice.label ? `${bundle.recipient.key}/${slice.label}` : bundle.recipient.key;
                    // Links are minted PER RECIPIENT: a token is bound to one user, and
                    // one person's feedback link must never be usable by another.
                    const userId = body.userIds?.[bundle.recipient.key];
                    const links = userId
                        ? await mintFeedbackLinks({
                              organizationId: orgId, userId, agentKey: 'ira',
                              runId: null, findings: slice.bundle.findings,
                          })
                        : {};
                    if (!userId) skipped.push(`${who}: no userId — sent without feedback links`);

                    const subjects: Record<string, string> = {};
                    for (const f of slice.bundle.findings) subjects[f.key] = taggedSubject(f.title, replyTag(orgId, AGENT_KEY, f.key));

                    const { subject, html } = renderRecipientEmail(
                        slice.bundle, orgId, new Date(), links, [], replyTo, subjects, scan.statuses,
                        slice.label ? { label: slice.label, owners: slice.ownerNames } : null,
                        vet.stamp,
                    );
                    const s = await step(`Emailing ${who}`, 'notify',
                        { recipient: bundle.recipient.key, site: slice.label || null, owners: slice.ownerNames, findings: slice.bundle.counts.total });
                    try {
                        const outbound = await sendDigest(address, subject, html, replyTo);
                        sent.push(`${who} → ${address}`);
                        // The RFC Message-ID of the scan mail, kept on the run trace
                        // (oem_agent_run_steps.detail) so a later answer can chain
                        // References back to the message it is answering.
                        await s.ok(outbound.messageId ? { detail: { messageId: outbound.messageId } } : undefined);
                    } catch (e) {
                        // s.fail() is a no-op until the runtime tables exist, so the
                        // failure would otherwise vanish and the route still return 200.
                        const msg = e instanceof Error ? e.message : String(e);
                        console.error(`[ira procurement-digest] send to ${who} failed:`, msg);
                        skipped.push(`${who}: send failed — ${msg}`);
                        await s.fail(e);
                    }
                }
            }
            return {
                outcome: `sent ${sent.length}, skipped ${skipped.length} · ${scan.window.label}`,
                grounded: true,
            };
        },
    );

    return NextResponse.json({ ok: true, sent, skipped, vetted: vet.stamp ? { by: vet.stamp.reviewer, verdict: vet.stamp.verdict, concerns: vet.stamp.concerns } : null });
}
