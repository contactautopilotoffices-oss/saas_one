import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError } from '@/backend/lib/crm/access';
import { computeRepTrend } from '@/backend/lib/coaching/longitudinal';

/**
 * GET /api/crm/coaching/reps/[repId]
 * Per-rep trend: list of call points + computed direction + layer averages.
 * Admin-only.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ repId: string }> }
) {
    const { repId } = await params;
    const access = await resolveCrmAccess(request);
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin && !access.isMasterAdmin) {
        return NextResponse.json(
            { error: 'Only admins can view per-rep coaching' },
            { status: 403 }
        );
    }

    // Reps can view their own trend without admin.
    if (!access.isAdmin && !access.isMasterAdmin && access.user.id !== repId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const windowSize = Math.min(
        Math.max(parseInt(url.searchParams.get('window') || '20', 10) || 20, 1),
        100
    );

    const { data: calls, error } = await supabaseAdmin
        .from('crm_calls')
        .select(
            `
            id, uploaded_at, overall_score, rep_talk_ratio, coaching,
            lead_company_name_snapshot,
            rep:users!crm_calls_bd_rep_id_fkey(id, full_name, email)
        `
        )
        .eq('organization_id', access.organizationId)
        .eq('bd_rep_id', repId)
        .eq('status', 'completed')
        .eq('is_archived', false)
        .order('uploaded_at', { ascending: false })
        .limit(windowSize);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const repMetaRaw = calls && calls[0]?.rep;
    const repMeta = Array.isArray(repMetaRaw) ? repMetaRaw[0] : repMetaRaw;
    const repName =
        (repMeta?.full_name as string | undefined) ||
        (repMeta?.email as string | undefined) ||
        'Unknown rep';

    const trend = computeRepTrend(
        (calls || []).map((c) => ({
            id: c.id,
            uploaded_at: c.uploaded_at,
            overall_score: c.overall_score,
            rep_talk_ratio: c.rep_talk_ratio,
            coaching: c.coaching,
            lead_company_name_snapshot: c.lead_company_name_snapshot,
        })),
        repName,
        repId
    );

    return NextResponse.json({ repId, trend });
}
