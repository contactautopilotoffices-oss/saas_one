import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveProctorAccess, isProctorAccessError, COMPLETED_STATUSES, type ProctorQuestion } from '@/backend/lib/proctor/access';

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
        .select('id, title, instructions, duration_minutes, ai_monitoring, is_active, max_attempts, look_away_strikes, public_token, questions, created_at')
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
            const mine = forTest.filter((a) => a.user_id === access.userId);
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
                my_attempts_used: mine.length,
                my_completed: mine.some((a) => COMPLETED_STATUSES.includes(a.status)),
                ...(access.canAuthor ? {
                    public_token: t.public_token,
                    people: new Set(forTest.map((a) => a.user_id)).size,
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

    const title = String(body.title || '').trim();
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

    const duration = Number(body.duration_minutes) || 15;
    if (duration < 1 || duration > 180) return NextResponse.json({ error: 'Duration must be 1–180 minutes' }, { status: 400 });

    const maxAttempts = body.max_attempts === undefined ? 2 : Number(body.max_attempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
        return NextResponse.json({ error: 'Chances must be 1–5' }, { status: 400 });
    }

    const strikes = body.look_away_strikes === undefined ? 3 : Number(body.look_away_strikes);
    if (!Number.isInteger(strikes) || strikes < 1 || strikes > 20) {
        return NextResponse.json({ error: 'Camera warnings must be 1–20' }, { status: 400 });
    }

    const sections = (Array.isArray(body.sections) ? body.sections : [])
        .filter((s: { key?: unknown }) => typeof s?.key === 'string' && s.key.trim())
        .map((s: { key: string; title?: unknown; description?: unknown }) => ({
            key: s.key.trim(),
            title: String(s.title || '').trim(),
            description: String(s.description || '').trim(),
        }));

    const sectionKeys = new Set<string>([...sections.map((s: { key: string }) => s.key), 'general']);
    const raw = Array.isArray(body.questions) ? body.questions : [];
    const questions: ProctorQuestion[] = [];
    for (const [i, q] of raw.entries()) {
        const text = String(q?.text || '').trim();
        const options = (Array.isArray(q?.options) ? q.options : []).map((o: unknown) => String(o || '').trim()).filter(Boolean);
        const answer = Number(q?.answer_index);
        const section = sectionKeys.has(String(q?.section)) ? String(q.section) : 'general';
        if (!text) return NextResponse.json({ error: `Question ${i + 1} has no text` }, { status: 400 });
        if (options.length < 2) return NextResponse.json({ error: `Question ${i + 1} needs at least two options` }, { status: 400 });
        if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
            return NextResponse.json({ error: `Question ${i + 1} needs a correct option marked` }, { status: 400 });
        }
        questions.push({ id: `q${i + 1}`, section, text, options, answer_index: answer });
    }
    if (questions.length === 0) return NextResponse.json({ error: 'Add at least one question' }, { status: 400 });

    const { data, error } = await supabaseAdmin
        .from('proctor_tests')
        .insert({
            organization_id: access.organizationId,
            title,
            instructions: String(body.instructions || '').trim() || null,
            duration_minutes: duration,
            max_attempts: maxAttempts,
            look_away_strikes: strikes,
            sections,
            ai_monitoring: body.ai_monitoring !== false,
            questions,
            created_by: access.userId,
        })
        .select('id, public_token')
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ id: data.id, public_token: data.public_token }, { status: 201 });
}
