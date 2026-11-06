import { redirect } from 'next/navigation';
import { ShieldCheck, Eye, Ban, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/server';
import { isAllowedRedirect } from '@/backend/lib/mcp/redirectPolicy';
import ConsentForm from './ConsentForm';

/**
 * /oauth/consent — the FMS "Allow this assistant to access your account?" screen.
 *
 * Supabase Auth's OAuth server sends the user here (Authentication > OAuth Server >
 * Authorization Path) with ?authorization_id=. The user must be signed in; the approve and deny
 * buttons post to /api/oauth/decision.
 */
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,200}$/;

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl">{children}</div>
        </div>
    );
}

function Problem({ title, detail }: { title: string; detail: string }) {
    return (
        <Shell>
            <h1 className="text-lg font-semibold text-white">{title}</h1>
            <p className="mt-2 text-sm text-slate-300">{detail}</p>
        </Shell>
    );
}

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
    const authorizationId = (await searchParams).authorization_id || '';
    if (!ID.test(authorizationId)) {
        return <Problem title="This link is not valid" detail="Start the connection again from your assistant." />;
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        redirect(`/login?redirect=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);
    }

    const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error || !details) {
        const reason = error?.message || 'no details returned';
        console.error('[oauth/consent] getAuthorizationDetails failed:', reason);
        return <Problem title="This request could not be opened" detail={`Start the connection again from your assistant. (Reason: ${reason.slice(0, 200)})`} />;
    }

    // Already approved earlier: Supabase hands back the redirect straight away. Still check where it goes.
    if (!('authorization_id' in details)) {
        if (isAllowedRedirect(details.redirect_url)) redirect(details.redirect_url);
        return <Problem title="Connection refused" detail="This app is not an approved assistant for the FMS." />;
    }

    const allowed = isAllowedRedirect(details.redirect_uri);
    let host = '';
    try {
        host = new URL(details.redirect_uri).host;
    } catch {
        host = 'an unknown address';
    }
    const clientName = details.client?.name || 'An app';

    return (
        <Shell>
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15">
                    <ShieldCheck className="h-5 w-5 text-teal-400" />
                </div>
                <div>
                    <h1 className="text-lg font-semibold text-white">Connect {clientName} to the FMS?</h1>
                    <p className="text-xs text-slate-400">Signed in as {user.email}</p>
                </div>
            </div>

            {allowed ? (
                <>
                    <ul className="mt-5 space-y-3 text-sm text-slate-200">
                        <li className="flex gap-2">
                            <Eye className="mt-0.5 h-4 w-4 shrink-0 text-teal-400" />
                            <span>It can <strong>read</strong> what you can see in the FMS: your properties, tickets, assets, leads and the rest, as you. Nothing more than your own access.</span>
                        </li>
                        <li className="flex gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-400" />
                            <span>It can <strong>raise tickets</strong> and <strong>book or cancel meeting rooms</strong> for you, but only after it shows you the details and you say yes. It follows the same rules as the app (credits, room availability).</span>
                        </li>
                        <li className="flex gap-2">
                            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-teal-400" />
                            <span>Through this connection it <strong>cannot</strong> approve, change or delete anything else.</span>
                        </li>
                    </ul>
                    <p className="mt-4 text-xs text-slate-400">
                        After you allow it, you will go back to <span className="text-slate-200">{host}</span>. Every request it makes is logged.
                        FMS data you ask about is sent to that assistant.
                    </p>
                </>
            ) : (
                <p className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                    This app wants to send you to <strong>{host}</strong>, which is not an approved assistant for the FMS.
                    It cannot be connected. If you did not start this, someone may be trying to get access to your account: choose Deny.
                </p>
            )}

            <ConsentForm authorizationId={authorizationId} allowed={allowed} />
        </Shell>
    );
}
