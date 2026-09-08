import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccessForUser, isPettyCashAccessError } from '@/backend/lib/pettyCash/access';
import { planPettyCashTransition, actorFromAccess } from '@/backend/lib/pettyCash/transitions';
import { notifyPettyCash } from '@/backend/lib/pettyCash/notify';
import { resolveAccountsAccessForUser, isAccountsAccessError } from '@/backend/lib/accounts/access';
import { planPaymentTransition, paymentActorFromAccess } from '@/backend/lib/accounts/transitions';
import { logPoActivity } from '@/backend/lib/accounts/activity';
import type { PoActivityAction } from '@/backend/lib/accounts/trackerTypes';
import type { EmailActionToken } from './tokens';
import { DISPOSITION_SPECS, isDisposition, type Disposition } from '@/backend/lib/ira/procurement/disposition';
import { isOrgMember } from '@/backend/lib/ira/procurement/guard';

/**
 * Per-entity handlers for one-click email actions.
 *
 * Each handler re-derives permissions from LIVE memberships at click time (never from
 * anything baked into the token) and then defers to that domain's shared state machine,
 * so an emailed click can never do something the API would refuse.
 *
 * Adding an entity type means adding a case here — the route stays thin.
 */

export type HandlerOutcome =
    | { ok: true; title: string; message: string }
    | { ok: false; status: number; title: string; message: string };

const denied = (): HandlerOutcome => ({
    ok: false, status: 403,
    title: 'You no longer have access',
    message: 'Your permissions for this organisation have changed since this email was sent.',
});

export function isSupportedEntity(entityType: string): boolean {
    return entityType === 'petty_cash_request'
        || entityType === 'po_payment'
        || entityType === 'agent_feedback';
}

/**
 * Entity types whose landing page ASKS before it acts, instead of auto-submitting.
 *
 * The auto-submit on the 'confirming' page is a deliberate defence against mail
 * scanners that issue GETs. A feedback link inverts that requirement: it exists to
 * collect what a human types, so it must render a form and wait. The route reads
 * this to decide which page to show on GET.
 */
export function needsInput(entityType: string): boolean {
    return entityType === 'agent_feedback';
}

/** An uploaded proof-of-completion file, when the responder attached one. */
export interface ProofUpload { name: string; type: string; bytes: Buffer }

export async function handleEmailAction(t: EmailActionToken, remark: string, proof?: ProofUpload | null): Promise<HandlerOutcome> {
    if (t.entity_type === 'petty_cash_request') return handlePettyCash(t, remark);
    if (t.entity_type === 'po_payment') return handlePoPayment(t, remark);
    if (t.entity_type === 'agent_feedback') return handleAgentFeedback(t, remark, proof ?? null);
    return { ok: false, status: 400, title: 'Unsupported action', message: 'This link refers to something this server cannot action.' };
}

async function handlePettyCash(t: EmailActionToken, remark: string): Promise<HandlerOutcome> {
    const access = await resolvePettyCashAccessForUser({ id: t.user_id }, t.organization_id);
    if (isPettyCashAccessError(access)) return denied();

    const { data: req } = await supabaseAdmin
        .from('petty_cash_requests')
        .select('*, requester:users!petty_cash_requests_requester_id_fkey(full_name)')
        .eq('id', t.entity_id)
        .eq('organization_id', t.organization_id)
        .maybeSingle();
    if (!req) return notFound();

    const now = new Date().toISOString();
    const body = { ...(t.payload || {}), remark };
    const plan = planPettyCashTransition({ req, actor: actorFromAccess(access), action: t.action, body, now });
    if (!plan.ok) return planFailed(plan.error, plan.status);

    const { data: updated, error } = await supabaseAdmin
        .from('petty_cash_requests').update(plan.patch).eq('id', t.entity_id)
        .select('*, requester:users!petty_cash_requests_requester_id_fkey(full_name)').single();
    if (error) return saveFailed(error.message);

    await supabaseAdmin.from('petty_cash_activity').insert({
        request_id: t.entity_id, organization_id: t.organization_id, actor_id: t.user_id,
        action: t.action, from_status: req.status, to_status: (plan.patch as any).status,
        remark: `${remark} (via email)`,
    });

    if (plan.notifyKind) {
        notifyPettyCash(plan.notifyKind, { ...updated, requester_name: (updated.requester as any)?.full_name }, remark)
            .catch(() => {});
    }

    const verb = pastTense(t.action);
    return {
        ok: true,
        title: `Request ${verb}`,
        message: `${req.request_no} from ${(req.requester as any)?.full_name || 'the requester'} has been ${verb}. Everyone involved has been notified.`,
    };
}

async function handlePoPayment(t: EmailActionToken, remark: string): Promise<HandlerOutcome> {
    const access = await resolveAccountsAccessForUser({ id: t.user_id }, t.organization_id);
    if (isAccountsAccessError(access)) return denied();

    const { data: pay } = await supabaseAdmin
        .from('po_payments').select('*')
        .eq('id', t.entity_id)
        .eq('organization_id', t.organization_id)
        .maybeSingle();
    if (!pay) return notFound();

    // 'complete' requires a UTR, which a single click cannot supply — the emailed buttons
    // never offer it, and this rejects any token that somehow asks for it.
    if (t.action === 'complete') {
        return {
            ok: false, status: 400,
            title: 'Open the app to complete this',
            message: 'Completing a payment requires the UTR number, so it cannot be done from an email link.',
        };
    }

    const now = new Date().toISOString();
    const body = { ...(t.payload || {}), remarks: remark };
    const plan = planPaymentTransition({ pay, actor: paymentActorFromAccess(access), action: t.action, body, now });
    if (!plan.ok) return planFailed(plan.error, plan.status);

    const { error } = await supabaseAdmin
        .from('po_payments').update(plan.patch).eq('id', t.entity_id)
        .eq('organization_id', t.organization_id);
    if (error) return saveFailed(error.message);

    // actor_channel 'email' is the whole point of recording this separately: the timeline
    // must show that the decision arrived through a mailed link, not from someone sitting
    // in the app. Never allowed to fail the action — see activity.ts.
    const activityAction: PoActivityAction =
        t.action === 'align' ? 'aligned' : t.action === 'cancel' ? 'cancelled' : 'email_action';
    await logPoActivity({
        organizationId: t.organization_id,
        poId: pay.po_id,
        paymentId: pay.id,
        action: activityAction,
        fromStatus: pay.status,
        toStatus: (plan.patch as Record<string, unknown>).status as string | undefined ?? null,
        actorId: t.user_id,
        actorChannel: 'email',
        note: remark,
        detail: { via: 'email_action', requested_action: t.action, tranche_no: pay.tranche_no },
    });

    const verb = pastTense(t.action);
    return {
        ok: true,
        title: `Payment ${verb}`,
        message: `Tranche ${pay.tranche_no} on ${pay.po_number || 'the PO'} (${pay.vendor_name || 'vendor'}) has been ${verb}.`,
    };
}

const notFound = (): HandlerOutcome =>
    ({ ok: false, status: 404, title: 'Not found', message: 'It may have been deleted since the email was sent.' });

const saveFailed = (detail: string): HandlerOutcome => {
    console.error('[emailActions] save failed:', detail);
    return { ok: false, status: 500, title: 'Could not save', message: 'Something went wrong applying the action. Please open the app and try there.' };
};

const planFailed = (error: string, status: number): HandlerOutcome =>
    ({ ok: false, status, title: status === 409 ? 'Already actioned' : 'Action not allowed', message: error });

function pastTense(action: string): string {
    if (action === 'approve') return 'approved';
    if (action === 'reject') return 'rejected';
    if (action === 'cancel') return 'cancelled';
    return `${action}ed`;
}


/* ---------------------------------------------------------------------------
 * Agent feedback — the reinforcement loop, reachable from an inbox.
 *
 * The recipient of an Ira digest rates one finding and says what should change.
 * The row lands in oem_agent_feedback with applied_to_prompt_version NULL, which
 * is exactly the queue foldGuidance() drains into the next prompt version. So a
 * reply from an executive's phone becomes a change to how the agent scans next
 * time, without anyone opening the console.
 *
 * WHAT THIS HANDLER DELIBERATELY DOES NOT DO: apply the guidance. It only queues
 * it. A human still reviews the folded diff and commits it through save_prompt —
 * an emailed click must never silently rewrite an agent's instructions.
 * ------------------------------------------------------------------------- */

/**
 * Why this answer cannot be accepted, or null.
 *
 * EXPORTED SO IT RUNS BEFORE THE TOKEN IS BURNED. Three of the five dispositions
 * ('not_an_issue', 'blocked', 'need_info') are meaningless without a sentence, and
 * the route used to consume the single-use token first and only then discover the
 * note was missing — telling the responder "your link still works" when it had just
 * been spent. Their answer was then unrecoverable from the inbox. The route now
 * calls this on the submitted form BEFORE consuming, so a missing note costs a
 * re-render and nothing else. handleAgentFeedback re-checks it as a backstop.
 */
export function feedbackInputProblem(signal: string, note: string): { title: string; message: string } | null {
    if (!isDisposition(signal)) {
        return { title: 'Unrecognised answer', message: 'That answer is not one this agent accepts.' };
    }
    const spec = DISPOSITION_SPECS[signal];
    if (spec.requiresNote && !note.trim()) {
        return {
            title: `"${spec.label}" needs a line of explanation`,
            message: `Nothing has been recorded yet, so this link still works. Add a sentence saying why, then submit again.`,
        };
    }
    return null;
}

/**
 * Where proof-of-completion files go. Same private bucket the mailed-in replies
 * use (backend/lib/ira/procurement/collectReplies.ts), so one finding's evidence
 * lives in one place whether it arrived by reply or through the digest form.
 */
const PROOF_BUCKET = 'ira-proof';

/** Same defaults the console applies, so an emailed verdict scores identically. */
const FEEDBACK_COINS: Record<string, number> = {
    praise: 10, reject: -5, roi_flag: -15, correction: 0,
};

async function handleAgentFeedback(
    t: EmailActionToken,
    remark: string,
    proof: ProofUpload | null,
): Promise<HandlerOutcome> {
    const payload = (t.payload ?? {}) as Record<string, unknown>;
    const agentKey = typeof payload.agent_key === 'string' ? payload.agent_key : '';
    const findingKey = typeof payload.finding_key === 'string' ? payload.finding_key : null;
    const findingTitle = typeof payload.finding_title === 'string' ? payload.finding_title : null;

    if (!agentKey || !findingKey) {
        return { ok: false, status: 400, title: 'Malformed link', message: 'This link is missing the finding it refers to.' };
    }

    /**
     * PERMISSION, RE-DERIVED FROM LIVE MEMBERSHIP — the thing every other handler
     * in this file does and this one did not.
     *
     * A feedback token is a 72-hour bearer credential. Without this, someone whose
     * membership was revoked yesterday could still stamp a disposition, close a
     * finding so the next scan stops raising it, and queue guidance that folds into
     * the agent's next prompt version — all after losing access to the org. The
     * other two handlers reach this via resolvePettyCashAccessForUser /
     * resolveAccountsAccessForUser; agent feedback has no such domain gate, so it
     * uses the membership check the digest's own API routes use.
     */
    if (!(await isOrgMember(t.organization_id, t.user_id))) return denied();

    // `remark` is "<disposition>|<note>". Split on the FIRST pipe only, so a note
    // that itself contains a pipe survives intact.
    const sep = remark.indexOf('|');
    const rawDisp = (sep >= 0 ? remark.slice(0, sep) : remark).trim();
    const note = (sep >= 0 ? remark.slice(sep + 1) : '').trim();

    // Backstop. The route checks this BEFORE burning the token; if it is reached
    // here the token is already spent, so the message must not promise otherwise.
    const problem = feedbackInputProblem(rawDisp, note);
    if (problem) return { ok: false, status: 400, ...problem };
    // feedbackInputProblem returns non-null for anything that is not a Disposition.
    const disposition = rawDisp as Disposition;
    const spec = DISPOSITION_SPECS[disposition];

    // --- 1. UPSERT the finding and stamp the disposition ---------------------
    const { data: finding, error: findErr } = await supabaseAdmin
        .from('oem_agent_findings')
        .update({
            disposition,
            disposition_note: note || null,
            dispositioned_by: t.user_id,
            dispositioned_at: new Date().toISOString(),
        })
        .eq('organization_id', t.organization_id)
        .eq('agent_key', agentKey)
        .eq('finding_key', findingKey)
        .select('id')
        .maybeSingle();

    if (findErr) {
        const missing = /does not exist|schema cache|42P01/i.test(`${findErr.message} ${findErr.details ?? ''}`);
        return {
            ok: false, status: missing ? 503 : 500,
            title: missing ? 'Not set up yet' : 'Could not record that',
            message: missing
                ? 'The findings store is not provisioned on this deployment, so nothing was saved. Run migration 20260905000001_agent_findings.'
                : 'Your answer could not be saved. Please close this from the console instead.',
        };
    }
    if (!finding) {
        return { ok: false, status: 404, title: 'Finding not found', message: 'This finding is no longer on the board. It may already have been closed.' };
    }

    // --- 2. Store the proof, if one came with it ----------------------------
    // The PRIVATE 'ira-proof' bucket — the one this agent's mailed-in proofs already
    // land in (collectReplies.ts), provisioned by migration 20260908000001.
    //
    // This said 'po_documents' and that bucket DOES NOT EXIST in this project: only
    // the po_documents TABLE does. Every attachment submitted through this form would
    // have failed to upload, silently, and the responder would be told to "attach it
    // from the console". The PATH is stored; readers sign it.
    let proofPath: string | null = null;
    if (proof) {
        const safe = proof.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
        const path = `${t.organization_id}/findings/${finding.id}/${Date.now()}_${safe}`;
        const { error: upErr } = await supabaseAdmin.storage
            .from(PROOF_BUCKET)
            .upload(path, proof.bytes, { contentType: proof.type, upsert: false });
        // A failed upload must NOT lose the disposition — the answer matters more
        // than the attachment, and the responder is told which happened.
        if (!upErr) proofPath = path;
    }

    // --- 3. Audit trail -----------------------------------------------------
    await supabaseAdmin.from('oem_agent_finding_events').insert({
        finding_id: finding.id,
        organization_id: t.organization_id,
        disposition,
        note: note || null,
        source: 'email',
        proof_path: proofPath,
        proof_name: proof?.name ?? null,
        proof_type: proof?.type ?? null,
        proof_bytes: proof?.bytes.length ?? null,
        created_by: t.user_id,
    });

    // --- 4. THE TRAINING SIGNAL, derived — nobody was asked to rate anything --
    const signal = spec.signal;
    if (signal) {
        await supabaseAdmin.from('oem_agent_feedback').insert({
            organization_id: t.organization_id,
            agent_key: agentKey,
            run_id: typeof payload.run_id === 'string' ? payload.run_id : null,
            signal,
            coins: FEEDBACK_COINS[signal] ?? 0,
            roi_flag: false,
            reason: findingTitle ? `${spec.label} — ${findingTitle}` : spec.label,
            // Prefixed so a folded prompt can cite which finding drove the change.
            guidance: note ? `[${findingKey}] ${note}` : null,
            applied_to_prompt_version: null, // pending — foldGuidance() drains this
            created_by: t.user_id,
        });
    }

    const proofMsg = proof
        ? (proofPath ? ' Your file was stored against this finding.' : ' Your note was saved, but the file upload failed — please attach it from the console.')
        : '';

    return {
        ok: true,
        title: spec.closes ? 'Closed — thank you' : `Marked "${spec.label}"`,
        message: (spec.closes
            ? 'The next scan will not raise this again.'
            : 'It stays on the list, and escalation stops.')
            + (note ? ' Your note is queued for the agent\u2019s next prompt version.' : '')
            + proofMsg,
    };
}
