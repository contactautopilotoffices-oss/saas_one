import { allowedRedirectHosts, restrictRedirectHosts } from './config';

/** Custom URI schemes used by desktop IDEs and MCP clients for OAuth callbacks. */
export const DESKTOP_REDIRECT_SCHEMES = new Set([
    'cursor:',
    'vscode:',
    'vscode-insiders:',
    'windsurf:',
    'claude:',
    'raycast:',
    'zed:',
    'goose:',
    'antigravity:',
]);

const PRIVATE_OR_METADATA_IPV4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function parseSafeUrl(uri: string): URL | null {
    let u: URL;
    try {
        u = new URL(uri);
    } catch {
        return null;
    }
    if (u.username || u.password || u.hash) return null;
    return u;
}

function isLoopbackHost(host: string): boolean {
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function isPublicHttpsHost(host: string): boolean {
    if (!host || PRIVATE_OR_METADATA_IPV4.test(host) || host === '[::1]' || host === 'localhost') return false;
    return host.includes('.') && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.startsWith('[');
}

/**
 * Checks whether an OAuth redirect URI goes to loopback or a host on the explicit allowlist.
 * Used directly by unit tests and when MCP_RESTRICT_REDIRECT_HOSTS=true is enabled.
 */
export function isAllowedRedirect(uri: string, hosts: string[] = allowedRedirectHosts()): boolean {
    const u = parseSafeUrl(uri);
    if (!u) return false;
    const host = u.hostname.toLowerCase();
    if (isLoopbackHost(host) && (u.protocol === 'http:' || u.protocol === 'https:')) return true;
    if (u.protocol !== 'https:') return false;
    return hosts.some(h => host === h || host.endsWith(`.${h}`));
}

/** True when the URI targets a known AI platform / IDE or localhost callback. */
export function isKnownAssistantRedirect(uri: string, hosts: string[] = allowedRedirectHosts()): boolean {
    const u = parseSafeUrl(uri);
    if (!u) return false;
    if (DESKTOP_REDIRECT_SCHEMES.has(u.protocol)) {
        return Boolean(u.host || u.pathname.replace(/^\/+/, ''));
    }
    return isAllowedRedirect(uri, hosts);
}

/**
 * True when the FMS consent screen may approve an OAuth client's redirect URI.
 * Accepts known assistants, localhost loopbacks, desktop MCP URI schemes, and (unless
 * MCP_RESTRICT_REDIRECT_HOSTS=true) any public HTTPS callback URL so any MCP platform works.
 * Rejects plaintext non-loopback http:, javascript:/data:/file:, embedded credentials, fragments,
 * and private/link-local metadata IPs.
 */
export function isConnectableRedirect(uri: string, hosts: string[] = allowedRedirectHosts()): boolean {
    if (isKnownAssistantRedirect(uri, hosts)) return true;
    if (restrictRedirectHosts()) return false;
    const u = parseSafeUrl(uri);
    if (!u || u.protocol !== 'https:') return false;
    return isPublicHttpsHost(u.hostname.toLowerCase());
}

/** True when a browser Origin header is permitted to call /api/mcp during discovery probes. */
export function isAllowedBrowserOrigin(originUri: string, selfOrigin: string, hosts: string[] = allowedRedirectHosts()): boolean {
    if (originUri === selfOrigin) return true;
    return isAllowedRedirect(originUri, hosts);
}

/** Human-friendly destination label shown on the OAuth consent screen. */
export function redirectTargetLabel(uri: string): string {
    try {
        const u = new URL(uri);
        if (u.host) return u.protocol === 'https:' || u.protocol === 'http:' ? u.host : `${u.protocol}//${u.host}`;
        if (u.protocol) return `${u.protocol}//${u.pathname.replace(/^\/+/, '').split('/')[0] || 'app'}`;
    } catch {
        // fall through
    }
    return 'an unknown address';
}
