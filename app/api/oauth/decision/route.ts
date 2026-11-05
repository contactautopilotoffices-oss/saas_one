import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { isAllowedRedirect } from '@/backend/lib/mcp/redirectPolicy';
import { publicOrigin } from '@/backend/lib/mcp/config';

/**
 * POST /api/oauth/decision — the Allow / Deny buttons of /oauth/consent.
 * Form fields: authorization_id, decision ("approve" | "deny").
 *
 * Guards: same-origin form posts only (CSRF), signed-in user only, and an approval is only
 * granted when the client's redirect goes to an approved assistant host (redirectPolicy).
 */
const ID = /^[A-Za-z0-9_-]{1,200}$/;

function page(message: string, status: number) {
    return new NextResponse(
        `<!doctype html><meta charset="utf-8"><title>FMS</title><body style="font-family:sans-serif;padding:2rem;background:#020617;color:#e2e8f0"><p>${message}</p></body>`,
        { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
    );
}

export async function POST(request: NextRequest) {
    const origin = publicOrigin(request.url);
    const reqOrigin = request.headers.get('origin');
    if (!origin || !reqOrigin || reqOrigin !== origin) {
        return page('This request did not come from the FMS consent screen.', 403);
    }

    const form = await request.formData().catch(() => null);
    const authorizationId = String(form?.get('authorization_id') || '');
    const decision = String(form?.get('decision') || '');
    if (!ID.test(authorizationId) || (decision !== 'approve' && decision !== 'deny')) {
        return page('This request is not valid. Start the connection again from your assistant.', 400);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return page('You are signed out. Sign in and start the connection again.', 401);

    let effective: 'approve' | 'deny' = decision;
    if (effective === 'approve') {
        // Re-check the client here: never trust that the page showed the button for a good reason.
        const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (error || !details) return page('This request has expired. Start the connection again from your assistant.', 400);
        if ('authorization_id' in details && !isAllowedRedirect(details.redirect_uri)) effective = 'deny';
    }

    const result = effective === 'approve'
        ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data?.redirect_url) {
        return page('The FMS could not record your choice. Start the connection again from your assistant.', 400);
    }
    if (!isAllowedRedirect(result.data.redirect_url)) {
        return page(effective === 'approve' ? 'Connection refused: this app is not an approved assistant.' : 'Access denied. You can close this window.', 200);
    }
    return NextResponse.redirect(result.data.redirect_url, 303);
}
