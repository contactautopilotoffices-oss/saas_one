import { allowedRedirectHosts } from './config';

/**
 * Where an OAuth client may send the user after they approve the FMS connection.
 *
 * Dynamic client registration lets anyone register a client with any name, so a phishing
 * client could call itself "Claude" and point at its own server. The consent screen therefore
 * only approves clients whose redirect goes to a known assistant host (claude.ai, claude.com,
 * plus MCP_ALLOWED_REDIRECT_HOSTS) over https, or to this computer (localhost, used by
 * desktop and command-line assistants).
 */
export function isAllowedRedirect(uri: string, hosts: string[] = allowedRedirectHosts()): boolean {
    let u: URL;
    try {
        u = new URL(uri);
    } catch {
        return false;
    }
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (u.protocol === 'http:') return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (u.protocol !== 'https:') return false;
    return hosts.some(h => host === h || host.endsWith(`.${h}`));
}
