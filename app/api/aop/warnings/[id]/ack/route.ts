import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAopAccess, isAopAccessError, readOrgId, isMissingRelation } from '@/backend/lib/aop/access';

/**
 * POST /api/aop/warnings/[id]/ack
 *
 * Body: { acknowledged?: boolean }  — defaults to true; false un-acknowledges.
 *
 * Acknowledging hides the warning from the banner, it does not delete it. The record is
 * the audit trail for a figure someone decided to accept; deleting it would erase the
 * reason the number looks odd.
 */

export const dynamic = 'force-dynamic';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const access = await resolveAopAccess(request, readOrgId(request, body));
    if (isAopAccessError(access)) return access;

    const acknowledged = body?.acknowledged === false ? false : true;

    const { data, error } = await supabaseAdmin
        .from('aop_import_warnings')
        .update({ is_acknowledged: acknowledged })
        // Scoped to the caller's org so an id from another tenant cannot be flipped.
        .eq('id', id)
        .eq('organization_id', access.organizationId)
        .select('id, severity, message, is_acknowledged')
        .maybeSingle();

    if (error) {
        if (isMissingRelation(error)) {
            return NextResponse.json({ error: 'The AOP tracker is not set up yet' }, { status: 503 });
        }
        console.error('[aop warning ack]', error.message);
        return NextResponse.json({ error: 'Could not update the warning' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Warning not found' }, { status: 404 });

    return NextResponse.json({ warning: data });
}
