/**
 * COLLECT REPLIES — the half of the loop that has to exist outside the email.
 * -----------------------------------------------------------------------------
 * An HTML email cannot contain a working text field (Zoho Mail strips <form>,
 * and AMP for Email — which would allow one — is not rendered by Zoho). So the
 * responder replies, and this reads the mailbox and turns those replies into
 * dispositions.
 *
 * Reuses ZohoMailService verbatim, the same client the purchase and electricity
 * mailbox crons already use. Nothing here talks to Zoho directly.
 *
 * ── MATCHING ────────────────────────────────────────────────────────────────
 * By SUBJECT TAG. `Re: [IRA-3F9A2B10] Trinity — same invoice…` survives every
 * client, every forward and every relay; a plus-addressed Reply-To does not. The
 * tag is derived from the finding, so nothing has to be stored to resolve it —
 * but it does have to be searched for, because the tag alone does not say which
 * finding it belongs to. We recompute tags for the org's open findings and match.
 *
 * ── WHO IS ALLOWED TO CLOSE A LINE ──────────────────────────────────────────
 * The sender address must resolve to a real users row in this org. A reply from
 * an address we cannot place is READ AND IGNORED, not applied — an inbox is a
 * public surface and anyone can send mail to it claiming anything.
 */

import { ZohoMailService } from '@/backend/services/zohoMailService';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { parseReply, replyTag, tagFromSubject } from './reply';
import { DISPOSITION_SPECS, signalFor } from './disposition';

/** Feedback coins, mirroring the console's DEFAULT_COINS. */
const COINS: Record<string, number> = { praise: 10, reject: -5, roi_flag: -15, correction: 0 };

export interface CollectResult {
    scanned: number;
    matched: number;
    applied: number;
    /** Read but deliberately not applied, with the reason. Never silent. */
    ignored: Array<{ from: string; subject: string; reason: string }>;
    errors: string[];
}

/**
 * Read replies since `since` and apply them. Never throws — a mailbox outage
 * must not take down the cron that also does other work.
 */
export async function collectIraReplies(
    orgId: string,
    agentKey: string,
    since: Date,
): Promise<CollectResult> {
    const out: CollectResult = { scanned: 0, matched: 0, applied: 0, ignored: [], errors: [] };

    // 1. Open findings, and the tag each one answers to.
    const { data: findings, error: fErr } = await supabaseAdmin
        .from('oem_agent_findings')
        .select('id, finding_key, title')
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .is('disposition', null);

    if (fErr) {
        out.errors.push(`findings store unavailable: ${fErr.message}`);
        return out;
    }
    if (!findings?.length) return out;

    const byTag = new Map<string, { id: string; finding_key: string; title: string }>();
    for (const f of findings) {
        byTag.set(replyTag(orgId, agentKey, String(f.finding_key)), {
            id: String(f.id), finding_key: String(f.finding_key), title: String(f.title ?? ''),
        });
    }

    // 2. Read the mailbox.
    let messages;
    try {
        messages = await ZohoMailService.listMessages({ since });
    } catch (e) {
        out.errors.push(`mailbox read failed: ${e instanceof Error ? e.message : e}`);
        return out;
    }
    out.scanned = messages.length;

    for (const msg of messages) {
        const tag = tagFromSubject(msg.subject ?? '');
        if (!tag) continue;
        const finding = byTag.get(tag);
        if (!finding) {
            out.ignored.push({ from: msg.fromAddress, subject: msg.subject, reason: `tag ${tag} matches no open finding` });
            continue;
        }
        out.matched++;

        // 3. The sender must be someone we know, in this org.
        const email = (msg.fromAddress ?? '').toLowerCase().trim();
        const { data: user } = await supabaseAdmin
            .from('users').select('id, full_name').ilike('email', email).maybeSingle();
        if (!user) {
            out.ignored.push({ from: msg.fromAddress, subject: msg.subject, reason: 'sender is not a known user — not applied' });
            continue;
        }

        // 4. Their words.
        let body = msg.summary ?? '';
        try {
            const full = await ZohoMailService.getMessageContent(msg.messageId);
            if (full?.content) body = full.content;
        } catch {
            // Fall back to the summary rather than losing the reply entirely.
        }
        const parsed = parseReply(body);
        const spec = DISPOSITION_SPECS[parsed.disposition];

        // A disposition that needs an explanation, sent without one, is left open.
        // Applying it would record a closure nobody justified.
        if (spec.requiresNote && !parsed.note) {
            out.ignored.push({ from: msg.fromAddress, subject: msg.subject, reason: `"${spec.label}" needs a reason; reply had none` });
            continue;
        }

        const { error: upErr } = await supabaseAdmin
            .from('oem_agent_findings')
            .update({
                disposition: parsed.disposition,
                disposition_note: parsed.note || null,
                dispositioned_by: user.id,
                dispositioned_at: new Date().toISOString(),
            })
            .eq('id', finding.id)
            .is('disposition', null); // first reply wins; a second does not overwrite

        if (upErr) { out.errors.push(`${finding.finding_key}: ${upErr.message}`); continue; }

        await supabaseAdmin.from('oem_agent_finding_events').insert({
            finding_id: finding.id,
            organization_id: orgId,
            disposition: parsed.disposition,
            note: parsed.note || null,
            source: 'email',
            created_by: user.id,
        });

        // The training signal, derived — nobody was asked to rate anything.
        const signal = signalFor(parsed.disposition);
        if (signal) {
            await supabaseAdmin.from('oem_agent_feedback').insert({
                organization_id: orgId,
                agent_key: agentKey,
                signal,
                coins: COINS[signal] ?? 0,
                roi_flag: false,
                reason: `${spec.label} — ${finding.title}`.slice(0, 300),
                guidance: parsed.note ? `[${finding.finding_key}] ${parsed.note}` : null,
                applied_to_prompt_version: null,
                created_by: user.id,
            });
        }
        out.applied++;
    }

    return out;
}
