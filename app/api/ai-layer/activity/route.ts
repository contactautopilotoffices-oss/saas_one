import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireOrgSuperAdmin } from '../_lib/auth';

export const runtime = 'nodejs';

/**
 * The AI activity view for an org super admin: the latest 200 turns of their own org.
 * Rows with visibility = 'hr' (anonymous / confidential HR items) are never returned here, whatever the caller's role.
 */
export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId') || '';
    const auth = await requireOrgSuperAdmin(organizationId);
    if (auth.error) return auth.error;

    const { data, error } = await supabaseAdmin.from('ai_action_log')
        .select('id, created_at, actor_user_id, channel, language, entry_id, decision, refusal_reason, fields, result_ref, topic, model, tokens_in, tokens_out, latency_ms')
        .eq('organization_id', organizationId)
        .eq('visibility', 'org_admin')
        .order('created_at', { ascending: false })
        .limit(200);
    if (error) {
        const missing = ['42P01', 'PGRST205'].includes((error as { code?: string }).code ?? '');
        return NextResponse.json(missing ? { rows: [], tableMissing: true } : { error: "Couldn't load AI activity" }, { status: missing ? 200 : 500 });
    }
    const rows = (data || []) as Array<Record<string, unknown> & { actor_user_id: string | null }>;
    const ids = [...new Set(rows.map(r => r.actor_user_id).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (ids.length) {
        const u = await supabaseAdmin.from('users').select('id, full_name').in('id', ids);
        for (const row of (u.data || []) as Array<{ id: string; full_name: string | null }>) names.set(row.id, row.full_name || 'Unknown');
    }
    return NextResponse.json({ rows: rows.map(r => ({ ...r, actor_name: r.actor_user_id ? names.get(r.actor_user_id) ?? 'Unknown' : null })) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
