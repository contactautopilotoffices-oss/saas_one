import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError } from '@/backend/lib/crm/access';

/**
 * DELETE /api/crm/campaigns/spend/[id]
 * Admin only — soft-deletes a spend entry. We do a hard delete because spend
 * is a transactional log; if admins need to "undo" a wrong entry, they
 * re-insert the corrected one.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const access = await resolveCrmAccess(request);
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin && !access.isMasterAdmin) {
        return NextResponse.json({ error: 'Only admins can delete spend' }, { status: 403 });
    }

    const { data: row, error: loadErr } = await supabaseAdmin
        .from('crm_campaign_spend')
        .select('id, organization_id')
        .eq('id', id)
        .maybeSingle();
    if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (row.organization_id !== access.organizationId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabaseAdmin.from('crm_campaign_spend').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
