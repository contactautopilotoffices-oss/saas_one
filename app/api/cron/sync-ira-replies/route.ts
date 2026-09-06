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
                    const c = await collectIraReplies(orgId, AGENT_KEY, since, box);
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
                            replyTag(orgId, AGENT_KEY, a.findingKey),
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
                if (needsAnswer.length) {
                    const st = await step(`${needsAnswer.length} reply(ies) asked something`, 'notify');
                    // The open refs addressed to a sender, so "which line?" can list them.
                    const { data: open } = await supabaseAdmin
                        .from('oem_agent_findings').select('finding_key, title')
                        .eq('organization_id', orgId).eq('agent_key', AGENT_KEY).is('disposition', null).limit(20);
                    const openRefs = (open ?? []).map((f) => `${replyTag(orgId, AGENT_KEY, String(f.finding_key))} — ${String(f.title).slice(0, 60)}`);
                    for (const n of needsAnswer) {
                        if (shadow) { notAnswered.push(`${n.senderEmail}: shadow, not sent`); continue; }
                        const o = await respondToReply(orgId, AGENT_KEY, n, {
                            enabled: delivery.respond.enabled, on: delivery.respond.on,
                            replyTo: delivery.replyTo, openRefsForSender: openRefs,
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
                    grounded: true,
                    result: { mailboxes, scanned, matched, applied, acknowledged: acked, ignored, answered, notAnswered, errors },
                };
            },
        );
        results.push({ orgId, ...(r ?? { mailboxes, scanned: 0, matched: 0, applied: 0 }) });
    }

    return NextResponse.json({ ok: true, results });
}
