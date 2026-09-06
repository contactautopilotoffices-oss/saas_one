/**
 * CONNECT A MAILBOX — step 2 of 2. Zoho sends the person back here.
 * -----------------------------------------------------------------------------
 * Exchanges the one-time code for a refresh token, asks Zoho which addresses
 * that grant can actually reach, and stores it against the organisation.
 *
 * The addresses matter as much as the token: an agent points at an alias, and
 * knowing every alias on the account is what lets the poller resolve which
 * connection can read it — without anyone configuring account ids by hand.
 *
 * Returns a small HTML page rather than JSON, because a human lands here from
 * a browser redirect and should be told what happened in words.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { saveMailAccount } from '@/backend/lib/mail/accounts';
import { callbackUrl } from '@/backend/lib/mail/oauth';

export const dynamic = 'force-dynamic';

function page(title: string, body: string, tone: 'ok' | 'bad' = 'ok'): NextResponse {
    const accent = tone === 'ok' ? '#0B6E5F' : '#B0442E';
    return new NextResponse(
        `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;background:#FBFBF9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#16181C">
  <div style="max-width:560px;margin:12vh auto;padding:0 24px">
    <div style="border:1px solid #D3D2CB;border-radius:6px;background:#fff;padding:26px 28px">
      <div style="width:9px;height:9px;border-radius:50%;background:${accent};margin-bottom:14px"></div>
      <h1 style="margin:0 0 10px;font-size:21px;letter-spacing:-0.01em">${title}</h1>
      <div style="font-size:14.5px;line-height:1.65;color:#4A4E55">${body}</div>
      <div style="margin-top:20px;font-size:12.5px;color:#797E86">You can close this tab and go back to the Agent Console.</div>
    </div>
  </div>
</body></html>`,
        { status: tone === 'ok' ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
}

export async function GET(request: NextRequest) {
    const sp = new URL(request.url).searchParams;
    const code = sp.get('code');
    const state = sp.get('state');
    const denied = sp.get('error');

    if (denied) return page('Not connected', `Zoho reported: <b>${denied}</b>. Nothing was saved.`, 'bad');
    if (!code || !state) return page('Not connected', 'Zoho did not return a code. Nothing was saved.', 'bad');

    // Single-use state. Consuming it first closes the replay window.
    const { data: st } = await supabaseAdmin
        .from('oem_mail_oauth_state').select('organization_id, created_by, consumed_at').eq('state', state).maybeSingle();
    if (!st) return page('Not connected', 'That connection link is not one we issued. Start again from the console.', 'bad');
    if (st.consumed_at) return page('Already used', 'That connection link has already been used. Start again if you need to reconnect.', 'bad');
    // Atomic: only the request that flips consumed_at from NULL proceeds. The
    // browser hit this callback three times with the same state, and a check
    // followed by a write would have let more than one through.
    const { data: claimed } = await supabaseAdmin
        .from('oem_mail_oauth_state')
        .update({ consumed_at: new Date().toISOString() })
        .eq('state', state).is('consumed_at', null)
        .select('state');
    if (!claimed?.length) {
        return page('Already used', 'That connection link has already been used. Start again from Connect a mailbox if you need to reconnect.', 'bad');
    }

    const clientId = process.env.ZOHO_MAIL_APP_CLIENT_ID ?? '';
    const clientSecret = process.env.ZOHO_MAIL_APP_CLIENT_SECRET ?? '';
    const dc = (process.env.ZOHO_MAIL_APP_DC || process.env.ZOHO_MAIL_DC || 'com').trim();

    /**
     * 1. code -> refresh token.
     *
     * Three things this gets right that the first version did not:
     *
     *  · THE SERVER ZOHO NAMED. The consent redirect carries `accounts-server`,
     *    which is the authoritative token endpoint for THIS user's data centre.
     *    Guessing it from an env var works until someone's account lives
     *    elsewhere, and then the exchange quietly hits the wrong region.
     *
     *  · A FORM BODY, not a query string. The authorization_code grant is
     *    posted form-encoded. Sent as query parameters, Zoho answered with an
     *    HTML page.
     *
     *  · READ AS TEXT FIRST. `await r.json()` on that HTML threw
     *    "Unexpected token '<'", which told the operator nothing about what
     *    had gone wrong. Now a non-JSON answer is reported as what it is.
     */
    const accountsServer = (sp.get('accounts-server') ?? '').trim().replace(/\/+$/, '')
        || `https://accounts.zoho.${dc}`;

    const form = new URLSearchParams({
        grant_type: 'authorization_code', code,
        client_id: clientId, client_secret: clientSecret, redirect_uri: callbackUrl(request.url),
    });
    const tokenEndpoint = `${accountsServer}/oauth/v2/token`;
    console.log('[mail oauth] exchanging code', {
        tokenEndpoint,
        redirect_uri: callbackUrl(request.url),
        content_type: 'application/x-www-form-urlencoded',
        code_prefix: code.slice(0, 12) + '…',
        client_id_prefix: clientId.slice(0, 14) + '…',
        accounts_server_from_zoho: sp.get('accounts-server') ?? '(not sent)',
        location_from_zoho: sp.get('location') ?? '(not sent)',
    });

    let tok: { access_token?: string; refresh_token?: string; scope?: string; error?: string };
    try {
        const r = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: form.toString(),
        });
        let text = await r.text();

        /**
         * Zoho's token endpoint accepts the grant either as a form body or as
         * query parameters, and which one it will answer with JSON has proved
         * inconsistent in practice: a correctly form-encoded POST with a valid
         * fresh code, the right redirect and the right region still came back
         * as an HTML error page. So if the first shape does not yield JSON, the
         * other is tried once before giving up.
         *
         * The code is single-use, but a request Zoho refused without reading
         * does not spend it — and if it did, the retry simply fails the same
         * way. Not trying leaves the operator with an error and no connection.
         */
        if (/^\s*</.test(text)) {
            console.warn('[mail oauth] form body gave HTML; retrying as query parameters');
            const r2 = await fetch(`${tokenEndpoint}?${form.toString()}`, {
                method: 'POST', headers: { Accept: 'application/json' },
            });
            const t2 = await r2.text();
            if (!/^\s*</.test(t2)) text = t2;
            else console.error('[mail oauth] query form ALSO gave HTML, status', r2.status);
        }

        try {
            tok = JSON.parse(text);
        } catch {
            const looksLikeHtml = /^\s*</.test(text);
            console.error('[mail oauth] NON-JSON from', tokenEndpoint, 'status', r.status);
            // The readable sentence, not 600 characters of stylesheet.
            const said = text
                .replace(/<script[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            console.error('[mail oauth] Zoho said:', said.slice(0, 300));
            /**
             * Zoho answers EVERY token error with the same generic HTML page —
             * verified by posting a deliberately invalid code and getting this
             * exact response. So the page does not tell us which error it was,
             * and claiming it does would be a guess dressed as a diagnosis.
             *
             * By far the most common cause is the first one listed: the
             * authorisation code is single-use and lives about a minute.
             */
            return page('Not connected', looksLikeHtml
                ? `Zoho rejected the exchange (HTTP ${r.status}) and returned a generic error page, which does not say why. In order of likelihood:
                   <ol style="margin:10px 0 0;padding-left:20px;line-height:1.7">
                     <li>The code expired or was already used — they last about a minute, and reloading this tab spends it. <b>Start again from Connect a mailbox</b> and do not reload.</li>
                     <li>The redirect URL differs between the two steps. We sent <b>${callbackUrl(request.url)}</b> — it must be registered on the application exactly, including http vs https and the port.</li>
                     <li>The client is not enabled for your data centre in the application's Multi-DC settings.</li>
                   </ol>
                   The server log line beginning <b>[mail oauth]</b> records exactly what was sent.`
                : `Zoho sent an answer we could not read (HTTP ${r.status}). Nothing was saved.`, 'bad');
        }
    } catch (e) {
        return page('Not connected', `Could not reach Zoho: ${e instanceof Error ? e.message : e}`, 'bad');
    }
    if (!tok?.refresh_token) {
        const why = tok?.error === 'invalid_code'
            ? 'the code had already been used or had expired — they last only a couple of minutes'
            : tok?.access_token
                ? 'Zoho returned a temporary token but no refresh token, so the connection would have lasted an hour'
                : `Zoho said: ${tok?.error ?? 'unknown error'}`;
        return page('Not connected', `No lasting connection was created, because ${why}. Nothing was saved — try again from the console.`, 'bad');
    }

    // 2. which addresses can this grant actually read?
    let address = ''; let addresses: string[] = []; let accountId: string | null = null;
    try {
        const mailHost = accountsServer.replace('accounts.zoho.', 'mail.zoho.');
        const r = await fetch(`${mailHost}/api/accounts`, {
            headers: { Authorization: `Zoho-oauthtoken ${tok.access_token}` },
        });
        const d = await r.json();
        const accounts = (d?.data ?? []) as Array<{ accountId?: string; primaryEmailAddress?: string; emailAddress?: Array<{ mailId?: string }> }>;
        const first = accounts[0];
        address = String(first?.primaryEmailAddress ?? '').toLowerCase();
        accountId = first?.accountId ? String(first.accountId) : null;
        for (const a of accounts) {
            if (a.primaryEmailAddress) addresses.push(String(a.primaryEmailAddress).toLowerCase());
            for (const e of a.emailAddress ?? []) if (e?.mailId) addresses.push(String(e.mailId).toLowerCase());
        }
        addresses = [...new Set(addresses)];
    } catch { /* fall through to the check below */ }

    if (!address) {
        return page('Not connected', 'The connection worked but Zoho listed no mailbox for it, so there is nothing to read. Nothing was saved.', 'bad');
    }

    const saved = await saveMailAccount({
        orgId: String(st.organization_id), address, addresses, zohoAccountId: accountId,
        refreshToken: tok.refresh_token,
        dc: (accountsServer.match(/accounts\.zoho\.([a-z.]+)$/)?.[1] ?? dc),
        scopes: tok.scope ?? null,
        connectedBy: st.created_by ? String(st.created_by) : null,
    });
    if (!saved.ok) {
        const hint = /relation|does not exist/i.test(saved.error ?? '')
            ? ' Apply supabase/migrations/20260907000003_mail_accounts.sql and connect again.'
            : /MAIL_TOKEN_KEY/.test(saved.error ?? '')
                ? ' Set MAIL_TOKEN_KEY on the server first — the token is encrypted before it is stored.'
                : '';
        return page('Not connected', `The mailbox answered, but it could not be saved: ${saved.error}.${hint}`, 'bad');
    }

    const others = addresses.filter((a) => a !== address);
    return page('Mailbox connected', `
      <b>${address}</b> is connected. An agent can now read replies here.
      ${others.length ? `<div style="margin-top:10px">It also answers to ${others.map((a) => `<b>${a}</b>`).join(', ')} — point an agent at any of these and it will work.</div>` : ''}
      <div style="margin-top:12px">Read-only: this can list and read mail, and cannot send or delete. Revoke it any time from your Zoho account.</div>`);
}
