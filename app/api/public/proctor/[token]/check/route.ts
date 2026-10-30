import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { COMPLETED_STATUSES } from '@/backend/lib/proctor/access';

/**
 * POST /api/public/proctor/[token]/check — how many chances this email has left.
 *
 * Called before the camera is switched on, so somebody who has used both goes
 * no further than the first screen instead of finding out after going
 * fullscreen. Returns nothing but counts: no questions, nobody else's attempt.
 * Body: { email }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });

    const { data: test } = await supabaseAdmin
        .from('proctor_tests')
        .select('id, is_active, max_attempts')
        .eq('public_token', token)
        .maybeSingle();
    if (!test || !test.is_active) return NextResponse.json({ error: 'This test link is closed' }, { status: 404 });

    const { data: attempts } = await supabaseAdmin
        .from('proctor_attempts')
        .select('status, termination_reason, started_at')
        .eq('test_id', test.id)
        .ilike('candidate_email', email)
        .order('started_at');

    const mine = attempts || [];
    const completed = mine.some((a) => COMPLETED_STATUSES.includes(a.status));
    const last = mine[mine.length - 1];

    return NextResponse.json({
        max_attempts: test.max_attempts,
        attempts_used: mine.length,
        chances_left: Math.max(0, test.max_attempts - mine.length),
        completed,
        last_reason: last?.termination_reason || null,
    });
}
