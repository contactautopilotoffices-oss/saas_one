/**
 * CONNECTED MAILBOXES — the store behind "Connect my mailbox".
 * -----------------------------------------------------------------------------
 * One Zoho server-based application, created once. Every person then consents
 * for their own account and a refresh token for THAT account lands here. An
 * agent names the mailbox it reads; this resolves which grant can read it.
 *
 * Nothing in this file may return a token to a caller that could reach a client.
 * `tokenFor()` is the only reader, it is server-side, and everything else
 * returns addresses and health.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/* ---------------------------------------------------------------------------
 * Encryption. AES-256-GCM, key from MAIL_TOKEN_KEY.
 *
 * The key never enters the database, so a dump or a replica carries ciphertext
 * and nothing else. Rotating the key invalidates stored tokens, which is the
 * correct behaviour: the operator reconnects rather than silently continuing
 * with a key we can no longer vouch for.
 * ------------------------------------------------------------------------- */

function key(): Buffer {
    const raw = process.env.MAIL_TOKEN_KEY ?? '';
    if (!raw.trim()) {
        throw new Error('MAIL_TOKEN_KEY is not set — a mailbox token cannot be stored or read without it.');
    }
    // Any passphrase length is accepted; it is stretched to 32 bytes.
    return crypto.createHash('sha256').update(raw).digest();
}

export function encryptToken(plain: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptToken(packed: string): string {
    const [ivB64, tagB64, dataB64] = String(packed).split('.');
    if (!ivB64 || !tagB64 || !dataB64) throw new Error('stored mail token is malformed');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    d.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
}

/* ---------------------------------------------------------------------------
 * The store
 * ------------------------------------------------------------------------- */

export interface MailAccountSummary {
    id: string;
    address: string;
    addresses: string[];
    dc: string;
    connected_at: string;
    connected_by_name: string | null;
    last_ok_at: string | null;
    last_error: string | null;
    is_active: boolean;
}

/** Everything an operator may see. Never the token. */
export async function listMailAccounts(orgId: string): Promise<{ ok: boolean; accounts: MailAccountSummary[]; error?: string }> {
    const { data, error } = await supabaseAdmin
        .from('oem_mail_accounts')
        .select('id, address, addresses, dc, connected_at, connected_by, last_ok_at, last_error, is_active')
        .eq('organization_id', orgId)
        .order('connected_at', { ascending: true });
    if (error) return { ok: false, accounts: [], error: error.message };

    const ids = [...new Set((data ?? []).map((a) => a.connected_by).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (ids.length) {
        const { data: users } = await supabaseAdmin.from('users').select('id, full_name').in('id', ids);
        for (const u of users ?? []) names.set(String(u.id), String(u.full_name ?? ''));
    }
    return {
        ok: true,
        accounts: (data ?? []).map((a) => ({
            id: String(a.id),
            address: String(a.address),
            addresses: (a.addresses ?? []) as string[],
            dc: String(a.dc ?? 'com'),
            connected_at: String(a.connected_at),
            connected_by_name: a.connected_by ? names.get(String(a.connected_by)) ?? null : null,
            last_ok_at: a.last_ok_at ? String(a.last_ok_at) : null,
            last_error: a.last_error ? String(a.last_error) : null,
            is_active: Boolean(a.is_active),
        })),
    };
}

export async function saveMailAccount(input: {
    orgId: string; address: string; addresses: string[]; zohoAccountId: string | null;
    refreshToken: string; dc: string; scopes: string | null; connectedBy: string | null;
}): Promise<{ ok: boolean; error?: string }> {
    try {
        const { error } = await supabaseAdmin.from('oem_mail_accounts').upsert({
            organization_id: input.orgId,
            address: input.address.toLowerCase(),
            addresses: input.addresses.map((a) => a.toLowerCase()),
            zoho_account_id: input.zohoAccountId,
            refresh_token_enc: encryptToken(input.refreshToken),
            dc: input.dc,
            scopes: input.scopes,
            connected_by: input.connectedBy,
            connected_at: new Date().toISOString(),
            last_error: null,
            is_active: true,
        }, { onConflict: 'organization_id,address' });
        return error ? { ok: false, error: error.message } : { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export interface ResolvedGrant { refreshToken: string; dc: string; address: string; accountId: string | null }

/**
 * The connected account that can read `address` — matched against every alias
 * on the grant, so pointing an agent at an alias needs no extra setup.
 *
 * Returns null when nothing covers it. That is a real answer the caller must
 * surface; falling back to another grant would read the wrong inbox.
 */
const grantCache = new Map<string, { at: number; grant: ResolvedGrant | null }>();
const GRANT_TTL_MS = 60_000;

/** Drop the resolver cache, so a newly added alias is readable at once. */
export function grantForMailboxCacheClear(): void { grantCache.clear(); }

export async function grantForMailbox(orgId: string, address: string): Promise<ResolvedGrant | null> {
    const want = address.trim().toLowerCase();
    if (!want) return null;
    const hit = grantCache.get(`${orgId}:${want}`);
    if (hit && Date.now() - hit.at < GRANT_TTL_MS) return hit.grant;
    const { data } = await supabaseAdmin
        .from('oem_mail_accounts')
        .select('address, addresses, refresh_token_enc, dc, zoho_account_id')
        .eq('organization_id', orgId).eq('is_active', true);
    for (const a of data ?? []) {
        const all = [String(a.address).toLowerCase(), ...((a.addresses ?? []) as string[]).map((x) => x.toLowerCase())];
        if (!all.includes(want)) continue;
        try {
            const grant = {
                refreshToken: decryptToken(String(a.refresh_token_enc)),
                dc: String(a.dc ?? 'com'),
                address: String(a.address),
                accountId: a.zoho_account_id ? String(a.zoho_account_id) : null,
            };
            grantCache.set(`${orgId}:${want}`, { at: Date.now(), grant });
            return grant;
        } catch { return null; } // key rotated: reconnect, do not guess
    }
    grantCache.set(`${orgId}:${want}`, { at: Date.now(), grant: null });
    return null;
}

/**
 * Re-read which addresses a connection can reach, and store them.
 *
 * The alias list is captured at consent time, so adding an alias afterwards —
 * which is exactly how an agent gets its own address — leaves our copy stale
 * and the mailbox unreadable for no visible reason. This re-asks Zoho.
 *
 * Cheap, safe to repeat, and needs no reconsent: the grant is unchanged, only
 * our picture of it was out of date.
 */
export async function refreshMailAccountAddresses(
    orgId: string, address: string,
): Promise<{ ok: boolean; addresses: string[]; added: string[]; error?: string }> {
    const grant = await grantForMailbox(orgId, address);
    if (!grant) return { ok: false, addresses: [], added: [], error: `no connection covers ${address}` };

    const { ZohoMailService } = await import('@/backend/services/zohoMailService');
    try {
        const found = await ZohoMailService.listAddressesWithGrant({ refreshToken: grant.refreshToken, dc: grant.dc });
        if (!found.length) return { ok: false, addresses: [], added: [], error: 'Zoho listed no addresses for this connection' };

        const { data: before } = await supabaseAdmin
            .from('oem_mail_accounts').select('addresses')
            .eq('organization_id', orgId).eq('address', grant.address.toLowerCase()).maybeSingle();
        const had = new Set(((before?.addresses ?? []) as string[]).map((x) => x.toLowerCase()));

        const { error } = await supabaseAdmin.from('oem_mail_accounts')
            .update({ addresses: found, last_ok_at: new Date().toISOString(), last_error: null })
            .eq('organization_id', orgId).eq('address', grant.address.toLowerCase());
        if (error) return { ok: false, addresses: [], added: [], error: error.message };

        // The in-process resolver caches address -> grant; a new alias must not
        // wait on a restart to become readable.
        grantForMailboxCacheClear();
        return { ok: true, addresses: found, added: found.filter((a) => !had.has(a)) };
    } catch (e) {
        return { ok: false, addresses: [], added: [], error: e instanceof Error ? e.message : String(e) };
    }
}

/** Health, so a revoked grant shows in the console instead of a quiet agent. */
export async function noteMailAccountResult(orgId: string, address: string, error: string | null): Promise<void> {
    try {
        await supabaseAdmin.from('oem_mail_accounts').update(
            error ? { last_error: error.slice(0, 400) } : { last_ok_at: new Date().toISOString(), last_error: null },
        ).eq('organization_id', orgId).eq('address', address.toLowerCase());
    } catch { /* health is advisory */ }
}
