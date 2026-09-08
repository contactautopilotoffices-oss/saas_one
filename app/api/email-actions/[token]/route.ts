import { NextRequest, NextResponse } from 'next/server';
import { peekEmailActionToken, consumeEmailActionToken, recordTokenResult, revokeTokensForEntity } from '@/backend/lib/emailActions/tokens';
import { handleEmailAction, isSupportedEntity, needsInput, feedbackInputProblem, type ProofUpload } from '@/backend/lib/emailActions/handlers';
import { actionPage } from '@/backend/lib/emailActions/page';
import { DISPOSITION_SPECS, DISPOSITIONS as DISPOSITION_ORDER } from '@/backend/lib/ira/procurement/disposition';
import { notifyPaymentAfterEmailAction } from '@/backend/lib/accounts/notify';

/**
 * One-click actions from an email body.
 *
 * WHY GET DOES NOT MUTATE
 * Outlook Safe Links, Gmail's prefetcher and corporate mail gateways fetch every URL in a
 * message. If the action happened on GET, a scanner would approve requests before a human
 * ever opened the mail. GET therefore only renders a page that auto-submits a POST — the
 * recipient still clicks exactly once, and crawlers (which do not run the submit) trigger
 * nothing.
 *
 * This route owns ONLY the token lifecycle and the response shell. Domain logic lives in
 * backend/lib/emailActions/handlers.ts, which re-derives permissions from live memberships
 * and defers to each domain's shared state machine.
 */

export const dynamic = 'force-dynamic';

const clientIp = (request: NextRequest) =>
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() || null;

const html = (body: string, status = 200) =>
    new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

// GET — render only. Never mutates.
/**
 * GET NEVER MUTATES. It renders either:
 *   · the auto-submitting 'confirming' page — a decision link, where the click in
 *     the mail client IS the consent; or
 *   · a form — a link that must collect what the human types before acting.
 *
 * Choosing between them needs the entity type, so this PEEKS the token (a read,
 * no burn). Peek failure is not reported as an error here: an invalid or spent
 * token still renders the confirming page, and the POST returns the real 410. That
 * keeps GET from becoming an oracle that distinguishes live tokens from dead ones.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const peek = await peekEmailActionToken(token);
    if (peek && needsInput(peek.entityType)) return html(feedbackForm(peek, peek.action, '', null));
    return html(actionPage({ kind: 'confirming', token }));
}

type Peeked = { entityType: string; action: string; payload: Record<string, unknown> };

/**
 * The one place the feedback form is built, because it is rendered twice: on GET,
 * and again on POST when the submitted answer needs a note it did not have. The
 * second render must carry back what the responder already typed — losing their
 * paragraph and making them start over is how an answer stops being given at all.
 */
function feedbackForm(peek: Peeked, signal: string, note: string, error: { title: string; message: string } | null): string {
    return actionPage({
        kind: 'feedback',
        title: 'Close this line',
        // Name the actual line. The page used to show identical boilerplate on
        // every token, so a responder could not tell WHICH finding they were
        // closing — the one thing they most needed to know.
        context: (() => {
            const t = typeof peek.payload.finding_title === 'string' ? peek.payload.finding_title : null;
            const amt = typeof peek.payload.finding_amount === 'number' ? peek.payload.finding_amount : null;
            if (!t) return 'Closing this finding stops the next scan raising it.';
            return amt !== null
                ? `${t} \u2014 \u20B9${Math.round(amt).toLocaleString('en-IN')}`
                : t;
        })(),
        signal,
        note,
        error,
        // The vocabulary lives in the domain, not in the page renderer.
        options: DISPOSITION_ORDER.map((d) => ({
            v: d,
            label: DISPOSITION_SPECS[d].label,
            hint: DISPOSITION_SPECS[d].hint,
        })),
    });
}

/** Everything the responder submitted. Reading the body does not touch the token. */
async function readFeedbackForm(request: NextRequest): Promise<{ signal: string; guidance: string; proof: ProofUpload | null }> {
    try {
        const form = await request.formData();
        const signal = String(form.get('signal') ?? '').trim();
        const guidance = String(form.get('guidance') ?? '').trim().slice(0, 4000);

        let proof: ProofUpload | null = null;
        const file = form.get('proof');
        // 10MB is the file_size_limit on the private 'ira-proof' bucket
        // (migration 20260908000001). This read 15MB, so a 12MB attachment passed
        // here and was then rejected by storage — the disposition saved, the file
        // silently lost. A bigger file is rejected up front instead.
        if (file && typeof file === 'object' && 'arrayBuffer' in file) {
            const f = file as File;
            if (f.size > 0 && f.size <= 10 * 1024 * 1024) {
                proof = {
                    name: f.name || 'proof',
                    type: f.type || 'application/octet-stream',
                    bytes: Buffer.from(await f.arrayBuffer()),
                };
            }
        }
        return { signal, guidance, proof };
    } catch {
        return { signal: '', guidance: '', proof: null };
    }
}

// POST — claim the token, then apply the action.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;

    /**
     * READ AND VALIDATE THE ANSWER BEFORE THE LINK IS BURNED.
     *
     * consumeEmailActionToken is a one-way door: it is the atomic single-use claim.
     * This used to run FIRST, so a responder who tapped "Not an issue" and submitted
     * without a reason — three of the five dispositions require one — spent their
     * token on a validation error, and were then told "your link still works". It
     * did not. Their answer was unrecoverable from the inbox and the finding stayed
     * open with nobody the wiser.
     *
     * Peeking is a read, and parsing the body is a read; neither mutates. So the
     * form is checked while the token is still live, and a missing note costs a
     * re-render with their text intact instead of the whole link.
     */
    const peek = await peekEmailActionToken(token);
    let submitted: { signal: string; guidance: string; proof: ProofUpload | null } | null = null;
    if (peek && needsInput(peek.entityType)) {
        submitted = await readFeedbackForm(request);
        const problem = feedbackInputProblem(submitted.signal, submitted.guidance);
        if (problem) {
            // Token deliberately untouched — they can submit again from this page.
            return html(feedbackForm(peek, submitted.signal || peek.action, submitted.guidance, problem), 400);
        }
    }

    const claim = await consumeEmailActionToken(token);
    if (!claim.ok) {
        return html(
            actionPage({
                kind: 'error',
                title: claim.reason === 'used_or_expired' ? 'This link has already been used' : 'This link is not valid',
                message: claim.reason === 'used_or_expired'
                    ? 'It may have expired, or the request was already actioned — by you or another approver. Open the app to see the current status.'
                    : 'The link appears to be incomplete or was copied incorrectly. Please use the button in the original email.',
            }),
            410,
        );
    }

    const { token: t } = claim;
    const ip = clientIp(request);

    if (!isSupportedEntity(t.entity_type)) {
        await recordTokenResult(t.id, `unsupported entity ${t.entity_type}`, ip);
        return html(actionPage({ kind: 'error', title: 'Unsupported action', message: 'This link refers to something this server cannot action.' }), 400);
    }

    // A form-bearing link carries its answer in the POST body, not in the token
    // payload — the payload was written when the email was SENT and cannot contain
    // what the recipient typed afterwards. It was read and validated above.
    const remark = submitted
        ? `${submitted.signal}|${submitted.guidance}`
        : String((t.payload as Record<string, unknown> | null)?.remark ?? 'Actioned from email');
    const outcome = await handleEmailAction(t, remark, submitted?.proof ?? null);

    if (!outcome.ok) {
        await recordTokenResult(t.id, outcome.message, ip);
        return html(
            actionPage({
                kind: 'error', title: outcome.title, message: outcome.message,
                link: appLink(t.organization_id, t.entity_type), linkLabel: appLinkLabel(t.entity_type),
            }),
            outcome.status,
        );
    }

    // Other recipients' links for this entity are now stale — revoke them so they get a
    // clear "already actioned" rather than a confusing state error.
    await Promise.all([
        recordTokenResult(t.id, 'ok', ip),
        revokeTokensForEntity(t.entity_type, t.entity_id, t.id),
    ]);

    // Petty cash fires its own intimation inside the handler. A payment has no notify
    // hook there, so it is announced from the row that was just written.
    if (t.entity_type === 'po_payment') {
        notifyPaymentAfterEmailAction(t.organization_id, t.entity_id, remark).catch(() => {});
    }

    return html(actionPage({
        kind: 'success',
        title: outcome.title,
        message: outcome.message,
        link: appLink(t.organization_id, t.entity_type),
        linkLabel: appLinkLabel(t.entity_type),
    }));
}

// Both helpers were binary ternaries on petty_cash_request, so a new entity type
// silently inherited the Payment Tracker. Someone closing an Ira finding was shown
// a primary button reading 'Open Payment Tracker' pointing at /accounts. Explicit
// per-entity mapping, with a neutral default rather than a wrong one.
const SURFACE: Record<string, { label: string; segment: string }> = {
    petty_cash_request: { label: 'Open Petty Cash', segment: 'petty-cash' },
    po_payment: { label: 'Open Payment Tracker', segment: 'accounts' },
    agent_feedback: { label: 'Open Agent Console', segment: 'dashboard?tab=agent_console' },
};

const appLinkLabel = (entityType: string): string => SURFACE[entityType]?.label ?? 'Open Autopilot';

// Deep-link back into the surface the entity actually lives on — a petty-cash approver
// landing on the Payment Tracker would be a dead end.
function appLink(orgId: string, entityType: string): string {
    const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
    if (!base) return '';
    const segment = SURFACE[entityType]?.segment;
    return segment ? `${base}/${orgId}/${segment}` : `${base}/${orgId}`;
}
