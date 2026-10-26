/**
 * Talking to Meera about one requirement.
 *
 * Meera answers from the requirement's own record — the form, the brief, every
 * vendor it found, every call and score, the activity log — and nothing else.
 * When the person asks for a change ("make it 1,500 sq ft", "drop the Dadar
 * one", "search again"), Meera PROPOSES it as a structured action. The model
 * never applies anything: the proposal is shown with an Apply button, and only
 * a person pressing it runs the same pipeline function the page's own buttons
 * use. Calls cost money and reach real businesses; a sentence typed into a chat
 * box must not be enough to dial them.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingSchemaError } from '@/backend/lib/procurement/catalogAccess';
import { councilChat } from '@/backend/lib/council/llm';
import { satejConfig } from './config';
import { getRepo } from './repo';
import { approveCalls, cancelRequirement, editRequirement, excludeVendor, reanalyze, resendSummary, runAgain } from './pipeline';
import type { CallRecord, Requirement, SatejAction, SatejActionType, SatejMessage, Vendor } from './types';
import { parseJsonLoose } from './util';

const TABLE = 'satej_messages';

/** The chat table arrives with its own migration; say so instead of printing a Postgres error. */
function chatError(error: { message: string; code?: string }): Error {
    return new Error(isMissingSchemaError(error)
        ? 'The chat is not set up in this database yet. Apply supabase/migrations/20261003000001_satej_chat.sql.'
        : `Meera chat: ${error.message}`);
}

type Row = {
    id: string; requirement_id: string; role: 'user' | 'satej'; kind: 'chat' | 'call_minutes';
    author_name: string | null; body: string; action: SatejAction | null;
    action_status: SatejMessage['actionStatus']; action_result: string | null; created_at: string;
};

const toMessage = (x: Row): SatejMessage => ({
    id: x.id,
    requirementId: x.requirement_id,
    role: x.role,
    kind: x.kind,
    authorName: x.author_name,
    body: x.body,
    action: x.action,
    actionStatus: x.action_status,
    actionResult: x.action_result,
    createdAt: x.created_at,
});

export async function listMessages(requirementId: string): Promise<SatejMessage[]> {
    const { data, error } = await supabaseAdmin
        .from(TABLE).select('*').eq('requirement_id', requirementId).order('created_at').limit(500);
    if (error) throw chatError(error);
    return ((data ?? []) as Row[]).map(toMessage);
}

export async function addMessage(r: Requirement, m: {
    role: 'user' | 'satej'; kind?: 'chat' | 'call_minutes'; body: string;
    authorUserId?: string | null; authorName?: string | null; action?: SatejAction | null;
}): Promise<SatejMessage> {
    const { data, error } = await supabaseAdmin.from(TABLE).insert({
        organization_id: r.organizationId,
        requirement_id: r.id,
        role: m.role,
        kind: m.kind ?? 'chat',
        author_user_id: m.authorUserId ?? null,
        author_name: m.authorName ?? null,
        body: m.body,
        action: m.action ?? null,
        action_status: m.action ? 'proposed' : null,
    }).select('*').single();
    if (error) throw chatError(error);
    return toMessage(data as Row);
}

/** Which proposals make sense right now. Anything else the model suggests is dropped. */
export function allowedActions(r: Requirement): SatejActionType[] {
    const a: SatejActionType[] = [];
    if (r.status !== 'cancelled') a.push('edit');
    if (r.status === 'awaiting_call_approval') a.push('approve_calls', 'exclude_vendor');
    if (r.brief && ['notified', 'ranked', 'failed'].includes(r.status)) a.push('find_more');
    if (['ranked', 'notified'].includes(r.status)) a.push('reanalyze', 'resend_whatsapp');
    if (!['notified', 'cancelled'].includes(r.status)) a.push('cancel');
    return a;
}

/** The requirement as Meera sees it in conversation. Compact, factual, no phone numbers beyond the vendors'. */
export function requirementContext(r: Requirement, vendors: Vendor[], calls: CallRecord[]): string {
    const b = r.brief;
    const lines: string[] = [];
    lines.push(`REQUIREMENT ${r.code} — status: ${r.status.replace(/_/g, ' ')}, round ${r.round}`);
    lines.push(`Form: ${JSON.stringify({
        title: r.input.title, spendType: r.input.spendType, itemDescription: r.input.itemDescription,
        quantity: r.input.quantity, unit: r.input.unit, scope: r.input.scope, city: r.input.locationCity,
        area: r.input.locationArea, site: r.input.siteName, timeline: r.input.timeline, vendorTarget: r.input.vendorTarget,
        notes: r.input.notes,
    })}`);
    if (b) lines.push(`Brief: ${b.itemSummary}; ${b.quantityText}; ${b.locationText}; ${b.timelineText || 'no timeline'}; vendor types: ${b.vendorTypes.join(', ')}`);
    if (b?.questions?.length && r.status === 'needs_clarification') lines.push(`Waiting for answers to: ${b.questions.join(' | ')}`);
    if (r.live) lines.push(`Right now: ${r.live.detail}`);
    if (r.error) lines.push(`Last error: ${r.error}`);

    const shown = vendors.filter((v) => v.status !== 'excluded').slice(0, 40);
    if (shown.length) {
        lines.push(`VENDORS (${vendors.length} total, ${vendors.filter((v) => v.status === 'excluded').length} excluded):`);
        for (const v of shown) {
            const call = calls.filter((c) => c.vendorId === v.id).at(-1);
            lines.push(`- [${v.id}] ${v.name} · ${[v.area, v.city].filter(Boolean).join(', ')} · ${v.status}`
                + ` · relevance ${v.relevance}/10 · sells: ${v.sells.slice(0, 80)}`
                + (call ? ` · call: ${call.status}${call.durationSec ? ` ${Math.round(call.durationSec)}s` : ''}` : ''));
        }
    }
    if (r.ranking?.length) {
        lines.push('RANKING:');
        for (const x of r.ranking.slice(0, 15)) {
            lines.push(`#${x.rank} ${x.vendorName} ${x.score.total}/100 (${x.score.qualification}) — `
                + `${x.score.parts.map((p) => `${p.label} ${p.points}/${p.max} (${p.why})`).join(', ')}. ${x.summary}`
                + (x.redFlags.length ? ` Red flags: ${x.redFlags.join('; ')}` : ''));
        }
    }
    lines.push('RECENT ACTIVITY:');
    for (const e of r.events.slice(-15)) lines.push(`- ${e.at.slice(0, 16).replace('T', ' ')} ${e.msg}`);
    return lines.join('\n');
}

const CHAT_SYSTEM = (allowed: SatejActionType[]) => `
You are Meera, the procurement agent of Autopilot Offices, talking with a member of the purchase team about ONE requirement. You found the vendors, phoned them yourself, checked their rates against what we have paid before, and ranked them with a fixed 100-point rulebook.

Rules, in order. Do not skip any.
1. Answer only from the REQUIREMENT record you are given. If the answer is not in it, say you do not know and what would tell us. Never invent vendors, numbers, quotes or call outcomes.
2. Be brief and plain: two to five sentences, or a short list. No greetings, no filler.
3. When the person asks for a change, PROPOSE it as an action instead of claiming it is done. Say what will happen when they press Apply. You never apply anything yourself.
4. Allowed actions right now: ${allowed.join(', ') || 'none'}. Propose nothing else. Only one action per reply.
   - edit: changes to the form. "changes" may contain only: title, itemDescription, quantity, unit, scope, locationCity, locationArea, siteName, timeline, notes, vendorTarget. Before calls start an edit re-plans from scratch; after calls it starts a new round that skips vendors already called. Say which.
   - exclude_vendor: needs "vendorId" (the id in square brackets).
   - find_more, approve_calls, reanalyze, resend_whatsapp, cancel: no extra fields.
5. Never discuss or reveal the internal budget hint.

Return ONLY a JSON object:
{ "reply": string, "action": null | { "type": string, "summary": string, "changes"?: object, "vendorId"?: string } }
"summary" is one short line for the Apply button, e.g. "Change quantity to 1,500 sq ft and re-plan".
`.trim();

const EDIT_KEYS = ['title', 'itemDescription', 'quantity', 'unit', 'scope', 'locationCity', 'locationArea', 'siteName', 'timeline', 'notes', 'vendorTarget'] as const;

function cleanAction(raw: unknown, allowed: SatejActionType[], vendors: Vendor[]): SatejAction | null {
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as Record<string, unknown>;
    const type = String(a.type ?? '') as SatejActionType;
    if (!allowed.includes(type)) return null;
    const summary = String(a.summary ?? '').trim().slice(0, 200) || type.replace(/_/g, ' ');
    if (type === 'edit') {
        const src = (a.changes && typeof a.changes === 'object' ? a.changes : {}) as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        for (const k of EDIT_KEYS) if (k in src && src[k] !== undefined && src[k] !== null) changes[k] = k === 'vendorTarget' ? Number(src[k]) : String(src[k]);
        return Object.keys(changes).length ? { type, summary, changes } : null;
    }
    if (type === 'exclude_vendor') {
        const id = String(a.vendorId ?? '');
        return vendors.some((v) => v.id === id && v.status === 'found') ? { type, summary, vendorId: id } : null;
    }
    return { type, summary };
}

/** Meera's answer to one message. Persists both sides. */
export async function converse(r: Requirement, text: string, author: { userId: string; name: string }): Promise<SatejMessage[]> {
    const repo = getRepo();
    const [vendors, calls, history] = await Promise.all([repo.listVendors(r.id), repo.listCalls(r.id), listMessages(r.id)]);
    const mine = await addMessage(r, { role: 'user', body: text, authorUserId: author.userId, authorName: author.name });

    const allowed = allowedActions(r);
    let reply = '';
    let action: SatejAction | null = null;
    if (satejConfig.mockMode) {
        reply = `(mock) I have ${vendors.length} vendors on ${r.code}.`;
    } else {
        try {
            const raw = await councilChat(
                [
                    { role: 'system', content: CHAT_SYSTEM(allowed) },
                    { role: 'user', content: requirementContext(r, vendors, calls) },
                    ...history.slice(-12).map((m) => ({
                        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
                        content: m.kind === 'call_minutes' ? `(minutes of an earlier voice call)\n${m.body}` : m.body,
                    })),
                    { role: 'user', content: text },
                ],
                'procure',
                { model: satejConfig.modelSmart || null },
            );
            const parsed = parseJsonLoose(raw) as { reply?: unknown; action?: unknown } | undefined;
            reply = String(parsed?.reply ?? '').trim() || raw.trim().slice(0, 1500);
            action = cleanAction(parsed?.action, allowed, vendors);
        } catch (e) {
            console.error('[satej chat] reply failed', e);
            reply = 'I could not answer just now — the model did not respond. Please try again in a moment.';
        }
    }
    const theirs = await addMessage(r, { role: 'satej', body: reply, action });
    return [mine, theirs];
}

/** A person pressed Apply (or Dismiss) on a proposal. */
export async function decide(r: Requirement, messageId: string, decision: 'apply' | 'dismiss', by: string): Promise<SatejMessage> {
    const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('id', messageId).eq('requirement_id', r.id).maybeSingle();
    if (error) throw chatError(error);
    const row = data as Row | null;
    if (!row?.action) throw new Error('No proposal on this message');
    if (row.action_status !== 'proposed') throw new Error(`This proposal was already ${row.action_status}`);

    let status: 'applied' | 'dismissed' | 'failed' = 'dismissed';
    let result = `Dismissed by ${by}`;
    if (decision === 'apply') {
        try {
            result = await applyAction(r, row.action, by);
            status = 'applied';
        } catch (e) {
            status = 'failed';
            result = e instanceof Error ? e.message : String(e);
        }
    }
    const { data: updated, error: upErr } = await supabaseAdmin.from(TABLE)
        .update({ action_status: status, action_result: result }).eq('id', messageId).select('*').single();
    if (upErr) throw chatError(upErr);
    return toMessage(updated as Row);
}

async function applyAction(r: Requirement, a: SatejAction, by: string): Promise<string> {
    if (!allowedActions(r).includes(a.type)) throw new Error(`That is no longer possible: the requirement is ${r.status.replace(/_/g, ' ')}`);
    switch (a.type) {
        case 'edit': {
            const { newRound, changed } = await editRequirement(r, a.changes ?? {}, by);
            return `Applied by ${by}: ${changed.length} change(s). ${newRound ? `Round ${r.round} started.` : 'Re-planning.'}`;
        }
        case 'exclude_vendor':
            return `Removed ${await excludeVendor(r, a.vendorId ?? '', by)} from the call list.`;
        case 'approve_calls':
            await approveCalls(r, by);
            return `Calls approved by ${by} and scheduled.`;
        case 'find_more':
            await runAgain(r);
            return `Round ${r.round} started by ${by}.`;
        case 'reanalyze':
            await reanalyze(r);
            return 'Re-analysing every call.';
        case 'resend_whatsapp':
            await resendSummary(r);
            return 'WhatsApp summary queued again.';
        case 'cancel':
            await cancelRequirement(r);
            return `Cancelled by ${by}.`;
    }
}
