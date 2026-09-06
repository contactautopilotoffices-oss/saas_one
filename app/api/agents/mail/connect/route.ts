/**
 * CONNECT A MAILBOX — step 1 of 2. Send the person to Zoho to consent.
 * -----------------------------------------------------------------------------
 * ONE Zoho server-based application serves the whole organisation. Each person
 * consents for their OWN account, so linking a new agent to a new inbox is a
 * button, not a Self Client minted by hand and three secrets pasted into a
 * server file.
 *
 * What the operator does once, ever:
 *   api-console.zoho.com → Add Client → SERVER-BASED APPLICATION
 *   Redirect URI: <app>/api/agents/mail/callback
 *   then ZOHO_MAIL_APP_CLIENT_ID / ZOHO_MAIL_APP_CLIENT_SECRET in the env.
 *
 * Everything after that is this route.
 *
 * SECURITY. `state` is a single-use random value stored server-side with the
 * org and the user. Without it a callback could be replayed, or a consent
 * obtained for one organisation could be redeemed against another.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isOrgMember } from '@/backend/lib/ira/procurement/guard';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only mail scopes. Sending goes through SMTP, so no send scope is asked for. */
export const ZOHO_MAIL_SCOPES = [
    'ZohoMail.messages.READ',
    'ZohoMail.accounts.READ',
    'ZohoMail.folders.READ',
].join(',');

export function callbackUrl(): string {
    const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '').replace(/^"|"$/g, '');
    return `${base}/api/agents/mail/callback`;
}

export async function GET(request: NextRequest) {
    const sp = new URL(request.url).searchParams;
    const orgId = sp.get('orgId') ?? '';
    if (!UUID_RE.test(orgId)) return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await isOrgMember(orgId, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const clientId = process.env.ZOHO_MAIL_APP_CLIENT_ID;
    if (!clientId || !process.env.ZOHO_MAIL_APP_CLIENT_SECRET) {
        return NextResponse.json({
            error: 'No Zoho mail application is configured on this deployment.',
            fix: 'Create ONE server-based application at api-console.zoho.com with redirect URI ' +
                 `${callbackUrl()} and set ZOHO_MAIL_APP_CLIENT_ID and ZOHO_MAIL_APP_CLIENT_SECRET. ` +
                 'It is a one-time step; after it, every mailbox connects from the console.',
        }, { status: 503 });
    }
    if (!callbackUrl().startsWith('http')) {
        return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL is not set, so the Zoho redirect cannot be built.' }, { status: 503 });
    }

    const state = crypto.randomBytes(24).toString('base64url');
    const { error } = await supabaseAdmin.from('oem_mail_oauth_state').insert({
        state, organization_id: orgId, created_by: user.id, redirect_to: sp.get('returnTo') ?? null,
    });
    if (error) {
        return NextResponse.json({
            error: `Could not start the connection: ${error.message}`,
            hint: 'If this mentions a missing relation, apply supabase/migrations/20260907000003_mail_accounts.sql.',
        }, { status: 500 });
    }

    const dc = (process.env.ZOHO_MAIL_APP_DC || process.env.ZOHO_MAIL_DC || 'com').trim();
    const url = new URL(`https://accounts.zoho.${dc}/oauth/v2/auth`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', ZOHO_MAIL_SCOPES);
    url.searchParams.set('redirect_uri', callbackUrl());
    // offline + consent, or Zoho returns an access token with no refresh token
    // and the connection silently lasts one hour.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);

    return NextResponse.redirect(url.toString());
}
