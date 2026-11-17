import { NextRequest, NextResponse } from 'next/server';
import { authIssuer, publicOrigin } from '@/backend/lib/mcp/config';

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the FMS MCP server.
 * Served at /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp.
 * Tells an assistant that /api/mcp accepts tokens from this project's Supabase Auth.
 * Public by design: it holds no secrets.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const origin = publicOrigin(request.url);
    const issuer = authIssuer();
    if (!origin || !issuer) {
        return NextResponse.json({ error: 'MCP server is not configured' }, { status: 503 });
    }
    return NextResponse.json(
        {
            resource: `${origin}/api/mcp`,
            authorization_servers: [issuer],
            bearer_methods_supported: ['header'],
            resource_name: 'Autopilot FMS',
        },
        { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } },
    );
}
