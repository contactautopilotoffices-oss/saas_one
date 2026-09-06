/**
 * The shape of the Zoho mail consent round trip.
 *
 * Lives here rather than in the route because a Next route module may only
 * export handlers and its own config — exporting a helper from one made the
 * build reject the file.
 */

/**
 * Read-only mail scopes. Sending goes out over SMTP, so no send scope is asked
 * for and none is granted — the consent screen says exactly that to the person
 * approving it.
 */
export const ZOHO_MAIL_SCOPES = [
    'ZohoMail.messages.READ',
    'ZohoMail.accounts.READ',
    'ZohoMail.folders.READ',
].join(',');

/**
 * The redirect Zoho sends the person back to.
 *
 * Derived from the request's OWN origin, so connecting from localhost returns
 * to localhost and connecting from the deployed app returns to the deployed
 * app. Building it from NEXT_PUBLIC_APP_URL alone bounced a local connection to
 * production, where the one-time code is useless.
 *
 * Zoho requires an exact match, so register BOTH origins on the application.
 * MAIL_OAUTH_REDIRECT_URL overrides everything for an unusual deployment.
 */
export function callbackUrl(requestUrl?: string): string {
    const override = (process.env.MAIL_OAUTH_REDIRECT_URL ?? '').trim();
    if (override) return override.replace(/\/+$/, '');
    let fromRequest = '';
    if (requestUrl) { try { fromRequest = new URL(requestUrl).origin; } catch { /* fall through */ } }
    const base = (fromRequest || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '')
        .trim().replace(/^"|"$/g, '').replace(/\/+$/, '');
    return `${base}/api/agents/mail/callback`;
}
