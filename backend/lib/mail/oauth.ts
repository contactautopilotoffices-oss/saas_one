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

/**
 * Zoho client credentials used by Zoho Tasks (and shared by HR Recruitment
 * Mail): prefers ZOHO_TASKS_CLIENT_ID, then ZOHO_CLIENT_ID (the Autopilot SSO
 * login app), then ZOHO_MAIL_APP_CLIENT_ID.
 */
export function getZohoTaskAppCredentials(): { clientId: string; clientSecret: string } {
    return zohoApps().find(a => a.prefix !== 'ZOHO_MAIL') ?? { clientId: '', clientSecret: '' };
}

export function zohoApps() {
    return ['ZOHO_TASKS', 'ZOHO', 'ZOHO_MAIL_APP', 'ZOHO_MAIL'].flatMap(prefix => {
        const clientId = process.env[prefix + '_CLIENT_ID']?.trim();
        const clientSecret = process.env[prefix + '_CLIENT_SECRET']?.trim();
        return clientId && clientSecret ? [{ prefix, clientId, clientSecret }] : [];
    });
}

const ZOHO_DCS = ['com', 'in', 'eu', 'com.au', 'jp', 'ca', 'com.cn', 'sa'];
export function trustedZohoAccounts(server: string) {
    return ZOHO_DCS.some(dc => server === 'https://accounts.zoho.' + dc);
}

export async function postZohoToken(endpoint: string, form: URLSearchParams, send = fetch) {
    const url = new URL(endpoint);
    if (!trustedZohoAccounts(url.origin) || url.href !== url.origin + '/oauth/v2/token') throw new Error('Invalid Zoho token endpoint.');
    return send(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(15_000), body: form.toString() });
}

/** The redirect Zoho sends the person back to. Must be registered on the Zoho application exactly. */
export function zohoTaskCallbackUrl(requestUrl?: string): string {
    const override = (process.env.ZOHO_TASKS_REDIRECT_URL ?? '').trim();
    if (override) return override.replace(/\/+$/, '');
    let base = '';
    if (requestUrl) { try { base = new URL(requestUrl).origin; } catch { /* fall through */ } }
    base = (base || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/^"|"$/g, '').replace(/\/+$/, '');
    return `${base}/api/task-manager/zoho/callback`;
}
