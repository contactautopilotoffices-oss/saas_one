import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveSections, type ProctorQuestion } from '@/backend/lib/proctor/access';

/**
 * GET /api/public/proctor/[token] — what the no-sign-in landing page shows.
 * No account, no session: the link itself is the credential. Returns only what
 * is needed to decide to start, never the questions or the answer key.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;

    const { data: test } = await supabaseAdmin
        .from('proctor_tests')
        .select('id, title, instructions, duration_minutes, ai_monitoring, is_active, max_attempts, look_away_strikes, sections, questions')
        .eq('public_token', token)
        .maybeSingle();

    if (!test || !test.is_active) return NextResponse.json({ error: 'This test link is closed' }, { status: 404 });

    const questions = (test.questions || []) as ProctorQuestion[];
    return NextResponse.json({
        test: {
            title: test.title,
            instructions: test.instructions,
            duration_minutes: test.duration_minutes,
            ai_monitoring: test.ai_monitoring,
            max_attempts: test.max_attempts,
            look_away_strikes: test.look_away_strikes,
            question_count: questions.length,
            sections: resolveSections(test.sections, questions),
        },
    });
}
