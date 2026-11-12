import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveProctorAccess, isProctorAccessError } from '@/backend/lib/proctor/access';
import { loadStanding, type Identity } from '@/backend/lib/proctor/chances';

/**
 * POST /api/proctor/tests/[id]/grants — HR gives someone another chance, or
 * resets their attempts so they start again with every chance. Authors only.
 *
 * The reason is optional. The grant, who made it, and the note go in the
 * grants table (which the chance count reads) and into the proctoring log of
 * the person's latest attempt, so it shows in their results and report.
 * Body: { kind: 'extra_chance' | 'reset', user_id? | candidate_email?, note? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const { data: test } = await supabaseAdmin
        .from('proctor_tests')
        .select('id, organization_id, max_attempts, duration_minutes')
        .eq('id', id)
        .maybeSingle();
    if (!test) return NextResponse.json({ error: 'Test not found' }, { status: 404 });

    const access = await resolveProctorAccess(test.organization_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const kind = body.kind === 'reset' ? 'reset' : body.kind === 'extra_chance' ? 'extra_chance' : null;
    if (!kind) return NextResponse.json({ error: 'kind must be extra_chance or reset' }, { status: 400 });

    const userId = typeof body.user_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.user_id) ? body.user_id : null;
    const email = !userId && typeof body.candidate_email === 'string' ? body.candidate_email.trim().toLowerCase() : '';
    if (!userId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Say who this is for' }, { status: 400 });
    const identity: Identity = userId ? { kind: 'user', userId } : { kind: 'candidate', name: '', email };

    const standing = await loadStanding(test, identity);
    // Only someone who has attempted this test can be granted anything (nextAttemptNo is 1 when they never have).
    if (standing.nextAttemptNo <= 1) return NextResponse.json({ error: 'This person has not taken this test yet' }, { status: 404 });
    if (standing.resumable || standing.live) {
        return NextResponse.json({ error: 'They are taking the test right now. Try again once that attempt ends.' }, { status: 409 });
    }
    if (kind === 'extra_chance' && standing.completed) {
        return NextResponse.json({ error: 'They have already completed the test. Use Reset to let them take it again.' }, { status: 409 });
    }

    const note = String(body.note || '').trim().slice(0, 1000) || null;
    const { error } = await supabaseAdmin.from('proctor_grants').insert({
        test_id: id,
        organization_id: test.organization_id,
        user_id: userId,
        candidate_email: userId ? null : email,
        kind,
        note,
        created_by: access.userId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Into the log of their latest attempt, so the reviewer sees why there is another one.
    const latest = standing.active[standing.active.length - 1];
    if (latest) {
        const { data: me } = await supabaseAdmin.from('users').select('full_name, email').eq('id', access.userId).maybeSingle();
        await supabaseAdmin.from('proctor_events').insert({
            attempt_id: latest.id,
            kind: kind === 'reset' ? 'hr_reset' : 'hr_extra_chance',
            detail: { note, by: me?.full_name || me?.email || 'HR', at: new Date().toISOString() },
        });
    }

    const after = await loadStanding(test, identity);
    return NextResponse.json({ ok: true, standing: { allowed: after.allowed, used: after.used, left: after.left, completed: after.completed } });
}
