import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveProctorAccess, isProctorAccessError, type ProctorQuestion } from '@/backend/lib/proctor/access';

/**
 * GET /api/proctor/tests?org_id=
 * Authors see every test with attempt counts; everyone else sees active tests
 * and whether they have already taken each one.
 */
export async function GET(request: NextRequest) {
    const access = await resolveProctorAccess(new URL(request.url).searchParams.get('org_id'));
    if (isProctorAccessError(access)) return access;

    let query = supabaseAdmin
        .from('proctor_tests')
        .select('id, title, instructions, duration_minutes, ai_monitoring, is_active, questions, created_at')
        .eq('organization_id', access.organizationId)
        .order('created_at', { ascending: false });
    if (!access.canAuthor) query = query.eq('is_active', true);

    const { data: tests, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ids = (tests || []).map((t) => t.id);
    let attemptQuery = supabaseAdmin.from('proctor_attempts').select('test_id, user_id, status').in('test_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    if (!access.canAuthor) attemptQuery = attemptQuery.eq('user_id', access.userId);
    const { data: attempts } = await attemptQuery;

    return NextResponse.json({
        can_author: access.canAuthor,
        tests: (tests || []).map((t) => {
            const forTest = (attempts || []).filter((a) => a.test_id === t.id);
            return {
                id: t.id,
                title: t.title,
                instructions: t.instructions,
                duration_minutes: t.duration_minutes,
                ai_monitoring: t.ai_monitoring,
                is_active: t.is_active,
                question_count: Array.isArray(t.questions) ? t.questions.length : 0,
                created_at: t.created_at,
                my_status: forTest.find((a) => a.user_id === access.userId)?.status || null,
                ...(access.canAuthor ? {
                    attempts: forTest.length,
                    terminated: forTest.filter((a) => a.status === 'terminated').length,
                } : {}),
            };
        }),
    });
}

/**
 * POST /api/proctor/tests — create a test (authors only).
 * Body: { org_id?, title, instructions?, duration_minutes, ai_monitoring?, questions: [{text, options[], answer_index}] }
 */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const access = await resolveProctorAccess(body.org_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden: you cannot create tests' }, { status: 403 });

    const title = String(body.title || '').trim();
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

    const duration = Number(body.duration_minutes) || 15;
    if (duration < 1 || duration > 180) return NextResponse.json({ error: 'Duration must be 1–180 minutes' }, { status: 400 });

    const raw = Array.isArray(body.questions) ? body.questions : [];
    const questions: ProctorQuestion[] = [];
    for (const [i, q] of raw.entries()) {
        const text = String(q?.text || '').trim();
        const options = (Array.isArray(q?.options) ? q.options : []).map((o: unknown) => String(o || '').trim()).filter(Boolean);
        const answer = Number(q?.answer_index);
        if (!text) return NextResponse.json({ error: `Question ${i + 1} has no text` }, { status: 400 });
        if (options.length < 2) return NextResponse.json({ error: `Question ${i + 1} needs at least two options` }, { status: 400 });
        if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
            return NextResponse.json({ error: `Question ${i + 1} needs a correct option marked` }, { status: 400 });
        }
        questions.push({ id: `q${i + 1}`, text, options, answer_index: answer });
    }
    if (questions.length === 0) return NextResponse.json({ error: 'Add at least one question' }, { status: 400 });

    const { data, error } = await supabaseAdmin
        .from('proctor_tests')
        .insert({
            organization_id: access.organizationId,
            title,
            instructions: String(body.instructions || '').trim() || null,
            duration_minutes: duration,
            ai_monitoring: body.ai_monitoring !== false,
            questions,
            created_by: access.userId,
        })
        .select('id')
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ id: data.id }, { status: 201 });
}
