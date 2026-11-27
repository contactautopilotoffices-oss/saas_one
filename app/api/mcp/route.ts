import { NextRequest, NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { verifyMcpToken } from '@/backend/lib/mcp/token';
import { loadUserScope } from '@/backend/lib/mcp/scope';
import { loadToolAccess } from '@/backend/lib/mcp/toolAccess';
import { buildMcpServer } from '@/backend/lib/mcp/tools';
import { allowRequest } from '@/backend/lib/mcp/rateLimit';
import { internalOrigin, publicOrigin, rateLimitPerMinute, restrictRedirectHosts, supabaseUrl } from '@/backend/lib/mcp/config';
import { isAllowedBrowserOrigin } from '@/backend/lib/mcp/redirectPolicy';
import { corsOptionsResponse, MCP_CORS_HEADERS, withMcpCorsHeaders } from '@/backend/lib/mcp/oauthMetadata';
import { logMcpCall } from '@/backend/lib/mcp/log';

/**
 * POST /api/mcp — the FMS MCP server (Model Context Protocol, Streamable HTTP, stateless).
 *
 * Who: any FMS user who connected an assistant (Claude, ChatGPT, Cursor, VS Code, or any
 * MCP-compatible platform) through the FMS OAuth consent screen. Every call runs AS that user.
 *
 * Auth: Authorization: Bearer <Supabase OAuth access token>. A missing or bad token gets 401
 * with a WWW-Authenticate header pointing to /.well-known/oauth-protected-resource/api/mcp.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function unauthorized(origin: string | null, description: string) {
    const headers: Record<string, string> = { 'cache-control': 'no-store', ...MCP_CORS_HEADERS };
    if (origin) {
        headers['WWW-Authenticate'] =
            `Bearer error="invalid_token", error_description="${description.replace(/"/g, "'")}", ` +
            `resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`;
    }
    return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32001, message: `Unauthorized: ${description}` }, id: null },
        { status: 401, headers },
    );
}

function methodNotAllowed() {
    return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. This server is stateless: use POST.' }, id: null },
        { status: 405, headers: { Allow: 'POST, OPTIONS', ...MCP_CORS_HEADERS } },
    );
}

/**
 * Some MCP clients (REST callers, OpenAI probes, curl) omit text/event-stream in Accept.
 * Since enableJsonResponse is always true, expand JSON / wildcard Accept headers so the SDK
 * transport never rejects valid POST requests with 406 Not Acceptable.
 */
async function withNormalizedAccept(request: NextRequest): Promise<Request> {
    const accept = (request.headers.get('accept') || '').toLowerCase();
    const hasJson = accept.includes('application/json');
    const hasSse = accept.includes('text/event-stream');
    if (hasJson && hasSse) return request;
    if (accept && !hasJson && !accept.includes('*/*')) return request;
    const headers = new Headers(request.headers);
    headers.set('accept', 'application/json, text/event-stream');
    const body = await request.text();
    return new Request(request.url, { method: request.method, headers, body });
}

export async function OPTIONS() {
    return corsOptionsResponse();
}

export async function POST(request: NextRequest) {
    const origin = publicOrigin(request.url);
    const callOrigin = internalOrigin(request.url);
    const sbUrl = supabaseUrl();
    if (!origin || !callOrigin || !sbUrl) {
        console.error('[mcp] not configured: set NEXT_PUBLIC_APP_URL (or MCP_PUBLIC_ORIGIN) and NEXT_PUBLIC_SUPABASE_URL');
        return NextResponse.json({ error: 'MCP server is not configured' }, { status: 503, headers: MCP_CORS_HEADERS });
    }

    // DNS-rebinding guard: reject unauthenticated cross-origin browser requests from unknown sites.
    // Authenticated Bearer requests still pass through verifyMcpToken() cryptographic checks.
    const reqOrigin = request.headers.get('origin');
    const hasBearer = Boolean(request.headers.get('authorization'));
    if (reqOrigin && !isAllowedBrowserOrigin(reqOrigin, origin) && (restrictRedirectHosts() || !hasBearer)) {
        return NextResponse.json({ error: 'Origin not allowed' }, { status: 403, headers: MCP_CORS_HEADERS });
    }

    const check = await verifyMcpToken(request.headers.get('authorization'));
    if (!check.ok) return unauthorized(origin, check.reason);
    const caller = check.caller;

    if (!allowRequest(caller.userId, rateLimitPerMinute())) {
        await logMcpCall({ userId: caller.userId, clientId: caller.clientId, tool: '(rate limited)', ok: false, error: 'rate limit' });
        return NextResponse.json(
            { jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests. Wait a minute and try again.' }, id: null },
            { status: 429, headers: { 'Retry-After': '60', ...MCP_CORS_HEADERS } },
        );
    }

    let scope;
    let toolAccess;
    try {
        [scope, toolAccess] = await Promise.all([loadUserScope(caller.userId), loadToolAccess(caller.userId)]);
    } catch (e) {
        console.error('[mcp] scope load failed:', e instanceof Error ? e.message : e);
        return NextResponse.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Could not load your FMS access. Try again shortly.' }, id: null }, { status: 500, headers: MCP_CORS_HEADERS });
    }

    const server = buildMcpServer({ caller, scope, toolAccess, origin: callOrigin, supabaseUrl: sbUrl });
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: every request is authenticated on its own
        enableJsonResponse: true,
    });
    try {
        await server.connect(transport);
        const normalizedReq = await withNormalizedAccept(request);
        const res = await transport.handleRequest(normalizedReq, {
            authInfo: { token: caller.accessToken, clientId: caller.clientId, scopes: [], expiresAt: caller.expiresAt, extra: { userId: caller.userId } },
        });
        return withMcpCorsHeaders(res);
    } catch (e) {
        console.error('[mcp] request failed:', e instanceof Error ? e.message : e);
        return NextResponse.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }, { status: 500, headers: MCP_CORS_HEADERS });
    } finally {
        // Response is fully built (JSON mode), so the per-request server can be closed.
        transport.close().catch(() => {});
        server.close().catch(() => {});
    }
}

export async function GET(request: NextRequest) {
    // Unauthenticated GET probes receive 401 + WWW-Authenticate so SSE/GET-first clients can discover OAuth.
    if (!request.headers.get('authorization')) {
        const origin = publicOrigin(request.url);
        if (origin) return unauthorized(origin, 'missing bearer token');
    }
    return methodNotAllowed();
}

export async function DELETE() {
    return methodNotAllowed();
}
