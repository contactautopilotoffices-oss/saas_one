import crypto from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { encryptToken, decryptToken } from '@/backend/lib/mail/accounts';
import { logPoActivity } from './activity';
import { zohoContext, zohoGet } from './poApproval';
import { handleApprovedPo } from './poApprovalWatch';
import { ROLE_GROUPS } from '@/backend/lib/aop/bountyRules';

/**
 * Approving or rejecting a PO from the FMS, as the person who clicked.
 *
 * Each approver links THEIR OWN Zoho Books account once (OAuth). Zoho therefore records the
 * decision under that person. The app's shared read-only login is never used to approve.
 *
 * Safety rules, each tested:
 *   - the PO must still be pending approval IN ZOHO right now (the queue can be stale);
 *   - nothing is marked approved here until Zoho confirms it;
 *   - a Zoho failure leaves everything as it was and the person sees Zoho's own words;
 *   - every attempt, including a refusal, is written to the append-only decision log.
 */

// Only an org super admin approves. (master_admin is the platform owner, not an org role.)
export const APPROVER_ROLES = ['org_super_admin'];
export const APPROVER_SCOPES = 'ZohoBooks.purchaseorders.READ,ZohoBooks.purchaseorders.UPDATE,ZohoBooks.settings.READ';

const dcOf = () => (process.env.ZOHO_BOOKS_DC || 'com').replace(/^\.+/, '').trim();
const clientId = () => process.env.ZOHO_APPROVER_CLIENT_ID || process.env.ZOHO_BOOKS_CLIENT_ID || '';
const clientSecret = () => process.env.ZOHO_APPROVER_CLIENT_SECRET || process.env.ZOHO_BOOKS_CLIENT_SECRET || '';

export const approverEnvReady = () => !!(clientId() && clientSecret());

/* ---------------------------------------------------------------- signed state (OAuth round trip) */

const stateKey = () => crypto.createHash('sha256').update(`po-approver-state:${process.env.MAIL_TOKEN_KEY ?? ''}`).digest();

/** A short-lived, tamper-proof token naming who started the link, so the callback cannot be forged or replayed for someone else. */
export function signState(p: { org: string; user: string }, now = Date.now()): string {
    const body = Buffer.from(JSON.stringify({ ...p, exp: now + 15 * 60_000, n: crypto.randomBytes(6).toString('hex') })).toString('base64url');
    return `${body}.${crypto.createHmac('sha256', stateKey()).update(body).digest('base64url')}`;
}

export function verifyState(s: string | null | undefined, now = Date.now()): { org: string; user: string } | null {
    const [body, sig] = String(s ?? '').split('.');
    if (!body || !sig) return null;
    const want = crypto.createHmac('sha256', stateKey()).update(body).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { org: string; user: string; exp: number };
        return p.exp > now && p.org && p.user ? { org: p.org, user: p.user } : null;
    } catch { return null; }
}

export function authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({ scope: APPROVER_SCOPES, client_id: clientId(), response_type: 'code', access_type: 'offline', prompt: 'consent', redirect_uri: redirectUri, state });
    return `https://accounts.zoho.${dcOf()}/oauth/v2/auth?${q}`;
}

/* ---------------------------------------------------------------- the link itself */

export interface ApproverLink { connected: boolean; zoho_email: string | null; zoho_user_name: string | null; last_error: string | null; connected_at: string | null }

export async function approverLink(orgId: string, userId: string): Promise<ApproverLink> {
    const { data } = await supabaseAdmin.from('po_approver_connections').select('zoho_email, zoho_user_name, last_error, connected_at, is_active').eq('organization_id', orgId).eq('user_id', userId).maybeSingle();
    return { connected: !!data?.is_active, zoho_email: data?.zoho_email ?? null, zoho_user_name: data?.zoho_user_name ?? null, last_error: data?.last_error ?? null, connected_at: data?.connected_at ?? null };
}

/** Swap the one-time code for a refresh token, learn which Zoho user it is, and store the token encrypted. */
export async function saveApproverLink(orgId: string, userId: string, code: string, redirectUri: string): Promise<{ ok: true; zoho_email: string | null } | { ok: false; error: string }> {
    const res = await fetch(`https://accounts.zoho.${dcOf()}/oauth/v2/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri, grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(20_000),
    });
    const d = await res.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; api_domain?: string; error?: string };
    if (!d.access_token || !d.refresh_token) return { ok: false, error: `Zoho did not give access (${d.error ?? `HTTP ${res.status}`}). Try connecting again.` };

    const { data: cfg } = await supabaseAdmin.from('accounts_zoho_config').select('zoho_organization_id').eq('organization_id', orgId).maybeSingle();
    let email: string | null = null, name: string | null = null;
    if (cfg?.zoho_organization_id) {
        const me = await fetch(`${d.api_domain ?? `https://www.zohoapis.${dcOf()}`}/books/v3/users/me?organization_id=${cfg.zoho_organization_id}`, { headers: { Authorization: `Zoho-oauthtoken ${d.access_token}` }, signal: AbortSignal.timeout(20_000) });
        const u = (await me.json().catch(() => null) as { user?: { email?: string; name?: string } } | null)?.user;
        email = u?.email ?? null; name = u?.name ?? null;
    }
    const { error } = await supabaseAdmin.from('po_approver_connections').upsert({
        organization_id: orgId, user_id: userId, zoho_email: email, zoho_user_name: name, refresh_token_enc: encryptToken(d.refresh_token), dc: dcOf(),
        scopes: APPROVER_SCOPES, is_active: true, last_error: null, connected_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,user_id' });
    return error ? { ok: false, error: error.message } : { ok: true, zoho_email: email };
}

interface ApproverToken { token: string; apiDomain: string; zohoOrgId: string }

async function approverToken(orgId: string, userId: string): Promise<ApproverToken | { error: string; reconnect: boolean }> {
    const { data: conn } = await supabaseAdmin.from('po_approver_connections').select('refresh_token_enc, dc, is_active').eq('organization_id', orgId).eq('user_id', userId).maybeSingle();
    if (!conn?.is_active) return { error: 'Connect your Zoho account first. Approvals are recorded in Zoho under your name.', reconnect: true };
    const { data: cfg } = await supabaseAdmin.from('accounts_zoho_config').select('zoho_organization_id').eq('organization_id', orgId).maybeSingle();
    if (!cfg?.zoho_organization_id) return { error: 'Zoho Books is not configured for this organisation.', reconnect: false };
    let refresh: string;
    try { refresh = decryptToken(conn.refresh_token_enc); } catch { return { error: 'Your stored Zoho link can no longer be read. Connect again.', reconnect: true }; }
    const res = await fetch(`https://accounts.zoho.${conn.dc}/oauth/v2/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ refresh_token: refresh, client_id: clientId(), client_secret: clientSecret(), grant_type: 'refresh_token' }), signal: AbortSignal.timeout(20_000),
    });
    const d = await res.json().catch(() => ({})) as { access_token?: string; api_domain?: string; error?: string };
    if (!d.access_token) {
        const revoked = d.error === 'invalid_grant' || d.error === 'invalid_code';
        await supabaseAdmin.from('po_approver_connections').update({ last_error: `Zoho refused the link: ${d.error ?? res.status}`, ...(revoked ? { is_active: false } : {}) }).eq('organization_id', orgId).eq('user_id', userId);
        return { error: revoked ? 'Zoho says your link was removed. Connect again.' : `Zoho did not accept your link right now (${d.error ?? `HTTP ${res.status}`}). Try again in a minute.`, reconnect: revoked };
    }
    await supabaseAdmin.from('po_approver_connections').update({ last_used_at: new Date().toISOString(), last_error: null }).eq('organization_id', orgId).eq('user_id', userId);
    return { token: d.access_token, apiDomain: d.api_domain ?? `https://www.zohoapis.${conn.dc}`, zohoOrgId: cfg.zoho_organization_id };
}

/* ---------------------------------------------------------------- the decision */

export type Decision = 'approve' | 'reject' | 'question';
export interface DecideResult { ok: boolean; message: string; status?: number; reconnect?: boolean; approved?: boolean; zoho_status?: string | null; notified?: string }

/** The only place this module writes to Zoho: approve and reject, as the approver. Injected so tests never touch the network. */
export interface ZohoPort {
    status(zohoPoId: string): Promise<string | null>;
    act(t: ApproverToken, zohoPoId: string, verb: 'approve' | 'reject'): Promise<{ http: number; message: string }>;
    comment(t: ApproverToken, zohoPoId: string, text: string): Promise<void>;
    statusAs(t: ApproverToken, zohoPoId: string): Promise<string | null>;
}

const livePort = (orgId: string): ZohoPort => ({
    async status(id) {
        const z = await zohoContext(orgId); if (!z) return null;
        const r = await zohoGet(z, `purchaseorders/${encodeURIComponent(id)}`);
        return r.ok ? ((await r.json().catch(() => null)) as { purchaseorder?: { status?: string } } | null)?.purchaseorder?.status ?? null : null;
    },
    async act(t, id, verb) {
        const r = await fetch(`${t.apiDomain}/books/v3/purchaseorders/${encodeURIComponent(id)}/${verb}?organization_id=${t.zohoOrgId}`, { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${t.token}` }, signal: AbortSignal.timeout(30_000) });
        const j = await r.json().catch(() => ({})) as { message?: string };
        return { http: r.status, message: String(j.message ?? '').slice(0, 300) };
    },
    async comment(t, id, text) {
        await fetch(`${t.apiDomain}/books/v3/purchaseorders/${encodeURIComponent(id)}/comments?organization_id=${t.zohoOrgId}`, { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${t.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ description: text.slice(0, 500) }), signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
    },
    async statusAs(t, id) {
        const r = await fetch(`${t.apiDomain}/books/v3/purchaseorders/${encodeURIComponent(id)}?organization_id=${t.zohoOrgId}`, { headers: { Authorization: `Zoho-oauthtoken ${t.token}` }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
        return r?.ok ? ((await r.json().catch(() => null)) as { purchaseorder?: { status?: string } } | null)?.purchaseorder?.status ?? null : null;
    },
});

async function purchaseRecipients(orgId: string): Promise<string[]> {
    const { data } = await supabaseAdmin.from('organization_memberships').select('user_id').eq('organization_id', orgId).in('role', ROLE_GROUPS.purchase).eq('is_active', true);
    return [...new Set((data ?? []).map((r) => r.user_id as string))];
}

async function tellPurchase(orgId: string, poId: string, title: string, description: string) {
    const people = await purchaseRecipients(orgId);
    if (!people.length) return 'nobody holds a purchase role';
    await supabaseAdmin.from('pending_actions').insert(people.map((recipient_id) => ({
        organization_id: orgId, recipient_id, domain: 'po_approval', entity_type: 'po', entity_id: poId, title, description, actions: ['view'], deep_link: `/${orgId}/accounts?po=${poId}`,
    })));
    return `${people.length} purchase user${people.length > 1 ? 's' : ''}`;
}

export async function decidePo(input: { orgId: string; poId: string; userId: string; userName: string | null; decision: Decision; reason?: string | null }, port?: ZohoPort): Promise<DecideResult> {
    const { orgId, poId, userId, decision } = input;
    const reason = String(input.reason ?? '').trim();
    const p = port ?? livePort(orgId);

    if (decision === 'reject' && reason.length < 5) return { ok: false, status: 400, message: 'Give a reason for rejecting (at least 5 characters). Purchase will see it.' };
    if (decision === 'question' && reason.length < 3) return { ok: false, status: 400, message: 'Write your question.' };

    const { data: po } = await supabaseAdmin.from('zoho_purchase_orders').select('id, po_number, vendor_name, po_amount, zoho_po_id, status').eq('id', poId).eq('organization_id', orgId).maybeSingle();
    if (!po) return { ok: false, status: 404, message: 'PO not found.' };

    const log = async (d: 'approve' | 'reject' | 'question' | 'refused', ok: boolean, extra: { http?: number; message?: string; after?: string | null; reason?: string | null } = {}) => {
        await supabaseAdmin.from('po_approval_decisions').insert({
            organization_id: orgId, po_id: po.id, zoho_po_id: po.zoho_po_id, po_number: po.po_number, vendor_name: po.vendor_name, amount: po.po_amount,
            decision: d, reason: extra.reason ?? (reason || null), decided_by: userId, decided_by_name: input.userName, zoho_http: extra.http ?? null, zoho_message: extra.message ?? null, zoho_status_after: extra.after ?? null, ok,
        });
    };

    // A question never touches Zoho: it goes to Purchase, and the PO stays pending.
    if (decision === 'question') {
        const told = await tellPurchase(orgId, po.id, `Question on ${po.po_number} before approval`, `${input.userName ?? 'An approver'} asks: ${reason}`);
        await logPoActivity({ organizationId: orgId, poId: po.id, action: 'comment', actorId: userId, note: `Approver asked Purchase: ${reason}` });
        await log('question', true);
        return { ok: true, message: `Sent to ${told}. The PO stays pending.`, notified: told };
    }

    if (!po.zoho_po_id) return { ok: false, status: 409, message: 'This PO has no Zoho record, so it cannot be approved here.' };

    // 1. Still pending in Zoho right now? The queue is a copy and can be stale.
    const live = await p.status(po.zoho_po_id);
    if (live == null) return { ok: false, status: 502, message: 'Could not read this PO from Zoho just now. Nothing was changed. Try again in a minute.' };
    if (live !== 'pending_approval') {
        await supabaseAdmin.from('zoho_purchase_orders').update({ status: live }).eq('id', po.id).eq('organization_id', orgId);
        await log('refused', false, { after: live, message: `Zoho already shows this PO as ${live}.` });
        return { ok: false, status: 409, zoho_status: live, message: `Zoho already shows this PO as ${live.replace(/_/g, ' ')}. The list has been refreshed.` };
    }

    // 2. Act as the approver.
    const t = await approverToken(orgId, userId);
    if ('error' in t) return { ok: false, status: 403, reconnect: t.reconnect, message: t.error };

    if (decision === 'approve') {
        // Mark it as one we watched, so the vendor message that follows is eligible exactly like any other approval.
        await supabaseAdmin.from('po_approval_watch').upsert({ organization_id: orgId, zoho_po_id: po.zoho_po_id, po_number: po.po_number, seen_pending_at: new Date().toISOString(), state: 'pending', updated_at: new Date().toISOString() }, { onConflict: 'organization_id,zoho_po_id', ignoreDuplicates: true });
    }
    const r = await p.act(t, po.zoho_po_id, decision);
    if (r.http < 200 || r.http >= 300) {
        await log(decision, false, { http: r.http, message: r.message });
        return { ok: false, status: 502, message: `Zoho refused: ${r.message || `HTTP ${r.http}`}. Nothing was changed.` };
    }

    // 3. Believe Zoho, not the click: read the status back as the approver.
    const after = await p.statusAs(t, po.zoho_po_id);
    if (decision === 'reject') {
        if (reason) await p.comment(t, po.zoho_po_id, `Rejected by ${input.userName ?? 'approver'}: ${reason}`);
        await supabaseAdmin.from('zoho_purchase_orders').update({ status: after ?? 'rejected' }).eq('id', po.id).eq('organization_id', orgId);
        await logPoActivity({ organizationId: orgId, poId: po.id, action: 'comment', actorId: userId, note: `PO rejected: ${reason}` });
        const told = await tellPurchase(orgId, po.id, `${po.po_number} was rejected`, `${input.userName ?? 'The approver'} rejected it: ${reason}`);
        await log('reject', true, { http: r.http, after });
        return { ok: true, message: `Rejected in Zoho. ${told === 'nobody holds a purchase role' ? '' : `Purchase (${told}) has been told.`}`.trim(), zoho_status: after, notified: told };
    }

    if (after === 'approved') {
        await supabaseAdmin.from('zoho_purchase_orders').update({ status: 'approved' }).eq('id', po.id).eq('organization_id', orgId);
        await logPoActivity({ organizationId: orgId, poId: po.id, action: 'comment', actorId: userId, note: `PO approved by ${input.userName ?? 'approver'} in Zoho` });
        const told = await tellPurchase(orgId, po.id, `${po.po_number} was approved`, `${input.userName ?? 'The approver'} approved it.`);
        await log('approve', true, { http: r.http, after });
        // The vendor message follows the existing switch (off / test / live) and the one-send-per-PO guard.
        const { data: s } = await supabaseAdmin.from('po_notify_settings').select('auto_mode, auto_since').eq('organization_id', orgId).maybeSingle();
        let vendor = 'The vendor message is off (switch in Invoice Control, Policy).';
        if (s?.auto_mode === 'test' || s?.auto_mode === 'live') {
            const z = await zohoContext(orgId);
            const sent = z ? await handleApprovedPo(orgId, z, po.zoho_po_id, s.auto_mode, s.auto_since ?? null).catch(() => 'error' as const) : 'error';
            vendor = sent === 'notified' ? (s.auto_mode === 'live' ? 'Vendor has been sent the approved PO on WhatsApp.' : 'Approved PO sent to your test number.')
                : sent === 'no_phone' ? 'No WhatsApp number for this vendor: Purchase has been flagged to add one.'
                : sent === 'already' ? 'The vendor had already been messaged.' : 'The vendor message did not go: it will be retried automatically.';
        }
        return { ok: true, approved: true, zoho_status: after, message: `Approved in Zoho. ${vendor}`, notified: told };
    }

    // Zoho took the approval but the PO needs another approver (a multi-step chain): never claim "approved".
    await log('approve', true, { http: r.http, after, message: 'Recorded in Zoho; PO still awaits another approver.' });
    return { ok: true, approved: false, zoho_status: after, message: `Your approval is recorded in Zoho. The PO is still ${(after ?? 'pending').replace(/_/g, ' ')}, so another approver has to act before it counts as approved.` };
}
