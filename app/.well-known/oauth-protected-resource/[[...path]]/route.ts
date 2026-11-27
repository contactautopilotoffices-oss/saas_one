import { NextRequest, NextResponse } from 'next/server';
import { authIssuer, publicOrigin } from '@/backend/lib/mcp/config';
import { buildProtectedResourceMetadata, corsOptionsResponse, MCP_CORS_HEADERS } from '@/backend/lib/mcp/oauthMetadata';

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the FMS MCP server.
 * Served at /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp.
 * Tells any MCP assistant that /api/mcp accepts tokens from this project's Supabase Auth.
 * Public by design: it holds no secrets.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const origin = publicOrigin(request.url);
    const issuer = authIssuer();
    if (!origin || !issuer) {
        return NextResponse.json({ error: 'MCP server is not configured' }, { status: 503, headers: MCP_CORS_HEADERS });
    }
    return NextResponse.json(
        buildProtectedResourceMetadata(origin, issuer),
        { headers: { 'cache-control': 'public, max-age=300', ...MCP_CORS_HEADERS } },
    );
}

export async function OPTIONS() {
    return corsOptionsResponse();
}
