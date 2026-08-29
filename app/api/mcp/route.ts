import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { extractBearer, hashToken } from '@/backend/lib/mcp/token';
import { isRoleEnabledForMcp } from '@/backend/lib/mcp/roles';
import { MCP_TOOLS, findTool, toolsListPayload } from '@/backend/lib/mcp/registry';

/**
 * POST /api/mcp — the MCP endpoint. JSON-RPC 2.0 over HTTP, stateless.
 *
 * Follows the 2026-07-28 revision: no session, no Mcp-Session-Id, no SSE.
 * Every request stands alone and carries its own bearer token, so any request
 * can land on any serverless instance. `initialize` is still answered for
 * clients that have not migrated off the older handshake.
 *
 * Read-only by construction: the registry contains no write queries, and
 * organization_id is taken from the token, never from a tool argument.
 */

export const dynamic = 'force-dynamic';

const PROTOCOL_VERSION = '2026-07-28';
const SERVER_INFO = { name: 'autopilot-offices', title: 'Autopilot Offices', version: '1.0.0' };

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const RATE_LIMIT_PER_MIN = 60;

interface AuthedConnection {
    id: string;
    organization_id: string;
    user_id: string;
    role_at_issue: string;
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
    return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status });
}

function unauthorized(message: string) {
    // Point unauthenticated callers at where to authenticate, per OAuth 2.1
    // resource-server behaviour. Phase 1 issues tokens in-app rather than via
    // an authorization server, so this names the app resource.
    return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: INVALID_REQUEST, message } },
        {
            status: 401,
            headers: {
                'WWW-Authenticate':
                    'Bearer realm="autopilot-offices", error="invalid_token", ' +
                    'error_description="Provide an MCP connection token issued from Settings -> MCP Access"',
            },
        }
    );
}

async function authenticate(req: NextRequest): Promise<AuthedConnection | { error: string }> {
    const raw = extractBearer(req.headers.get('authorization'));
    if (!raw) return { error: 'Missing or malformed bearer token' };

    const { data, error } = await supabaseAdmin
        .from('mcp_connections')
        .select('id, organization_id, user_id, role_at_issue, status, expires_at')
        .eq('token_hash', hashToken(raw))
        .maybeSingle();

    if (error) return { error: 'Token lookup failed' };
    if (!data) return { error: 'Unknown token' };
    if (data.status !== 'active') return { error: `Token is ${data.status}` };
    if (new Date(data.expires_at).getTime() < Date.now()) return { error: 'Token has expired' };

    // The role is re-checked on every call: revoking someone's admin role in
    // the app must close their MCP access immediately, not at token expiry.
    if (!isRoleEnabledForMcp(data.role_at_issue)) {
        return { error: 'This role is not enabled for MCP access' };
    }
    const { data: membership } = await supabaseAdmin
        .from('organization_memberships')
        .select('user_id, role, is_active')
        .eq('organization_id', data.organization_id)
        .eq('user_id', data.user_id)
        .maybeSingle();
    if (!membership) return { error: 'User is no longer a member of this organization' };
    const m = membership as { role?: string; is_active?: boolean | null };
    if (m.is_active === false) return { error: 'Membership is inactive' };
    // Re-check the CURRENT role, not the one stored at issue time, so a
    // demotion in the app closes MCP access on the next call.
    if (!isRoleEnabledForMcp(m.role)) {
        return { error: 'This role is not enabled for MCP access' };
    }

    return {
        id: data.id,
        organization_id: data.organization_id,
        user_id: data.user_id,
        role_at_issue: data.role_at_issue,
    };
}

async function overRateLimit(connectionId: string): Promise<boolean> {
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabaseAdmin
        .from('mcp_audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('connection_id', connectionId)
        .gte('created_at', since);
    return (count ?? 0) >= RATE_LIMIT_PER_MIN;
}

async function audit(entry: {
    connection_id: string | null;
    organization_id: string | null;
    user_id: string | null;
    method: string;
    tool_name?: string | null;
    arguments?: Record<string, unknown>;
    outcome: 'ok' | 'denied' | 'error' | 'rate_limited';
    row_count?: number | null;
    latency_ms?: number | null;
    error_message?: string | null;
}) {
    try {
        await supabaseAdmin.from('mcp_audit_log').insert(entry);
    } catch {
        // Auditing must never break a request the caller is entitled to make.
    }
}

export async function POST(req: NextRequest) {
    let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
        body = await req.json();
    } catch {
        return rpcError(null, PARSE_ERROR, 'Invalid JSON');
    }

    const { id, method, params } = body ?? {};
    if (!method || typeof method !== 'string') {
        return rpcError(id, INVALID_REQUEST, 'Missing method');
    }

    // `initialize` is answered before auth so a client can discover the server
    // and be told how to authenticate. It returns no data.
    if (method === 'initialize') {
        return NextResponse.json({
            jsonrpc: '2.0',
            id: id ?? null,
            result: {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false } },
                serverInfo: SERVER_INFO,
                instructions:
                    'Read-only access to Autopilot Offices organization data. All results are scoped ' +
                    'to the organization the connection token was issued for.',
            },
        });
    }
    if (method === 'notifications/initialized' || method === 'ping') {
        return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result: {} });
    }

    const auth = await authenticate(req);
    if ('error' in auth) {
        await audit({
            connection_id: null, organization_id: null, user_id: null,
            method, outcome: 'denied', error_message: auth.error,
        });
        return unauthorized(auth.error);
    }

    if (await overRateLimit(auth.id)) {
        await audit({
            connection_id: auth.id, organization_id: auth.organization_id, user_id: auth.user_id,
            method, outcome: 'rate_limited',
            error_message: `Over ${RATE_LIMIT_PER_MIN} calls/minute`,
        });
        return rpcError(id, INTERNAL_ERROR, `Rate limit exceeded (${RATE_LIMIT_PER_MIN}/min)`, 429);
    }

    // Touch last-used so the UI can show a stale connection.
    supabaseAdmin
        .from('mcp_connections')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', auth.id)
        .then(() => undefined, () => undefined);

    if (method === 'tools/list') {
        await audit({
            connection_id: auth.id, organization_id: auth.organization_id, user_id: auth.user_id,
            method, outcome: 'ok', row_count: MCP_TOOLS.length,
        });
        return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result: { tools: toolsListPayload() } });
    }

    if (method === 'tools/call') {
        const started = Date.now();
        const toolName = typeof params?.name === 'string' ? params.name : '';
        const args = (params?.arguments ?? {}) as Record<string, unknown>;

        const tool = findTool(toolName);
        if (!tool) {
            await audit({
                connection_id: auth.id, organization_id: auth.organization_id, user_id: auth.user_id,
                method, tool_name: toolName, arguments: args, outcome: 'denied',
                error_message: 'Unknown tool',
            });
            return rpcError(id, INVALID_PARAMS, `Unknown tool: ${toolName}`);
        }

        // organization_id is never read from args — reject any attempt to pass one.
        if ('organization_id' in args || 'org_id' in args) {
            await audit({
                connection_id: auth.id, organization_id: auth.organization_id, user_id: auth.user_id,
                method, tool_name: toolName, arguments: args, outcome: 'denied',
                error_message: 'organization_id may not be supplied by the caller',
            });
            return rpcError(id, INVALID_PARAMS, 'organization_id is derived from your token and cannot be supplied');
        }

        try {
            const rows = await tool.run(auth.organization_id, args);
            const latency = Date.now() - started;
            await audit({
                connection_id: auth.id, organization_id: auth.organization_id, user_id: auth.user_id,
                method, tool_name: toolName, arguments: args, outcome: 'ok',
                row_count: Array.isArray(rows) ? rows.length : null, latency_ms: latency,
            });
            return NextResponse.json({
                jsonrpc: '2.0',
                id: id ?? null,
                result: {
                    content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
                    structuredContent: { rows },
                    isError: false,
                },
            });
        } catch (e) {
            const msg = (e as Error).message;
            await audit({
                connection_id: auth.id, organization_id: auth.organization_id, user_id: auth.user_id,
                method, tool_name: toolName, arguments: args, outcome: 'error',
                latency_ms: Date.now() - started, error_message: msg,
            });
            return NextResponse.json({
                jsonrpc: '2.0',
                id: id ?? null,
                result: { content: [{ type: 'text', text: `Query failed: ${msg}` }], isError: true },
            });
        }
    }

    return rpcError(id, METHOD_NOT_FOUND, `Method not supported: ${method}`);
}

/** Discovery convenience. Returns no data and requires no auth. */
export async function GET() {
    return NextResponse.json({
        name: SERVER_INFO.name,
        title: SERVER_INFO.title,
        protocolVersion: PROTOCOL_VERSION,
        transport: 'streamable-http',
        readOnly: true,
        authentication: 'Bearer token issued in-app under Settings -> MCP Access',
        tools: MCP_TOOLS.map((t) => t.name),
    });
}
