import { NextResponse } from 'next/server';
import { authIssuer, supabaseUrl } from './config';

/** Standard CORS headers allowing any MCP client / browser inspector to discover and talk to /api/mcp. */
export const MCP_CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
    'Access-Control-Max-Age': '86400',
};

export function corsOptionsResponse(): NextResponse {
    return new NextResponse(null, { status: 204, headers: MCP_CORS_HEADERS });
}

/** Copy any Response and attach MCP CORS headers without mutating frozen header objects. */
export function withMcpCorsHeaders(res: Response): Response {
    const headers = new Headers(res.headers);
    for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) {
        if (!headers.has(key)) headers.set(key, value);
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function buildProtectedResourceMetadata(origin: string, issuer: string) {
    return {
        resource: `${origin}/api/mcp`,
        authorization_servers: [issuer],
        bearer_methods_supported: ['header'],
        scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
        resource_name: 'Autopilot FMS',
    };
}

function fallbackAuthServerMetadata(issuer: string) {
    return {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        userinfo_endpoint: `${issuer}/oauth/userinfo`,
        registration_endpoint: `${issuer}/oauth/clients/register`,
        scopes_supported: ['openid', 'profile', 'email', 'phone', 'offline_access'],
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256', 'HS256', 'ES256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        code_challenge_methods_supported: ['S256', 'plain'],
    };
}

/**
 * Serves Supabase Auth's OAuth 2.1 / OIDC Authorization Server metadata JSON for MCP clients
 * (such as MCP 2025-03-26 fallbacks) that query /.well-known/oauth-authorization-server or
 * /.well-known/openid-configuration on the MCP server's own domain instead of RFC 9728.
 */
export async function serveAuthorizationServerMetadata(): Promise<NextResponse> {
    const base = supabaseUrl();
    const issuer = authIssuer();
    if (!base || !issuer) {
        return NextResponse.json(
            { error: 'MCP server is not configured' },
            { status: 503, headers: MCP_CORS_HEADERS },
        );
    }

    let payload: Record<string, unknown> | null = null;
    try {
        const res = await fetch(`${base}/.well-known/oauth-authorization-server/auth/v1`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
            cache: 'no-store',
        });
        if (res.ok) {
            const parsed = await res.json();
            if (parsed && typeof parsed === 'object' && 'authorization_endpoint' in parsed && 'token_endpoint' in parsed) {
                payload = parsed as Record<string, unknown>;
            }
        }
    } catch {
        // Fall back to constructed Supabase Auth endpoints below.
    }

    return NextResponse.json(payload ?? fallbackAuthServerMetadata(issuer), {
        headers: {
            'cache-control': 'public, max-age=300',
            ...MCP_CORS_HEADERS,
        },
    });
}
