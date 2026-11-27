import { corsOptionsResponse, serveAuthorizationServerMetadata } from '@/backend/lib/mcp/oauthMetadata';

/**
 * OpenID Provider Configuration fallback for MCP / OAuth clients probing
 * /.well-known/openid-configuration on the MCP origin.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
    return serveAuthorizationServerMetadata();
}

export async function OPTIONS() {
    return corsOptionsResponse();
}
