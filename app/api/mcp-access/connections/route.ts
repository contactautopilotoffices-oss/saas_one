import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { generateToken } from '@/backend/lib/mcp/token';
import { isRoleEnabledForMcp, MCP_ROLE_REGISTRY } from '@/backend/lib/mcp/roles';
import { MCP_TOOLS } from '@/backend/lib/mcp/registry';

/**
 * Admin API behind the MCP Access UI.
 *
 * GET    — this user's connections, the role registry, the tool list, recent activity
 * POST   — issue a connection (raw token returned once, never again)
 * DELETE — revoke a connection
 *
 * Every handler resolves the caller's org role server-side. A caller may only
 * ever act on their own connections.
 */

const MAX_ACTIVE_PER_USER = 5;

async function resolveCaller(orgId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Unauthorized', status: 401 as const };

    // Column is `role` on organization_memberships; `org_role` is only the
    // client-side field name AuthContext maps it to.
    const { data: membership } = await supabaseAdmin
        .from('organization_memberships')
        .select('user_id, role, is_active')
        .eq('organization_id', orgId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (!membership) return { error: 'Not a member of this organization', status: 403 as const };
    const m = membership as { role?: string; is_active?: boolean | null };
    if (m.is_active === false) return { error: 'Membership is inactive', status: 403 as const };
    return { userId: user.id, role: m.role ?? null };
}

export async function GET(request: NextRequest) {
    try {
        const orgId = new URL(request.url).searchParams.get('orgId');
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        const caller = await resolveCaller(orgId);
        if ('error' in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

        const [connsRes, auditRes] = await Promise.all([
            supabaseAdmin
                .from('mcp_connections')
                .select('id, name, token_prefix, scopes, status, expires_at, last_used_at, use_count, created_at, revoked_at, role_at_issue')
                .eq('organization_id', orgId)
                .eq('user_id', caller.userId)
                .order('created_at', { ascending: false }),
            supabaseAdmin
                .from('mcp_audit_log')
                .select('id, method, tool_name, outcome, row_count, latency_ms, error_message, created_at')
                .eq('organization_id', orgId)
                .eq('user_id', caller.userId)
                .order('created_at', { ascending: false })
                .limit(25),
        ]);

        return NextResponse.json({
            connections: connsRes.data ?? [],
            recent_activity: auditRes.data ?? [],
            role_registry: MCP_ROLE_REGISTRY,
            caller_role: caller.role,
            caller_enabled: isRoleEnabledForMcp(caller.role),
            tools: MCP_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description })),
            endpoint_path: '/api/mcp',
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const orgId = body.organization_id as string | undefined;
        const name = (body.name as string | undefined)?.trim();
        const days = Math.min(Math.max(Number(body.expires_in_days) || 90, 1), 365);
        if (!orgId) return NextResponse.json({ error: 'organization_id required' }, { status: 400 });
        if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

        const caller = await resolveCaller(orgId);
        if ('error' in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

        if (!isRoleEnabledForMcp(caller.role)) {
            return NextResponse.json(
                { error: 'MCP access is not yet enabled for your role.' },
                { status: 403 }
            );
        }

        const { count } = await supabaseAdmin
            .from('mcp_connections')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', caller.userId)
            .eq('organization_id', orgId)
            .eq('status', 'active');
        if ((count ?? 0) >= MAX_ACTIVE_PER_USER) {
            return NextResponse.json(
                { error: `You already have ${MAX_ACTIVE_PER_USER} active connections. Revoke one first.` },
                { status: 400 }
            );
        }

        const token = generateToken();
        const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

        const { data, error } = await supabaseAdmin
            .from('mcp_connections')
            .insert({
                organization_id: orgId,
                user_id: caller.userId,
                name,
                token_hash: token.hash,
                token_prefix: token.prefix,
                role_at_issue: caller.role,
                scopes: ['read:all'],
                expires_at: expiresAt,
            })
            .select('id, name, token_prefix, status, expires_at, created_at, role_at_issue, scopes, use_count')
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        // The only time the raw token is ever returned.
        return NextResponse.json({ connection: data, token: token.raw }, { status: 201 });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId');
        const id = searchParams.get('id');
        if (!orgId || !id) return NextResponse.json({ error: 'orgId and id required' }, { status: 400 });

        const caller = await resolveCaller(orgId);
        if ('error' in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

        const { error } = await supabaseAdmin
            .from('mcp_connections')
            .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: caller.userId })
            .eq('id', id)
            .eq('organization_id', orgId)
            .eq('user_id', caller.userId);   // may only revoke your own

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
