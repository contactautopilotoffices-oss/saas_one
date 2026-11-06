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

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)).slice(0, 300);
}

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
        // Extra check of the client before approving. Supabase may not answer this lookup a second
        // time (the consent page already made it), so a failed lookup does not stop the approval:
        // the redirect it returns is checked below before the browser is sent anywhere, and the
        // consent page never shows Allow for a client that fails the redirect policy.
        const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (error) console.warn('[oauth/decision] details re-check failed, relying on the redirect check:', error.message);
        if (details && 'authorization_id' in details && !isAllowedRedirect(details.redirect_uri)) effective = 'deny';
    }

    const result = effective === 'approve'
        ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data?.redirect_url) {
        const reason = result.error?.message || 'no redirect returned';
        console.error(`[oauth/decision] ${effective} failed:`, reason);
        return page(`The FMS could not record your choice (${escapeHtml(reason)}). Start the connection again from your assistant.`, 400);
    }
    if (!isAllowedRedirect(result.data.redirect_url)) {
        return page(effective === 'approve' ? 'Connection refused: this app is not an approved assistant.' : 'Access denied. You can close this window.', 200);
    }
    return NextResponse.redirect(result.data.redirect_url, 303);
}
