import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCaller, isCallerError, isOrgAdmin, forbidden } from '@/backend/lib/auth/callerAccess';
import { getOrganizationUsers } from '@/backend/lib/whatsapp/interpreter/organization-users.mjs';
import { MCP_TOOL_CATALOG, MCP_TOOL_NAMES, effectiveTools } from '@/backend/lib/mcp/toolCatalog';
import { isMissingTable, type McpToolAccessRow } from '@/backend/lib/mcp/toolAccess';

/**
 * Settings > Claude tools: which MCP tools each person of an organisation may use through a
 * connected assistant. Organisation admins only (the same people who see the organisation tabs on
 * the settings screen); the MCP server reads the result in backend/lib/mcp/toolAccess.ts.
 *
 * GET  ?organizationId=   the tool catalogue, the organisation's people and each person's saved access
 * PUT  { organizationId, userId, mode: 'all' | 'selected', tools: [] }   save one person's access
 *
 * A person with no row has every tool. Saving mode 'all' deletes nothing: the row stays, so the
 * history shows who opened it up again.
 */
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

async function authorise(request: NextRequest, organizationId: string) {
    if (!UUID.test(organizationId)) return { error: NextResponse.json({ error: 'Valid organization ID required' }, { status: 400 }) };
    const caller = await resolveCaller(request);
    if (isCallerError(caller)) return { error: caller };
    if (!isOrgAdmin(caller, organizationId)) return { error: forbidden('Organisation admin access required') };
    return { caller };
}

type Person = { id: string; name: string; email: string };

async function orgPeople(organizationId: string): Promise<Person[]> {
    const users = await getOrganizationUsers(supabaseAdmin, organizationId) as Array<{ id: string; name: string; email: string }>;
    return users.map(u => ({ id: u.id, name: u.name, email: u.email }));
}

export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId') || '';
    const auth = await authorise(request, organizationId);
    if (auth.error) return auth.error;
    try {
        const people = await orgPeople(organizationId);
        const ids = people.map(p => p.id);
        let tableMissing = false;
        const saved = new Map<string, Pick<McpToolAccessRow, 'mode' | 'tools' | 'updated_at'>>();
        if (ids.length) {
            const { data, error } = await supabaseAdmin.from('mcp_tool_access').select('user_id, mode, tools, updated_at').in('user_id', ids);
            if (error) {
                if (!isMissingTable(error.message)) throw new Error(error.message);
                tableMissing = true;
            }
            for (const row of (data || []) as McpToolAccessRow[]) saved.set(row.user_id, row);
        }
        return NextResponse.json({
            tableMissing,
            catalog: MCP_TOOL_CATALOG,
            users: people.map(p => {
                const row = saved.get(p.id);
                return {
                    ...p,
                    mode: row?.mode === 'selected' ? 'selected' : 'all',
                    tools: row?.mode === 'selected' ? [...effectiveTools(row.tools)] : [],
                    updatedAt: row?.updated_at ?? null,
                };
            }),
        }, { headers: NO_STORE });
    } catch (err) {
        console.error('[mcp/tool-access] load failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Could not load tool access' }, { status: 500 });
    }
}

const putBody = z.object({
    organizationId: z.string().regex(UUID),
    userId: z.string().regex(UUID),
    mode: z.enum(['all', 'selected']),
    tools: z.array(z.string().max(60)).max(200).default([]),
}).strict();

export async function PUT(request: NextRequest) {
    const raw = await request.json().catch(() => null) as { organizationId?: unknown } | null;
    const auth = await authorise(request, typeof raw?.organizationId === 'string' ? raw.organizationId : '');
    if (auth.error) return auth.error;
    const parsed = putBody.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`) }, { status: 400 });
    }
    const { organizationId, userId, mode } = parsed.data;
    const unknown = parsed.data.tools.find(t => !MCP_TOOL_NAMES.includes(t));
    if (unknown) return NextResponse.json({ error: `Unknown tool: ${unknown.slice(0, 60)}` }, { status: 400 });
    // What is stored is exactly what the server will allow (whoami and confirm_action included), so
    // the screen and the assistant's tool list always agree.
    const tools = mode === 'selected' ? [...effectiveTools(parsed.data.tools)] : [];

    try {
        const people = await orgPeople(organizationId);
        if (!people.some(p => p.id === userId)) return NextResponse.json({ error: 'This person is not in this organisation' }, { status: 400 });

        const before = await supabaseAdmin.from('mcp_tool_access').select('mode, tools').eq('user_id', userId).maybeSingle();
        if (before.error) {
            if (isMissingTable(before.error.message)) {
                return NextResponse.json({ error: 'The tool access table is not set up yet. The migration 20261110000001_mcp_tool_access.sql must be run first.' }, { status: 503 });
            }
            throw new Error(before.error.message);
        }
        const now = new Date().toISOString();
        // History first: a change that cannot be recorded is not saved.
        const history = await supabaseAdmin.from('mcp_tool_access_history').insert({
            user_id: userId, organization_id: organizationId, changed_by: auth.caller.userId,
            before_mode: before.data?.mode ?? null, before_tools: before.data?.tools ?? null,
            after_mode: mode, after_tools: tools,
        });
        if (history.error) throw new Error(history.error.message);
        const { error } = await supabaseAdmin.from('mcp_tool_access').upsert(
            { user_id: userId, organization_id: organizationId, mode, tools, updated_by: auth.caller.userId, updated_at: now },
            { onConflict: 'user_id' },
        );
        if (error) throw new Error(error.message);
        return NextResponse.json({ userId, mode, tools, updatedAt: now }, { headers: NO_STORE });
    } catch (err) {
        console.error('[mcp/tool-access] save failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ error: 'Could not save tool access' }, { status: 500 });
    }
}
