/**
 * CONNECT ZOHO TASKS — step 2 of 2. Zoho sends the person back here.
 * -----------------------------------------------------------------------------
 * Consumes the single-use state, exchanges the code for a refresh token, stores it
 * encrypted against the person, and runs a first import so their tasks appear at once.
 *
 * Returns a small HTML page rather than JSON: a human lands here from a browser redirect.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskManagerAuth } from '../../_shared/adminGuard';
import { ZohoTaskSync, zohoTaskCallbackUrl } from '@/task-manager/ZohoTaskSync';

export const dynamic = 'force-dynamic';

const STATE_TTL_MS = 15 * 60_000;

function esc(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

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
      <div style="margin-top:20px;font-size:12.5px;color:#797E86">You can close this tab and go back to the Task Manager.</div>
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

    if (denied) return page('Not connected', `Zoho reported: <b>${esc(denied)}</b>. Nothing was saved.`, 'bad');
    if (!code || !state) return page('Not connected', 'Zoho did not return a code. Nothing was saved.', 'bad');

    const { data: st } = await supabaseAdmin
        .from('task_zoho_oauth_state').select('user_id, created_at, consumed_at').eq('state', state).maybeSingle();
    if (!st) return page('Not connected', 'That connection link is not one we issued. Start again from the Task Manager.', 'bad');
    if (st.consumed_at) return page('Already used', 'That connection link has already been used. Start again if you need to reconnect.', 'bad');
    if (Date.now() - Date.parse(String(st.created_at)) > STATE_TTL_MS) {
        return page('Link expired', 'That connection link is more than 15 minutes old. Start again from the Task Manager.', 'bad');
    }

    // The browser that finishes the consent must be the person who started it.
    const user = await TaskManagerAuth.currentUser();
    if (!user || user.id !== String(st.user_id)) {
        return page('Not connected', 'Please finish the connection while signed in as the same person who started it.', 'bad');
    }

    // Atomic single use: only the request that flips consumed_at from NULL proceeds.
    const { data: claimed } = await supabaseAdmin
        .from('task_zoho_oauth_state')
        .update({ consumed_at: new Date().toISOString() })
        .eq('state', state).is('consumed_at', null)
        .select('state');
    if (!claimed?.length) return page('Already used', 'That connection link has already been used.', 'bad');

    const clientId = process.env.ZOHO_MAIL_APP_CLIENT_ID ?? '';
    const clientSecret = process.env.ZOHO_MAIL_APP_CLIENT_SECRET ?? '';
    const dc = (process.env.ZOHO_MAIL_APP_DC || process.env.ZOHO_MAIL_DC || 'com').trim();
    // Zoho names the token server for THIS user's data centre; trust it over the env guess.
    const accountsServer = (sp.get('accounts-server') ?? '').trim().replace(/\/+$/, '') || `https://accounts.zoho.${dc}`;
    if (!/^https:\/\/accounts\.zoho\.[a-z.]+$/.test(accountsServer)) {
        return page('Not connected', 'Zoho named an unexpected sign-in server. Nothing was saved.', 'bad');
    }

    const form = new URLSearchParams({
        grant_type: 'authorization_code', code,
        client_id: clientId, client_secret: clientSecret, redirect_uri: zohoTaskCallbackUrl(request.url),
    });
    const tokenEndpoint = `${accountsServer}/oauth/v2/token`;

    let tok: { refresh_token?: string; access_token?: string; scope?: string; error?: string } | null = null;
    try {
        const r = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: form.toString(),
        });
        let text = await r.text();
        // Same fallback the mailbox callback needed: Zoho sometimes answers the form body with HTML.
        if (/^\s*</.test(text)) {
            const r2 = await fetch(`${tokenEndpoint}?${form.toString()}`, { method: 'POST', headers: { Accept: 'application/json' } });
            const t2 = await r2.text();
            if (!/^\s*</.test(t2)) text = t2;
        }
        try { tok = JSON.parse(text); } catch { tok = null; }
    } catch (e) {
        return page('Not connected', `Could not reach Zoho: ${esc(e instanceof Error ? e.message : String(e))}`, 'bad');
    }

    if (!tok?.refresh_token) {
        const why = !tok
            ? 'Zoho returned an error page. Most often the code expired (they last about a minute) or the redirect URL is not registered on the Zoho application.'
            : tok.error === 'invalid_code'
                ? 'the code had already been used or had expired.'
                : tok.access_token
                    ? 'Zoho returned a temporary token but no refresh token.'
                    : `Zoho said: ${esc(tok.error ?? 'unknown error')}.`;
        return page('Not connected', `No connection was created, because ${why} Nothing was saved — try again from the Task Manager.`, 'bad');
    }

    const saved = await ZohoTaskSync.saveConnection({
        userId: user.id,
        zohoEmail: null,
        refreshToken: tok.refresh_token,
        dc: accountsServer.match(/accounts\.zoho\.([a-z.]+)$/)?.[1] ?? dc,
        scopes: tok.scope ?? null,
    });
    if (!saved.ok) {
        const hint = /MAIL_TOKEN_KEY/.test(saved.error ?? '') ? ' MAIL_TOKEN_KEY must be set on the server.' : '';
        return page('Not connected', `Zoho answered, but the connection could not be saved: ${esc(saved.error ?? '')}.${hint}`, 'bad');
    }

    // First import now, so the person sees their tasks without waiting for the next 15-minute run.
    const first = await ZohoTaskSync.syncUser(user.id);
    const summary = first.ok
        ? `<b>${first.imported}</b> open task${first.imported === 1 ? '' : 's'} imported. New Zoho tasks will appear every 15 minutes.`
        : `Connected, but the first import failed: ${esc(first.error ?? 'unknown error')}. It will retry automatically every 15 minutes.`;

    return page('Zoho Tasks connected', `${summary}
      <div style="margin-top:12px">Read-only: this can see your Zoho tasks and cannot change or delete them. Disconnect any time from the Task Manager.</div>`);
}
