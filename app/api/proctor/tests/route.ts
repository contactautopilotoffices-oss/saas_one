import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveProctorAccess, isProctorAccessError } from '@/backend/lib/proctor/access';
import { standingFrom, STANDING_COLUMNS, type AttemptRow, type GrantRow } from '@/backend/lib/proctor/chances';
import { parseTestBody } from '@/backend/lib/proctor/testBody';

/**
 * GET /api/proctor/tests?org_id=
 * Authors see every test with attempt counts; everyone else sees active tests
 * and how many of their chances they have used.
 */
export async function GET(request: NextRequest) {
    const access = await resolveProctorAccess(new URL(request.url).searchParams.get('org_id'));
    if (isProctorAccessError(access)) return access;

    let query = supabaseAdmin
        .from('proctor_tests')
        .select('id, title, instructions, duration_minutes, ai_monitoring, is_active, max_attempts, look_away_strikes, shuffle, public_token, questions, created_at')
        .eq('organization_id', access.organizationId)
        .order('created_at', { ascending: false });
    if (!access.canAuthor) query = query.eq('is_active', true);

    const { data: tests, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ids = (tests || []).map((t) => t.id);
    const testIds = ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];
    let attemptQuery = supabaseAdmin.from('proctor_attempts').select(`test_id, user_id, candidate_email, ${STANDING_COLUMNS}`).in('test_id', testIds);
    if (!access.canAuthor) attemptQuery = attemptQuery.eq('user_id', access.userId);
    const [{ data: attempts }, { data: myGrants }] = await Promise.all([
        attemptQuery,
        supabaseAdmin.from('proctor_grants').select('test_id, kind, created_at').in('test_id', testIds).eq('user_id', access.userId),
    ]);

    return NextResponse.json({
        can_author: access.canAuthor,
        tests: (tests || []).map((t) => {
            const forTest = (attempts || []).filter((a) => a.test_id === t.id);
            const mine = standingFrom(
                forTest.filter((a) => a.user_id === access.userId) as unknown as AttemptRow[],
                (myGrants || []).filter((g) => g.test_id === t.id) as GrantRow[],
                t,
            );
            return {
                id: t.id,
                title: t.title,
                instructions: t.instructions,
                duration_minutes: t.duration_minutes,
                ai_monitoring: t.ai_monitoring,
                is_active: t.is_active,
                max_attempts: t.max_attempts,
                look_away_strikes: t.look_away_strikes,
                question_count: Array.isArray(t.questions) ? t.questions.length : 0,
                created_at: t.created_at,
                // This viewer's own chances, counting HR's extra chances and resets.
                my_chances: mine.allowed,
                my_attempts_used: mine.used,
                my_completed: mine.completed,
                ...(access.canAuthor ? {
                    shuffle: t.shuffle,
                    public_token: t.public_token,
                    people: new Set(forTest.map((a) => a.user_id || a.candidate_email?.toLowerCase())).size,
                    attempts: forTest.length,
                    terminated: forTest.filter((a) => a.status === 'terminated').length,
                } : {}),
            };
        }),
    });
}

/**
 * POST /api/proctor/tests — create a test (authors only).
 * Body: { org_id?, title, instructions?, duration_minutes, max_attempts?, look_away_strikes?,
 *         ai_monitoring?, sections?: [{ key, title, description }],
 *         questions: [{ section?, text, options[], answer_index }] }
 */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const access = await resolveProctorAccess(body.org_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden: you cannot create tests' }, { status: 403 });

    const parsed = parseTestBody(body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
        .from('proctor_tests')
        .insert({
            organization_id: access.organizationId,
            ...parsed.fields,
            created_by: access.userId,
        })
        .select('id, public_token')
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ id: data.id, public_token: data.public_token }, { status: 201 });
}
