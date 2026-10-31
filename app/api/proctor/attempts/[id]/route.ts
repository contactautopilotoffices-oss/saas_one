import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveProctorAccess, isProctorAccessError } from '@/backend/lib/proctor/access';
import { removeEvidence } from '@/backend/lib/proctor/cleanup';

/**
 * DELETE /api/proctor/attempts/[id] — delete one result: the attempt, its
 * proctoring log (cascade) and the camera frames kept for it. Authors only.
 *
 * Chances are counted from attempts, so deleting one gives that chance back —
 * handy for clearing trial runs; use "Give another chance" to keep the record.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const { data: attempt } = await supabaseAdmin.from('proctor_attempts').select('id, organization_id').eq('id', id).maybeSingle();
    if (!attempt) return NextResponse.json({ error: 'Result not found' }, { status: 404 });

    const access = await resolveProctorAccess(attempt.organization_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await removeEvidence([id]);
    const { error } = await supabaseAdmin.from('proctor_attempts').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
