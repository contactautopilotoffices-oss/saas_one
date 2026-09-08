/**
 * Zoho Mail REST client for the shared purchase@ mailbox.
 *
 * Deliberately a separate OAuth client from Books/SSO: this one needs only
 * ZohoMail.messages.READ. Mirrors ZohoService.getAccessToken (same refresh-token
 * flow, same data-centre pin) so both behave identically when misconfigured.
 */

export interface ZohoMailMessage {
    messageId: string;
    threadId: string;
    folderId: string | null;
    subject: string;
    summary: string;
    fromAddress: string;
    /** The display name on the From header, when there is one. "Vidya Pawar". */
    fromName: string | null;
    toAddress: string[];
    ccAddress: string[];
    sentAt: string;             // ISO
    hasAttachment: boolean;
    /**
     * The RFC 822 Message-ID header — what In-Reply-To/References actually need,
     * as opposed to `messageId` above, which is Zoho's INTERNAL numeric id and
     * threads nothing outside Zoho. Present only when Zoho's payload carried it.
     */
    rfcMessageId: string | null;
}

export interface ZohoMailAttachment {
    attachmentId: string;
    attachmentName: string;
    mimeType: string;
    attachmentSize: number;
}

export interface ZohoMailThread {
    threadId: string;
    subject: string;
    participants: string[];
    messages: ZohoMailMessage[];    // oldest -> newest
    lastMessageAt: string;
}

interface ListOptions {
    /** Only messages newer than this are kept (the view API has no server-side date filter). */
    since?: Date;
    /** Hard ceiling on messages pulled; also bounded by the page cap below. */
    limit?: number;
    folderId?: string;
    /**
     * Which mailbox in the grant to read. One Zoho grant (one refresh token)
     * can cover several shared mailboxes — purchase@, support@, sites@ — and
     * this picks the account for the address instead of the env default. It is
     * what lets an agent poll MANY addresses without a new env prefix each.
     */
    address?: string;
}

const PAGE_SIZE = 200;          // Zoho Mail caps `limit` at 200
const MAX_PAGES = 15;           // hard cap: 15 × 200 = 3k messages per sync

/**
 * Which env set the client reads. The purchase mailbox uses ZOHO_MAIL_*; the
 * electricity bills mailbox is a separate OAuth client + refresh token pinned under
 * ZOHO_ELEC_MAIL_* (plan §9 items 1–2: forwarding goes via SMTP, never Zoho send
 * scope). Everything keys off the prefix so both mailboxes share one code path.
 */
export type ZohoMailEnv = string;

/**
 * Every Zoho grant this deployment holds, in priority order.
 *
 * A grant is tied to ONE Zoho account and can only reach that account's
 * mailboxes — `purchase@worksquare.in` cannot read anybody else's inbox, and
 * should not be able to. So an agent whose replies land in a different mailbox
 * needs its own grant, and the code must be able to hold more than two.
 *
 * Discovered from the environment rather than hardcoded, so adding a mailbox
 * is a credential change and not a code change. Any `<PREFIX>_CLIENT_ID` +
 * `_CLIENT_SECRET` + `_REFRESH_TOKEN` triple is a usable grant.
 */
export function zohoMailGrants(): ZohoMailEnv[] {
    const known = new Set<string>(['ZOHO_MAIL', 'ZOHO_ELEC_MAIL']);
    for (const k of Object.keys(process.env)) {
        const m = /^(ZOHO_[A-Z0-9_]*MAIL)_CLIENT_ID$/.exec(k);
        if (m) known.add(m[1]);
    }
    return [...known].filter(isZohoMailConfigured);
}

/** grant prefix that owns an address, once proven. Saves re-probing every poll. */
const grantForAddress = new Map<string, ZohoMailEnv>();

/**
 * Which grant can actually read this mailbox. Probes each configured grant's
 * account list once and remembers the answer.
 *
 * Returns null when no grant holds it — which is a real answer the caller must
 * surface, not something to paper over by falling back to the default grant and
 * silently reading the wrong inbox.
 */
export async function grantOwning(address: string): Promise<ZohoMailEnv | null> {
    const want = address.trim().toLowerCase();
    if (!want) return null;
    const cached = grantForAddress.get(want);
    if (cached) return cached;
    for (const prefix of zohoMailGrants()) {
        try {
            const accounts = await ZohoMailService.listAccountAddresses(prefix);
            if (accounts.includes(want)) { grantForAddress.set(want, prefix); return prefix; }
        } catch { /* try the next grant */ }
    }
    return null;
}

const env = (prefix: ZohoMailEnv, key: string) => process.env[`${prefix}_${key}`];

/** True when the shared-mailbox integration has enough env to run at all. */
export function isZohoMailConfigured(prefix: ZohoMailEnv = 'ZOHO_MAIL'): boolean {
    return !!(env(prefix, 'CLIENT_ID') && env(prefix, 'CLIENT_SECRET') && env(prefix, 'REFRESH_TOKEN'));
}

/** The mailbox this integration watches; classification keys off it to tell inbound from outbound. */
export function mailboxAddress(prefix: ZohoMailEnv = 'ZOHO_MAIL'): string {
    const fallback = prefix === 'ZOHO_ELEC_MAIL' ? 'electricity@worksquare.in' : 'purchase@worksquare.in';
    return (env(prefix, 'ADDRESS') || fallback).toLowerCase();
}

/**
 * Access tokens live about an hour. Zoho rate-limits how many a refresh token
 * may mint, so minting a fresh one for every single API call is not merely
 * wasteful — it takes the integration down.
 *
 * That is exactly what happened: a burst of diagnostic calls exhausted the
 * quota, every subsequent refresh came back `invalid_client`, and the failure
 * read as dead credentials. It was self-inflicted, and it compounded, because
 * a FAILED call tries the fallback data centre too and therefore burns two
 * refreshes instead of one. Left alone, four polls an hour across two
 * mailboxes would have kept re-minting for no reason.
 *
 * Cached per env prefix, with a minute of headroom before expiry.
 */
const tokenCache = new Map<string, { token: string; apiDomain: string; expiresAt: number }>();
const TOKEN_SAFETY_MS = 60_000;

export class ZohoMailService {
    private static async getAccessToken(prefix: ZohoMailEnv = 'ZOHO_MAIL'): Promise<{ token: string; apiDomain: string }> {
        const cached = tokenCache.get(prefix);
        if (cached && cached.expiresAt > Date.now()) {
            return { token: cached.token, apiDomain: cached.apiDomain };
        }
        const clientId = env(prefix, 'CLIENT_ID');
        const clientSecret = env(prefix, 'CLIENT_SECRET');
        const refreshToken = env(prefix, 'REFRESH_TOKEN');

        if (!clientId || !clientSecret || !refreshToken) {
            throw new Error(`Zoho Mail credentials missing in .env (${prefix}_CLIENT_ID / ${prefix}_CLIENT_SECRET / ${prefix}_REFRESH_TOKEN)`);
        }

        // Refresh tokens are data-centre locked. <PREFIX>_DC pins the right one
        // (com/in/eu/…); the others are tried as a fallback for unset/misconfigured envs.
        const preferred = (env(prefix, 'DC') || 'com').replace(/^\.+/, '').trim();
        const domains = [preferred, ...['com', 'in'].filter(d => d !== preferred)];
        let lastError: unknown = null;

        for (const tld of domains) {
            try {
                const params = new URLSearchParams({
                    refresh_token: refreshToken,
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: 'refresh_token',
                });

                const res = await fetch(`https://accounts.zoho.${tld}/oauth/v2/token?${params.toString()}`, {
                    method: 'POST',
                });

                const data = await res.json();
                if (res.ok && data.access_token) {
                    const apiDomain = this.mailApiDomain(data.api_domain, tld, prefix);
                    const ttlMs = Math.max(0, (Number(data.expires_in) || 3600) * 1000 - TOKEN_SAFETY_MS);
                    tokenCache.set(prefix, { token: data.access_token, apiDomain, expiresAt: Date.now() + ttlMs });
                    return { token: data.access_token, apiDomain };
                }
                lastError = data;
                // `invalid_client` from the CONFIGURED data centre is either bad
                // credentials or an exhausted quota. Trying the other DC cannot
                // fix either, and doubles the spend that caused the second one.
                if (tld === preferred && data?.error === 'invalid_client') break;
            } catch (err) {
                lastError = err;
            }
        }

        console.error('Zoho Mail Token Error:', lastError);
        const hint = (lastError as { error?: string })?.error === 'invalid_client'
            ? ` The credentials may be correct and the refresh QUOTA exhausted — verify by minting one token by hand before changing anything.`
            : '';
        throw new Error(`Failed to refresh Zoho Mail access token. Check ${prefix}_* credentials and ${prefix}_DC.${hint}`);
    }

    /**
     * Mail does not live on the zohoapis host the token response advertises — it is
     * served from mail.zoho.<tld>. Reuse the api_domain only to learn which DC the
     * token actually belongs to.
     */
    private static mailApiDomain(apiDomain: string | undefined, tld: string, prefix: ZohoMailEnv): string {
        const override = env(prefix, 'API_DOMAIN');
        if (override) return override.replace(/\/+$/, '');
        const fromApi = typeof apiDomain === 'string' ? apiDomain.match(/zohoapis\.([a-z.]+)$/i)?.[1] : null;
        return `https://mail.zoho.${fromApi || tld}`;
    }

    private static accountCache = new Map<string, string>();

    /**
     * The Zoho account id for an address, resolved from the TOKEN rather than
     * from an env prefix. A console-connected mailbox has no prefix to name.
     * With no address, the grant's first (and for a personal grant, only)
     * account is used.
     */
    private static async accountIdFor(token: string, apiDomain: string, address?: string): Promise<string> {
        const want = (address ?? '').trim().toLowerCase();
        const cacheKey = `tok:${token.slice(-10)}:${want}`;
        const cached = this.accountCache.get(cacheKey);
        if (cached) return cached;

        const res = await fetch(`${apiDomain}/api/accounts`, { headers: { 'Authorization': `Zoho-oauthtoken ${token}` } });
        const data = await res.json().catch(() => null);
        const accounts = (data?.data ?? []) as Array<{ accountId?: string; primaryEmailAddress?: string; emailAddress?: Array<{ mailId?: string }> }>;

        const match = want
            ? accounts.find((a) =>
                String(a?.primaryEmailAddress ?? '').toLowerCase() === want
                || (a?.emailAddress ?? []).some((e) => String(e?.mailId ?? '').toLowerCase() === want))
            : accounts[0];

        if (!match?.accountId) {
            throw new Error(want
                ? `This mailbox connection does not contain "${want}". Connect that mailbox from the Agent Console.`
                : 'This mailbox connection lists no account.');
        }
        this.accountCache.set(cacheKey, String(match.accountId));
        return String(match.accountId);
    }

    private static async accountId(token: string, apiDomain: string, prefix: ZohoMailEnv, address?: string): Promise<string> {
        const wanted = (address ?? mailboxAddress(prefix)).toLowerCase();
        // The env ACCOUNT_ID is the DEFAULT mailbox's id. It must not be handed to
        // a different address — that would read purchase@ while claiming support@.
        const configured = env(prefix, 'ACCOUNT_ID');
        if (configured && wanted === mailboxAddress(prefix)) return configured;
        const cached = this.accountCache.get(`${prefix}:${wanted}`);
        if (cached) return cached;

        // Self-service fallback so the integration works with creds alone; the account
        // id is stable, so setting <PREFIX>_ACCOUNT_ID saves this round trip.
        const res = await fetch(`${apiDomain}/api/accounts`, {
            headers: { 'Authorization': `Zoho-oauthtoken ${token}` },
        });
        const data = await res.json().catch(() => null);
        const accounts: any[] = data?.data || [];
        const match = accounts.find(a =>
            String(a?.primaryEmailAddress || '').toLowerCase() === wanted
            || (a?.emailAddress || []).some((e: any) => String(e?.mailId || '').toLowerCase() === wanted),
        );

        // NO `|| accounts[0]` fallback. The self-client is normally provisioned under an
        // admin's own Zoho account (a shared mailbox has no interactive login), so the
        // first listed account is usually that admin's PRIVATE inbox — which would then be
        // ingested and published to the whole org with no error logged.
        if (!match?.accountId) {
            console.error('Zoho Mail Accounts Error: no account matched', wanted, data);
            throw new Error(
                `The Zoho Mail grant does not contain the mailbox "${wanted}". Set ${prefix}_ACCOUNT_ID (or correct ${prefix}_ADDRESS).`,
            );
        }
        this.accountCache.set(`${prefix}:${wanted}`, String(match.accountId));
        return String(match.accountId);
    }

    /**
     * Read using a grant handed in at call time — a mailbox connected through
     * the console rather than named in the environment. Same code path; the
     * only difference is where the refresh token came from.
     */
    static async listMessagesWithGrant(
        options: ListOptions,
        grant: { refreshToken: string; dc: string },
    ): Promise<ZohoMailMessage[]> {
        const t = await this.tokenFromGrant(grant);
        return this.listMessagesRaw(options, t.token, t.apiDomain);
    }

    static async getMessageContentWithGrant(
        messageId: string, folderId: string | null | undefined,
        grant: { refreshToken: string; dc: string }, address?: string,
    ): Promise<{ subject: string; content: string; fromAddress: string; rfcMessageId: string | null }> {
        const t = await this.tokenFromGrant(grant);
        return this.getMessageContentRaw(messageId, folderId, t.token, t.apiDomain, address);
    }

    /** Mint (and cache) an access token for a caller-supplied refresh token. */
    private static async tokenFromGrant(grant: { refreshToken: string; dc: string }): Promise<{ token: string; apiDomain: string }> {
        const cacheKey = `grant:${grant.refreshToken.slice(-12)}`;
        const cached = tokenCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return { token: cached.token, apiDomain: cached.apiDomain };

        const clientId = process.env.ZOHO_MAIL_APP_CLIENT_ID ?? process.env.ZOHO_MAIL_CLIENT_ID;
        const clientSecret = process.env.ZOHO_MAIL_APP_CLIENT_SECRET ?? process.env.ZOHO_MAIL_CLIENT_SECRET;
        if (!clientId || !clientSecret) throw new Error('No Zoho mail application configured (ZOHO_MAIL_APP_CLIENT_ID / _SECRET).');

        const dc = (grant.dc || 'com').trim();
        const params = new URLSearchParams({
            refresh_token: grant.refreshToken, client_id: clientId,
            client_secret: clientSecret, grant_type: 'refresh_token',
        });
        const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token?${params}`, { method: 'POST' });
        const data = await res.json().catch(() => null);
        if (!data?.access_token) {
            throw new Error(`Zoho refused this mailbox connection: ${data?.error ?? 'unknown'}. It may have been revoked — reconnect it from the console.`);
        }
        const apiDomain = this.mailApiDomain(data.api_domain, dc, 'ZOHO_MAIL');
        const ttlMs = Math.max(0, (Number(data.expires_in) || 3600) * 1000 - TOKEN_SAFETY_MS);
        tokenCache.set(cacheKey, { token: data.access_token, apiDomain, expiresAt: Date.now() + ttlMs });
        return { token: data.access_token, apiDomain };
    }

    /** Addresses reachable on a caller-supplied grant — a console connection. */
    static async listAddressesWithGrant(grant: { refreshToken: string; dc: string }): Promise<string[]> {
        const t = await this.tokenFromGrant(grant);
        const res = await fetch(`${t.apiDomain}/api/accounts`, { headers: { 'Authorization': `Zoho-oauthtoken ${t.token}` } });
        const data = await res.json().catch(() => null);
        const out: string[] = [];
        for (const a of (data?.data ?? []) as Array<{ primaryEmailAddress?: string; emailAddress?: Array<{ mailId?: string }> }>) {
            if (a.primaryEmailAddress) out.push(String(a.primaryEmailAddress).toLowerCase());
            for (const e of a.emailAddress ?? []) if (e?.mailId) out.push(String(e.mailId).toLowerCase());
        }
        return [...new Set(out)];
    }

    /** Every address reachable on this grant, primaries and aliases, lowercased. */
    static async listAccountAddresses(prefix: ZohoMailEnv = 'ZOHO_MAIL'): Promise<string[]> {
        const { token, apiDomain } = await this.getAccessToken(prefix);
        const res = await fetch(`${apiDomain}/api/accounts`, { headers: { 'Authorization': `Zoho-oauthtoken ${token}` } });
        const data = await res.json().catch(() => null);
        const out: string[] = [];
        for (const a of (data?.data ?? []) as Array<{ primaryEmailAddress?: string; emailAddress?: Array<{ mailId?: string }> }>) {
            if (a.primaryEmailAddress) out.push(String(a.primaryEmailAddress).toLowerCase());
            for (const e of a.emailAddress ?? []) if (e?.mailId) out.push(String(e.mailId).toLowerCase());
        }
        return [...new Set(out)];
    }

    /**
     * List messages across the mailbox's folders, newest first (paginated).
     * Stops at `since`, at `limit`, or at the page cap — whichever comes first.
     */
    static async listMessages(options: ListOptions = {}, prefix: ZohoMailEnv = 'ZOHO_MAIL'): Promise<ZohoMailMessage[]> {
        const { token, apiDomain } = await this.getAccessToken(prefix);
        return this.listMessagesRaw(options, token, apiDomain);
    }

    /**
     * The paging body, independent of WHERE the token came from — an env grant
     * or a mailbox connected through the console. Split out so both paths run
     * exactly the same code rather than two copies that drift.
     */
    private static async listMessagesRaw(options: ListOptions, token: string, apiDomain: string): Promise<ZohoMailMessage[]> {
        const acct = await this.accountIdFor(token, apiDomain, options.address);

        const sinceMs = options.since ? options.since.getTime() : 0;
        const limit = options.limit ?? MAX_PAGES * PAGE_SIZE;
        const out: ZohoMailMessage[] = [];
        let undated = 0;

        for (let page = 0; page < MAX_PAGES; page++) {
            const params = new URLSearchParams({
                start: String(page * PAGE_SIZE + 1),    // Zoho's `start` is 1-based
                limit: String(PAGE_SIZE),
                includeto: 'true',
            });
            if (options.folderId) params.set('folderId', options.folderId);

            const res = await fetch(`${apiDomain}/api/accounts/${acct}/messages/view?${params.toString()}`, {
                headers: { 'Authorization': `Zoho-oauthtoken ${token}` },
            });
            const data = await res.json().catch(() => null);

            if (!res.ok || !Array.isArray(data?.data)) {
                // An exhausted range answers 404/"no records"; that is the end of the list,
                // not a failure worth aborting the whole sync for.
                if (res.status === 404 || data?.status?.code === 404) break;
                console.error('Zoho Mail List Error:', data);
                throw new Error(data?.data?.errorCode || data?.status?.description || 'Failed to list messages from Zoho Mail');
            }

            const batch: any[] = data.data;
            if (batch.length === 0) break;

            let reachedFloor = false;
            for (const m of batch) {
                const msg = this.toMessage(m);
                // Undated message: skip it rather than stamping it with the sync clock.
                if (!msg) { undated++; continue; }
                if (sinceMs && new Date(msg.sentAt).getTime() < sinceMs) { reachedFloor = true; break; }
                out.push(msg);
                if (out.length >= limit) return out;
            }

            if (reachedFloor || batch.length < PAGE_SIZE) break;
        }

        if (undated > 0) {
            console.warn(`[ZohoMail] skipped ${undated} message(s) with no parseable receivedTime/sentDateInGMT`);
        }
        return out;
    }

    /** Same pull as listMessages, grouped into conversations (oldest message first inside each). */
    static async listThreads(options: ListOptions = {}, prefix: ZohoMailEnv = 'ZOHO_MAIL'): Promise<ZohoMailThread[]> {
        const messages = await this.listMessages(options, prefix);
        const byThread = new Map<string, ZohoMailMessage[]>();

        for (const m of messages) {
            const key = m.threadId || m.messageId;
            const bucket = byThread.get(key);
            if (bucket) bucket.push(m); else byThread.set(key, [m]);
        }

        const threads: ZohoMailThread[] = [];
        for (const [threadId, msgs] of byThread) {
            msgs.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
            const participants = [...new Set(
                msgs.flatMap(m => [m.fromAddress, ...m.toAddress, ...m.ccAddress]).filter(Boolean),
            )];
            threads.push({
                threadId,
                subject: msgs.find(m => m.subject)?.subject || '(no subject)',
                participants,
                messages: msgs,
                lastMessageAt: msgs[msgs.length - 1].sentAt,
            });
        }

        return threads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    }

    /**
     * Full content of one message (HTML or plain-text body, whichever Zoho stored).
     * Kept out of the list endpoints deliberately: bodies are big, and the purchase
     * digest intentionally never persists them (see mailboxDigest.ts privacy note).
     */
    /**
     * Zoho's content endpoint requires the FOLDER in the path:
     *   /api/accounts/{acct}/folders/{folderId}/messages/{id}/content
     *
     * Without it Zoho answers 404 URL_RULE_NOT_CONFIGURED, which reads like a
     * permission or setup problem and is neither — the grant already carries
     * ZohoMail.messages.ALL. Verified against a live message: the folder-less
     * form 404s, the folder form returns the body.
     *
     * folderId comes off the message from listMessages(). It is optional only so
     * existing callers keep compiling; without it this still 404s, so pass it.
     */
    static async getMessageContent(
        messageId: string,
        folderId?: string | null,
        prefix: ZohoMailEnv = 'ZOHO_MAIL',
        address?: string,
    ): Promise<{ subject: string; content: string; fromAddress: string; rfcMessageId: string | null }> {
        const { token, apiDomain } = await this.getAccessToken(prefix);
        return this.getMessageContentRaw(messageId, folderId, token, apiDomain, address);
    }

    private static async getMessageContentRaw(
        messageId: string,
        folderId: string | null | undefined,
        token: string,
        apiDomain: string,
        address?: string,
    ): Promise<{ subject: string; content: string; fromAddress: string; rfcMessageId: string | null }> {
        const acct = await this.accountIdFor(token, apiDomain, address);

        const path = folderId
            ? `${apiDomain}/api/accounts/${acct}/folders/${folderId}/messages/${messageId}/content`
            : `${apiDomain}/api/accounts/${acct}/messages/${messageId}/content`;

        const res = await fetch(path, {
            headers: { 'Authorization': `Zoho-oauthtoken ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.data) {
            console.error('Zoho Mail Content Error:', data);
            throw new Error(data?.data?.errorCode || data?.status?.description || 'Failed to fetch message content from Zoho Mail');
        }

        return {
            subject: decodeEntities(data.data.subject || ''),
            // Zoho returns HTML in `content`; strip tags only for the text fallback.
            content: String(data.data.content || ''),
            fromAddress: parseAddresses(data.data.fromAddress)[0] || '',
            rfcMessageId: rfcMessageIdOf(data.data),
        };
    }

    /** Attachment metadata for one message (no payload bytes — use downloadAttachment). */
    static async listAttachments(
        messageId: string,
        prefix: ZohoMailEnv = 'ZOHO_MAIL',
        address?: string,
    ): Promise<ZohoMailAttachment[]> {
        const { token, apiDomain } = await this.getAccessToken(prefix);
        const acct = await this.accountId(token, apiDomain, prefix, address);
        return this.listAttachmentsRaw(messageId, acct, token, apiDomain);
    }

    /** Same listing on a console-connected mailbox — no env prefix to name. */
    static async listAttachmentsWithGrant(
        messageId: string,
        grant: { refreshToken: string; dc: string },
        address?: string,
    ): Promise<ZohoMailAttachment[]> {
        const t = await this.tokenFromGrant(grant);
        const acct = await this.accountIdFor(t.token, t.apiDomain, address);
        return this.listAttachmentsRaw(messageId, acct, t.token, t.apiDomain);
    }

    private static async listAttachmentsRaw(
        messageId: string,
        acct: string,
        token: string,
        apiDomain: string,
    ): Promise<ZohoMailAttachment[]> {
        const res = await fetch(`${apiDomain}/api/accounts/${acct}/messages/${messageId}/attachmentInfo`, {
            headers: { 'Authorization': `Zoho-oauthtoken ${token}` },
        });
        const data = await res.json().catch(() => null);

        if (!res.ok) {
            // A message with no attachments answers 404/"no records" — that is an empty
            // list, not a failure worth aborting the sync for.
            if (res.status === 404 || data?.status?.code === 404) return [];
            console.error('Zoho Mail Attachment Info Error:', data);
            throw new Error(data?.data?.errorCode || data?.status?.description || 'Failed to list attachments from Zoho Mail');
        }

        // attachmentInfo wraps the list in `data.ATTACHMENTS` on some tenants and in
        // `data` directly on others — accept both.
        const raw: any[] = Array.isArray(data?.data?.ATTACHMENTS)
            ? data.data.ATTACHMENTS
            : Array.isArray(data?.data) ? data.data : [];
        return raw.map(a => ({
            attachmentId: String(a?.attachmentId ?? ''),
            attachmentName: String(a?.attachmentName || a?.attachmentname || 'attachment'),
            mimeType: String(a?.mimeType || a?.mime_type || 'application/octet-stream'),
            attachmentSize: Number(a?.attachmentSize || a?.attachSize || 0) || 0,
        })).filter(a => a.attachmentId);
    }

    /** Raw bytes of one attachment. READ scope covers this endpoint; no send scope needed. */
    static async downloadAttachment(
        messageId: string,
        attachmentId: string,
        prefix: ZohoMailEnv = 'ZOHO_MAIL',
        address?: string,
    ): Promise<Buffer> {
        const { token, apiDomain } = await this.getAccessToken(prefix);
        const acct = await this.accountId(token, apiDomain, prefix, address);
        return this.downloadAttachmentRaw(messageId, attachmentId, acct, token, apiDomain);
    }

    /** Same bytes on a console-connected mailbox. */
    static async downloadAttachmentWithGrant(
        messageId: string,
        attachmentId: string,
        grant: { refreshToken: string; dc: string },
        address?: string,
    ): Promise<Buffer> {
        const t = await this.tokenFromGrant(grant);
        const acct = await this.accountIdFor(t.token, t.apiDomain, address);
        return this.downloadAttachmentRaw(messageId, attachmentId, acct, t.token, t.apiDomain);
    }

    private static async downloadAttachmentRaw(
        messageId: string,
        attachmentId: string,
        acct: string,
        token: string,
        apiDomain: string,
    ): Promise<Buffer> {
        const res = await fetch(`${apiDomain}/api/accounts/${acct}/messages/${messageId}/attachments/${attachmentId}`, {
            headers: { 'Authorization': `Zoho-oauthtoken ${token}` },
        });
        if (!res.ok) {
            const data = await res.text().catch(() => '');
            console.error('Zoho Mail Attachment Download Error:', res.status, data.slice(0, 500));
            throw new Error(`Failed to download attachment from Zoho Mail (HTTP ${res.status})`);
        }
        return Buffer.from(await res.arrayBuffer());
    }

    /**
     * Returns null when the message carries no usable timestamp.
     *
     * Defaulting to Date.now() was a self-resurrecting bug: the sync's own wall clock
     * became last_message_at, so on the NEXT run the reopen check saw a message newer
     * than any resolved_at a member could have written in between, and the thread was
     * un-resolved on every single run, forever. It also pinned such threads to the top of
     * the digest and defeated the `since` floor. Dropping the message is the honest
     * outcome; the count is logged so a field-name mismatch shows up on the first sync.
     */
    private static toMessage(m: any): ZohoMailMessage | null {
        // Zoho returns epoch millis as a string in receivedTime / sentDateInGMT.
        const ms = Number(m?.receivedTime || m?.sentDateInGMT || 0);
        if (!Number.isFinite(ms) || ms <= 0) return null;
        return {
            messageId: String(m?.messageId ?? ''),
            threadId: String(m?.threadId || m?.messageId || ''),
            folderId: m?.folderId ? String(m.folderId) : null,
            subject: decodeEntities(m?.subject || ''),
            summary: decodeEntities(m?.summary || ''),
            fromAddress: parseAddresses(m?.fromAddress)[0] || '',
            fromName: displayName(m?.fromAddress),
            toAddress: parseAddresses(m?.toAddress),
            ccAddress: parseAddresses(m?.ccAddress),
            sentAt: new Date(ms).toISOString(),
            hasAttachment: String(m?.hasAttachment ?? '0') === '1' || m?.hasAttachment === true,
            rfcMessageId: rfcMessageIdOf(m),
        };
    }
}

/**
 * The RFC 822 Message-ID header out of a Zoho payload, if it carries one.
 *
 * Zoho's documented fields (messageId, threadId) are INTERNAL numeric ids —
 * useless as an In-Reply-To target, because no sender's mail client files its
 * replies against them. Some payloads additionally carry the real header under
 * one of the keys below; when they do we take it, normalised to the bracketed
 * form nodemailer writes into its own outgoing Message-IDs ("<id@host>"), so a
 * value from here can be handed to SendOptions.inReplyTo unchanged. The `@`
 * test is what keeps the numeric internal id from being mistaken for one.
 */
function rfcMessageIdOf(data: Record<string, unknown> | null | undefined): string | null {
    for (const key of ['rfc822MessageId', 'internetMessageId', 'mailMessageId', 'msgId', 'messageId']) {
        const v = String(data?.[key] ?? '').trim();
        if (!v || !v.includes('@')) continue;
        const inner = v.replace(/^<+|>+$/g, '').trim();
        if (!inner.includes('@')) continue;
        return `<${inner}>`;
    }
    return null;
}

// Zoho HTML-escapes address headers, so "Name" <a@b.com> arrives as &quot;Name&quot; &lt;a@b.com&gt;.
function decodeEntities(s: string): string {
    return String(s)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .trim();
}

/**
 * The human name in front of the address, if the sender's client put one there.
 *
 * Matters for SHARED mailboxes: purchase@ is one address and several people, so
 * the name on the header is better evidence of who wrote than any row keyed on
 * the address. Returns null when the name is just the mailbox again ("purchase")
 * or missing, so the caller can fall back rather than greet the wrong person.
 */
function displayName(raw: unknown): string | null {
    if (!raw) return null;
    const decoded = decodeEntities(String(raw));
    const before = decoded.split('<')[0].replace(/["']/g, '').trim();
    if (!before || before.includes('@')) return null;
    const local = (parseAddresses(raw)[0] ?? '').split('@')[0].toLowerCase();
    if (!before.replace(/[^a-z]/gi, '').length) return null;
    if (before.toLowerCase().replace(/[^a-z0-9]/g, '') === local.replace(/[^a-z0-9]/g, '')) return null;
    return before.slice(0, 80);
}

function parseAddresses(raw: unknown): string[] {
    if (!raw) return [];
    const decoded = decodeEntities(String(raw));
    const bracketed = decoded.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g);
    return [...new Set((bracketed || []).map(a => a.toLowerCase()))];
}
