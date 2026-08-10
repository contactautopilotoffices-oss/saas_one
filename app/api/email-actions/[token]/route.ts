import { NextRequest, NextResponse } from 'next/server';
import { consumeEmailActionToken, recordTokenResult, revokeTokensForEntity } from '@/backend/lib/emailActions/tokens';
import { handleEmailAction, isSupportedEntity } from '@/backend/lib/emailActions/handlers';
import { actionPage } from '@/backend/lib/emailActions/page';
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
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    return html(actionPage({ kind: 'confirming', token }));
}

// POST — claim the token, then apply the action.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;

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

    const remark = String((t.payload as any)?.remark ?? 'Actioned from email');
    const outcome = await handleEmailAction(t, remark);

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

const appLinkLabel = (entityType: string): string =>
    entityType === 'petty_cash_request' ? 'Open Petty Cash' : 'Open Payment Tracker';

// Deep-link back into the surface the entity actually lives on — a petty-cash approver
// landing on the Payment Tracker would be a dead end.
function appLink(orgId: string, entityType: string): string {
    const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
    if (!base) return '';
    const segment = entityType === 'petty_cash_request' ? 'petty-cash' : 'accounts';
    return `${base}/${orgId}/${segment}`;
}
