/**
 * IRA REPLIES — read every configured mailbox, turn replies into dispositions,
 * and answer the ones that asked something.
 *
 * The closing half of the digest loop. Vidya replies to a finding; this reads it
 * and closes the line, which is what stops the next scan raising it again. If
 * she asked "which PO?", Ira answers in the same thread with the record.
 *
 * Bearer-guarded like every other cron. Dormant and harmless until
 * 20260905000001_agent_findings is applied and ZOHO_MAIL_* creds are set — it
 * reports what it could not do rather than throwing.
 *
 * vercel.json: { "path": "/api/cron/sync-ira-replies", "schedule": "*\/15 * * * *" }
 *
 * MAILBOXES: every address in runtime.inbox.poll_addresses (plus the older
 * poll_address), per org. Previously ONE global env mailbox was scanned once
 * per org regardless of what the console said — poll_address was decorative.
 *
 * WINDOW: runtime.inbox.lookback_hours (default 24) of mail on every pass, not
 * 15 minutes. Overlap is free — a reply already applied is skipped by the
 * `.is('disposition', null)` guard in the collector — whereas a gap silently
 * loses somebody's answer, and they will not send it twice.
 *
 * OVERLAP IS FREE FOR READS, NOT FOR SENDS. That distinction was missing and it
 * cost ~190 identical mails in a day: an answered reply stays in the 24h window,
 * stopped matching once its line was dispositioned, and was re-read as
 * "unmatched" on all 96 passes — twice over, because it sat in two polled
 * mailboxes. Three separate bounds now hold it:
 *   - the collector resolves refs against answered lines too, and stays quiet
 *     on one that is already dispositioned;
 *   - a question is only asked about mail newer than the last pass (askSince);
 *   - the same reply seen in two mailboxes is answered once.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { withAgentRun } from '@/backend/lib/agents/instrument';
import { collectIraReplies, type ReplyNeedingAnswer, type AppliedReply } from '@/backend/lib/ira/procurement/collectReplies';
import { respondToReply, acknowledgement } from '@/backend/lib/ira/procurement/respond';
import { sendDigest } from '@/backend/lib/ira/dailyDigest';
import { replyTag } from '@/backend/lib/ira/procurement/reply';
import { resolveDelivery } from '@/backend/lib/ira/procurement/delivery';
import { isZohoMailConfigured, mailboxAddress } from '@/backend/services/zohoMailService';
import type { AgentRuntimeConfig } from '@/frontend/types/agentRuntime';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const AGENT_KEY = 'ira';

/** Stamped on every run of THIS job, so a pass can find where the last one got to. */
const RUN_REF = 'ira:replies';

/** If we cannot see the previous pass, ask only about mail newer than this. */
const ASK_FALLBACK_MIN = 25;

/**
 * WHERE THE LAST PASS GOT TO.
 *
 * The read window is a day wide on purpose — a reply that is applied twice is a
 * no-op, and a reply that is missed is somebody's answer thrown away. But an
 * ASK is not idempotent: every pass that cannot place a reply sends a fresh
 * mail. So questions are bounded by the previous run, and an unplaceable reply
 * is asked about once rather than 96 times a day.
 *
 * Falls back to a single cron interval when the run log has nothing to say —
 * the fallback errs towards asking too little, because too much is what this is
 * here to stop.
 */
async function askSinceFor(orgId: string): Promise<Date> {
    const fallback = new Date(Date.now() - ASK_FALLBACK_MIN * 60_000);
    try {
        const { data } = await supabaseAdmin
            .from('oem_agent_runs')
            .select('started_at')
            .eq('organization_id', orgId).eq('agent_key', AGENT_KEY).eq('entity_ref', RUN_REF)
            .order('started_at', { ascending: false }).limit(1).maybeSingle();
        const t = data?.started_at ? Date.parse(String(data.started_at)) : NaN;
        return Number.isFinite(t) ? new Date(t) : fallback;
    } catch {
        return fallback;
    }
}

/** Every mailbox this org's agent reads. Falls back to the env default so nothing goes dark. */
function mailboxesFor(runtime: AgentRuntimeConfig | null): string[] {
    const inbox = runtime?.inbox ?? {};
    const list = [...(inbox.poll_addresses ?? []), ...(inbox.poll_address ? [inbox.poll_address] : [])]
        .map((x) => String(x).trim().toLowerCase()).filter((x) => x.includes('@'));
    return list.length ? Array.from(new Set(list)) : [mailboxAddress()];
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isZohoMailConfigured()) {
        return NextResponse.json({ ok: true, skipped: 'ZOHO_MAIL_* not configured' });
    }

    // Orgs that actually run this agent, with their runtime, rather than a hardcoded id.
    const { data: agents, error } = await supabaseAdmin
        .from('oem_agents').select('organization_id, runtime, status').eq('agent_key', AGENT_KEY);

    if (error) {
        return NextResponse.json({ ok: true, skipped: `agent registry unavailable: ${error.message}` });
    }

    const results = [];

    for (const a of agents ?? []) {
        const orgId = String(a.organization_id);
        if (!['live', 'shadow'].includes(String(a.status))) { results.push({ orgId, skipped: `status ${a.status}` }); continue; }
        const runtime = (a.runtime ?? null) as AgentRuntimeConfig | null;
        const lookbackH = runtime?.inbox?.lookback_hours ?? 24;
        const since = new Date(Date.now() - lookbackH * 3600_000);
        const mailboxes = mailboxesFor(runtime);
        const delivery = await resolveDelivery(orgId, AGENT_KEY);
        const shadow = String(a.status) === 'shadow';
        const askSince = await askSinceFor(orgId);
        // Anything sent AS Ira is our own outbound wherever it turns up — she
        // polls mailboxes that are also on the digest's To line.
        const selfAddresses = [delivery.from, delivery.replyTo, runtime?.inbox?.from]
            .map((x) => String(x ?? '').toLowerCase().trim()).filter(Boolean);

        const r = await withAgentRun(
            {
                orgId, agentKey: AGENT_KEY, module: 'procurement', trigger: shadow ? 'shadow' : 'cron',
                // No runKey: every pass should be traced, and this runs quarter-hourly.
            },
            async (step) => {
                let scanned = 0, matched = 0, applied = 0;
                const ignored: Array<{ from: string; subject: string; reason: string; mailbox: string }> = [];
                const needsAnswer: ReplyNeedingAnswer[] = [];
                const appliedReplies: AppliedReply[] = [];
                const errors: string[] = [];

                for (const box of mailboxes) {
                    const s = await step(`Reading ${box} since ${since.toISOString().slice(0, 16)}`, 'fetch', { mailbox: box });
                    const c = await collectIraReplies(orgId, AGENT_KEY, since, box, { askSince, selfAddresses });
                    scanned += c.scanned; matched += c.matched; applied += c.applied;
                    ignored.push(...c.ignored.map((i) => ({ ...i, mailbox: box })));
                    needsAnswer.push(...c.needsAnswer);
                    appliedReplies.push(...c.applied_replies);
                    errors.push(...c.errors);
                    if (c.errors.length) await s.fail(new Error(c.errors.join('; ')));
                    else await s.ok({ detail: { scanned: c.scanned, matched: c.matched, applied: c.applied, ignored: c.ignored.length } });
                }

                // Ignored replies are a real operator signal — somebody answered and
                // it did not land. Surface them rather than counting them silently.
                if (ignored.length) {
                    const i = await step(`${ignored.length} reply(ies) read but not applied`, 'decide');
                    await i.ok({ detail: { ignored: ignored.slice(0, 10) } });
                }

                /**
                 * ACKNOWLEDGE EVERY ANSWER, straight away.
                 *
                 * Not a model call and not conditional on respond.enabled: a
                 * person who writes in should always be told what was recorded
                 * and against which order. Silence after an answer is why the
                 * last nine runs produced none.
                 */
                const acked: string[] = [];
                if (appliedReplies.length && !shadow) {
                    const ak = await step(`Acknowledging ${appliedReplies.length} answer(s)`, 'notify');
                    for (const a of appliedReplies) {
                        const msg = acknowledgement(
                            a.senderName, a.poLabels, a.disposition, a.note,
                            replyTag(orgId, AGENT_KEY, a.findingKey), a.subject,
                        );
                        try {
                            await sendDigest(
                                a.senderEmail, msg.subject,
                                `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.65;color:#16181C;white-space:pre-wrap">${msg.body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`,
                                { replyTo: delivery.replyTo, inReplyTo: a.messageId },
                            );
                            acked.push(`${a.senderEmail} · ${a.poLabels[0] ?? a.findingKey}`);
                        } catch (e) {
                            console.error('[ira ack]', a.senderEmail, e instanceof Error ? e.message : e);
                        }
                    }
                    await ak.ok({ detail: { acknowledged: acked } });
                }

                // Answer back — only where the console says to, never in shadow.
                const answered: string[] = [];
                const notAnswered: string[] = [];
                /**
                 * ONE MAIL PER REPLY, not one per mailbox it landed in.
                 *
                 * A digest addressed to two people whose mailboxes are both
                 * polled comes back as the same reply twice, with a different
                 * per-account message id each time. Answering both sends the
                 * sender two identical mails.
                 */
                const seen = new Set<string>();
                const toAnswer = needsAnswer.filter((n) => {
                    const k = `${n.senderEmail}|${n.findingId ?? ''}|${n.subject.trim().toLowerCase()}`;
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                });

                if (toAnswer.length) {
                    const st = await step(`${toAnswer.length} reply(ies) asked something`, 'notify');
                    // The lines still open, so "which line?" can offer something to
                    // quote. NOT "addressed to you": routing is decided at send time
                    // and not stored per finding, so claiming these are the sender's
                    // own would be a claim we cannot support.
                    const { data: open } = await supabaseAdmin
                        .from('oem_agent_findings').select('finding_key, title')
                        .eq('organization_id', orgId).eq('agent_key', AGENT_KEY).is('disposition', null)
                        .order('last_seen_at', { ascending: false }).limit(8);
                    const openRefs = (open ?? []).map((f) => `${replyTag(orgId, AGENT_KEY, String(f.finding_key))} — ${String(f.title).slice(0, 60)}`);
                    for (const n of toAnswer) {
                        if (shadow) { notAnswered.push(`${n.senderEmail}: shadow, not sent`); continue; }
                        const o = await respondToReply(orgId, AGENT_KEY, n, {
                            enabled: delivery.respond.enabled, on: delivery.respond.on,
                            replyTo: delivery.replyTo, openRefs,
                        });
                        (o.sent ? answered : notAnswered).push(`${n.senderEmail} (${n.because}): ${o.why}`);
                    }
                    await st.ok({ detail: { answered, notAnswered: notAnswered.slice(0, 10) } });
                }

                for (const e of errors) console.error('[ira replies]', orgId, e);

                return {
                    outcome: applied > 0
                        ? `Closed ${applied} line(s) from ${matched} matched reply(ies) across ${mailboxes.length} mailbox(es)${answered.length ? `, answered ${answered.length}` : ''}.`
                        : `No replies applied${matched ? ` (${matched} matched but not applied)` : ''} across ${mailboxes.length} mailbox(es)${answered.length ? `, answered ${answered.length}` : ''}.`,
                    status: (applied === 0 && answered.length === 0 ? 'skipped' : 'succeeded') as 'skipped' | 'succeeded',
                    // How the next pass finds where this one got to. See askSinceFor().
                    entityRef: RUN_REF,
                    grounded: true,
                    result: { mailboxes, scanned, matched, applied, acknowledged: acked, ignored, answered, notAnswered, errors },
                };
            },
        );
        results.push({ orgId, ...(r ?? { mailboxes, scanned: 0, matched: 0, applied: 0 }) });
    }

    return NextResponse.json({ ok: true, results });
}
