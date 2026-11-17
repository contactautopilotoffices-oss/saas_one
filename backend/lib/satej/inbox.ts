/**
 * Quote requests that reach purchase@ by email, turned into Meera requests.
 *
 * The site and operations teams already ask the purchase desk for vendor quotes
 * by email ("Digitide BOQ – Request for Vendor Quote … Location: Sion, Mumbai").
 * Someone then retypes that into a requirement. This reads the purchase@ digest
 * (mailbox_threads, synced hourly by /api/cron/sync-purchase-mailbox), lists the
 * asks from colleagues, and drafts the form from the email. A person checks the
 * draft and submits it — nothing is started from an email by itself.
 *
 * Only headers and each message's opening lines are stored in the digest, never
 * full bodies or attachments, so a BOQ attached to the email is not read: the
 * draft says so in its notes.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { chatJSON } from './clients/llm';
import { satejConfig } from './config';
import { getRepo } from './repo';
import type { RequirementInput } from './types';

/** Colleagues, not vendors: only their emails are asks for a quote. */
const INTERNAL = /@(worksquare\.in|autopilotoffices\.com)$/i;
/** An ask for vendor quotes, in the words the team actually uses. */
const ASK = /\b(rfq|request (for|of) (vendor )?(quot|rate|price)|quot(e|ation)s? (required|request|needed)|need(ed)? (a )?(quot|rate|vendor)|vendor quot|get (the )?(rates|quot)|kindly (obtain|get|share) .*(quot|rate))/i;
/** Threads that look like asks but are approvals, scans or replies about an order already placed. */
const NOT_AN_ASK = /\b(approval|approved|po scan|purchase order|invoice|payment|utr|recalled)\b/i;

type Msg = { from?: string; subject?: string; summary?: string; sent_at?: string; has_attachment?: boolean };

export interface InboxAsk {
    threadId: string;
    subject: string;
    from: string;
    at: string;
    snippet: string;
    hasAttachment: boolean;
    /** REQ code of the Meera request already started from this email, if any. */
    startedAs: string | null;
}

async function threads(organizationId: string, days: number) {
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const { data, error } = await supabaseAdmin
        .from('mailbox_threads')
        .select('thread_id, subject, from_address, last_message_at, snippet, is_resolved, raw')
        .eq('organization_id', organizationId)
        .gte('last_message_at', since)
        .order('last_message_at', { ascending: false })
        .limit(500);
    if (error) throw new Error(`Purchase inbox: ${error.message}`);
    return data ?? [];
}

function firstMessage(raw: unknown): Msg | null {
    const msgs = (raw as { messages?: Msg[] } | null)?.messages;
    if (!Array.isArray(msgs) || !msgs.length) return null;
    return [...msgs].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)))[0];
}

/** Colleagues' requests for vendor quotes in the last `days` days, newest first. */
export async function inboxQuoteRequests(organizationId: string, days = 30): Promise<InboxAsk[]> {
    const [rows, reqs] = await Promise.all([threads(organizationId, days), getRepo().listRequirements(organizationId, 200)]);
    const started = new Map(reqs.filter((r) => r.input.sourceThreadId).map((r) => [r.input.sourceThreadId!, r.code]));
    const out: InboxAsk[] = [];
    for (const t of rows) {
        const first = firstMessage(t.raw);
        const from = String(first?.from ?? t.from_address ?? '');
        const subject = String(first?.subject ?? t.subject ?? '').replace(/^(re|fw|fwd)\s*:\s*/i, '');
        const text = `${subject} ${first?.summary ?? t.snippet ?? ''}`;
        if (!INTERNAL.test(from) || /^purchase@/i.test(from)) continue;
        if (!ASK.test(text) || NOT_AN_ASK.test(subject)) continue;
        out.push({
            threadId: String(t.thread_id),
            subject,
            from,
            at: String(t.last_message_at),
            snippet: String(first?.summary ?? t.snippet ?? ''),
            hasAttachment: !!first?.has_attachment,
            startedAs: started.get(String(t.thread_id)) ?? null,
        });
    }
    return out;
}

const DRAFT_SYSTEM = `
You turn an internal email asking the purchase team for vendor quotes into a draft purchase requirement.
Rules, in order. Do not skip any.
1. Use only what the email says. Leave a field as "" when the email does not say it. Never invent quantities, specs, sites or dates.
2. "title": a short name for the requirement, e.g. "Aluminium partition work, Digitide Pune".
3. "itemDescription": what is needed, in plain words, with any specs the email gives.
4. "spendType": "capex" for fit-out, installation, equipment or one-time work; "opex" for consumables, services, rentals and AMCs.
5. "scope": one of "Supply only", "Supply and installation", "Service", "AMC", or "".
6. "locationCity" and "locationArea": from the email (e.g. "Mumbai" and "Sion"). "siteName": the client or site name if given (e.g. "Digitide").
7. "timeline": as written ("at the earliest", "before noon tomorrow"), else "".
Return ONLY JSON: { "title": string, "itemDescription": string, "spendType": "capex" | "opex", "quantity": string, "unit": string, "scope": string, "locationCity": string, "locationArea": string, "siteName": string, "timeline": string }
`.trim();

export type InboxDraft = Partial<RequirementInput> & { sourceThreadId: string; notes: string };

/** A pre-filled requirement form from one email thread. The person reviews it before anything starts. */
export async function draftFromThread(organizationId: string, threadId: string): Promise<InboxDraft> {
    const { data, error } = await supabaseAdmin
        .from('mailbox_threads')
        .select('thread_id, subject, from_address, raw')
        .eq('organization_id', organizationId)
        .eq('thread_id', threadId)
        .maybeSingle();
    if (error) throw new Error(`Purchase inbox: ${error.message}`);
    if (!data) throw new Error('That email is not in the purchase inbox digest');
    const msgs = ((data.raw as { messages?: Msg[] } | null)?.messages ?? [])
        .slice()
        .sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
    const email = msgs.length
        ? msgs.map((m) => `From: ${m.from}\nDate: ${m.sent_at}\nSubject: ${m.subject}\n${m.summary ?? ''}`).join('\n---\n')
        : `Subject: ${data.subject}`;
    const first = msgs[0];
    const asker = String(first?.from ?? data.from_address ?? '');
    const attachmentNote = msgs.some((m) => m.has_attachment)
        ? ' The email has an attachment (likely the BOQ) that Meera cannot read: add quantities and specs from it.'
        : '';
    const notes = `From the purchase inbox: "${String(data.subject).slice(0, 120)}", asked by ${asker}.${attachmentNote}`;

    if (satejConfig.mockMode) {
        return { title: String(data.subject).slice(0, 80), itemDescription: first?.summary ?? '', sourceThreadId: threadId, notes };
    }
    const d = await chatJSON<Record<string, unknown>>({ task: 'inbox', system: DRAFT_SYSTEM, user: email.slice(0, 6000), model: 'fast' });
    const str = (k: string) => String(d[k] ?? '').trim();
    return {
        title: str('title') || String(data.subject).slice(0, 80),
        itemDescription: str('itemDescription'),
        spendType: d.spendType === 'opex' ? 'opex' : 'capex',
        quantity: str('quantity'),
        unit: str('unit'),
        scope: str('scope') || 'Supply and installation',
        locationCity: str('locationCity'),
        locationArea: str('locationArea'),
        siteName: str('siteName'),
        timeline: str('timeline'),
        sourceThreadId: threadId,
        notes,
    };
}
