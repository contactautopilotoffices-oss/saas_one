import { NextRequest, NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { verifyMcpToken } from '@/backend/lib/mcp/token';
import { loadUserScope } from '@/backend/lib/mcp/scope';
import { loadToolAccess } from '@/backend/lib/mcp/toolAccess';
import { buildMcpServer } from '@/backend/lib/mcp/tools';
import { allowRequest } from '@/backend/lib/mcp/rateLimit';
import { internalOrigin, publicOrigin, rateLimitPerMinute, supabaseUrl } from '@/backend/lib/mcp/config';
import { logMcpCall } from '@/backend/lib/mcp/log';

/**
 * POST /api/mcp — the FMS MCP server (Model Context Protocol, Streamable HTTP, stateless).
 *
 * Who: any FMS user who connected an assistant (e.g. Claude) through the FMS OAuth consent
 * screen. Every call runs AS that user. An organisation super admin can limit which tools a
 * person gets (Settings > Claude tools, mcp_tool_access). See docs/MCP_CONNECT_GUIDE.md.
 *
 * Auth: Authorization: Bearer <Supabase OAuth access token>. A missing or bad token gets 401
 * with a WWW-Authenticate header pointing to /.well-known/oauth-protected-resource, which is
 * how the assistant finds the FMS sign-in.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function unauthorized(origin: string | null, description: string) {
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
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
        { status: 405, headers: { Allow: 'POST' } },
    );
}

export async function POST(request: NextRequest) {
    const origin = publicOrigin(request.url);
    const callOrigin = internalOrigin(request.url);
    const sbUrl = supabaseUrl();
    if (!origin || !callOrigin || !sbUrl) {
        console.error('[mcp] not configured: set NEXT_PUBLIC_APP_URL (or MCP_PUBLIC_ORIGIN) and NEXT_PUBLIC_SUPABASE_URL');
        return NextResponse.json({ error: 'MCP server is not configured' }, { status: 503 });
    }

    // DNS-rebinding guard: a browser page on another site must not be able to drive this endpoint.
    const reqOrigin = request.headers.get('origin');
    if (reqOrigin && reqOrigin !== origin) {
        return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const check = await verifyMcpToken(request.headers.get('authorization'));
    if (!check.ok) return unauthorized(origin, check.reason);
    const caller = check.caller;

    if (!allowRequest(caller.userId, rateLimitPerMinute())) {
        await logMcpCall({ userId: caller.userId, clientId: caller.clientId, tool: '(rate limited)', ok: false, error: 'rate limit' });
        return NextResponse.json(
            { jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests. Wait a minute and try again.' }, id: null },
            { status: 429, headers: { 'Retry-After': '60' } },
        );
    }

    let scope;
    let toolAccess;
    try {
        [scope, toolAccess] = await Promise.all([loadUserScope(caller.userId), loadToolAccess(caller.userId)]);
    } catch (e) {
        console.error('[mcp] scope load failed:', e instanceof Error ? e.message : e);
        return NextResponse.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Could not load your FMS access. Try again shortly.' }, id: null }, { status: 500 });
    }

    const server = buildMcpServer({ caller, scope, toolAccess, origin: callOrigin, supabaseUrl: sbUrl });
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: every request is authenticated on its own
        enableJsonResponse: true,
    });
    try {
        await server.connect(transport);
        return await transport.handleRequest(request, {
            authInfo: { token: caller.accessToken, clientId: caller.clientId, scopes: [], expiresAt: caller.expiresAt, extra: { userId: caller.userId } },
        });
    } catch (e) {
        console.error('[mcp] request failed:', e instanceof Error ? e.message : e);
        return NextResponse.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }, { status: 500 });
    } finally {
        // Response is fully built (JSON mode), so the per-request server can be closed.
        transport.close().catch(() => {});
        server.close().catch(() => {});
    }
}

export async function GET() {
    return methodNotAllowed();
}

export async function DELETE() {
    return methodNotAllowed();
}
