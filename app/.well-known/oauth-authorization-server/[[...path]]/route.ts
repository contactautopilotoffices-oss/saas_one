import { corsOptionsResponse, serveAuthorizationServerMetadata } from '@/backend/lib/mcp/oauthMetadata';

/**
 * OAuth 2.0 Authorization Server Metadata fallback (RFC 8414 / MCP 2025-03-26 discovery).
 * Prevents 307/404 failures for MCP platforms that probe /.well-known/oauth-authorization-server
 * directly on the MCP origin before or instead of RFC 9728 oauth-protected-resource.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
    return serveAuthorizationServerMetadata();
}

export async function OPTIONS() {
    return corsOptionsResponse();
}
