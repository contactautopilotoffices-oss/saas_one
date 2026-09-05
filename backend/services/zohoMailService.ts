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
    toAddress: string[];
    ccAddress: string[];
    sentAt: string;             // ISO
    hasAttachment: boolean;
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
}

const PAGE_SIZE = 200;          // Zoho Mail caps `limit` at 200
const MAX_PAGES = 15;           // hard cap: 15 × 200 = 3k messages per sync

/**
 * Which env set the client reads. The purchase mailbox uses ZOHO_MAIL_*; the
 * electricity bills mailbox is a separate OAuth client + refresh token pinned under
 * ZOHO_ELEC_MAIL_* (plan §9 items 1–2: forwarding goes via SMTP, never Zoho send
 * scope). Everything keys off the prefix so both mailboxes share one code path.
 */
export type ZohoMailEnv = 'ZOHO_MAIL' | 'ZOHO_ELEC_MAIL';

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

export class ZohoMailService {
    private static async getAccessToken(prefix: ZohoMailEnv = 'ZOHO_MAIL'): Promise<{ token: string; apiDomain: string }> {
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
                    return { token: data.access_token, apiDomain: this.mailApiDomain(data.api_domain, tld, prefix) };
                }
                lastError = data;
            } catch (err) {
                lastError = err;
            }
        }

        console.error('Zoho Mail Token Error:', lastError);
        throw new Error(`Failed to refresh Zoho Mail access token. Check ${prefix}_* credentials and ${prefix}_DC.`);
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

    private static async accountId(token: string, apiDomain: string, prefix: ZohoMailEnv): Promise<string> {
        const configured = env(prefix, 'ACCOUNT_ID');
        if (configured) return configured;

        // Self-service fallback so the integration works with creds alone; the account
        // id is stable, so setting <PREFIX>_ACCOUNT_ID saves this round trip.
        const res = await fetch(`${apiDomain}/api/accounts`, {
            headers: { 'Authorization': `Zoho-oauthtoken ${token}` },
        });
        const data = await res.json().catch(() => null);
        const accounts: any[] = data?.data || [];
        const wanted = mailboxAddress(prefix);
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
        return String(match.accountId);
    }

    /**
     * List messages across the mailbox's folders, newest first (paginated).
     * Stops at `since`, at `limit`, or at the page cap — whichever comes first.
     */
    static async listMessages(options: ListOptions = {}, prefix: ZohoMailEnv = 'ZOHO_MAIL'): Promise<ZohoMailMessage[]> {
        const { token, apiDomain } = await this.getAccessToken(prefix);
        const acct = await this.accountId(token, apiDomain, prefix);

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
    ): Promise<{ subject: string; content: string; fromAddress: string }> {
        const { token, apiDomain } = await this.getAccessToken(prefix);
        const acct = await this.accountId(token, apiDomain, prefix);

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
        };
    }

    /** Attachment metadata for one message (no payload bytes — use downloadAttachment). */
    static async listAttachments(
        messageId: string,
        prefix: ZohoMailEnv = 'ZOHO_MAIL',
    ): Promise<ZohoMailAttachment[]> {
        const { token, apiDomain } = await this.getAccessToken(prefix);
        const acct = await this.accountId(token, apiDomain, prefix);

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
    ): Promise<Buffer> {
        const { token, apiDomain } = await this.getAccessToken(prefix);
        const acct = await this.accountId(token, apiDomain, prefix);

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
            toAddress: parseAddresses(m?.toAddress),
            ccAddress: parseAddresses(m?.ccAddress),
            sentAt: new Date(ms).toISOString(),
            hasAttachment: String(m?.hasAttachment ?? '0') === '1' || m?.hasAttachment === true,
        };
    }
}

// Zoho HTML-escapes address headers, so "Name" <a@b.com> arrives as &quot;Name&quot; &lt;a@b.com&gt;.
function decodeEntities(s: string): string {
    return String(s)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .trim();
}

function parseAddresses(raw: unknown): string[] {
    if (!raw) return [];
    const decoded = decodeEntities(String(raw));
    const bracketed = decoded.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g);
    return [...new Set((bracketed || []).map(a => a.toLowerCase()))];
}
