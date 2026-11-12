/** GET /api/po-approver/callback — Zoho sends the approver back here with a one-time code. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { saveApproverLink, verifyState } from '@/backend/lib/accounts/poApprover';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const sp = new URL(request.url).searchParams;
    const origin = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    const state = verifyState(sp.get('state'));
    const back = (org: string | null, qs: string) => NextResponse.redirect(`${origin}/org/${org ?? ''}/dashboard?tab=po-approvals&${qs}`);
    if (!state) return NextResponse.redirect(`${origin}/login?error=approver_link_expired`);

    // The person who finishes the link must be the person who started it.
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (!user || user.id !== state.user) return back(state.org, 'zoho=wrong_user');
    const code = sp.get('code');
    if (sp.get('error') || !code) return back(state.org, `zoho=denied`);

    const r = await saveApproverLink(state.org, state.user, code, `${origin}/api/po-approver/callback`);
    return r.ok ? back(state.org, 'zoho=connected') : back(state.org, `zoho=failed&why=${encodeURIComponent(r.error.slice(0, 120))}`);
}
