import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveSections, correctOptions, isCorrectAnswer, EVIDENCE_BUCKET, type ProctorAnswer, type ProctorQuestion } from '@/backend/lib/proctor/access';

/**
 * The reviewer's report for one attempt: the score, how it was answered, and
 * everything the proctor saw, in order.
 *
 * The flagged camera frames are **embedded** in the report as data URIs rather
 * than linked. A signed storage link expires in an hour, so a report that is
 * saved, printed or forwarded would lose its evidence exactly when someone
 * comes back to check it. Embedding costs a few hundred KB and keeps the
 * report true on its own.
 */

/** Frames embedded per report. A 30-minute test checks ~90 times; flagged ones are far fewer. */
const MAX_EMBEDDED_FRAMES = 40;

export interface ReportEvent {
    kind: string;
    detail: Record<string, unknown> | null;
    created_at: string;
    /** Embedded image, when this event kept a frame. */
    image?: string | null;
}

export async function buildAttemptReport(attemptId: string, opts: { embedImages?: boolean } = {}) {
    const embedImages = opts.embedImages !== false;

    const { data: attempt } = await supabaseAdmin
        .from('proctor_attempts')
        .select('id, test_id, organization_id, user_id, candidate_name, candidate_email, attempt_no, status, started_at, ended_at, termination_reason, answers, score, total, section_scores, ai_checks, ai_flags')
        .eq('id', attemptId)
        .maybeSingle();
    if (!attempt) return null;

    const { data: test } = await supabaseAdmin
        .from('proctor_tests')
        .select('id, organization_id, title, instructions, duration_minutes, max_attempts, look_away_strikes, ai_monitoring, sections, questions')
        .eq('id', attempt.test_id)
        .maybeSingle();
    if (!test) return null;

    const [{ data: events }, { data: user }, { data: org }] = await Promise.all([
        supabaseAdmin.from('proctor_events').select('kind, detail, created_at').eq('attempt_id', attemptId).order('created_at'),
        attempt.user_id
            ? supabaseAdmin.from('users').select('full_name, email').eq('id', attempt.user_id).maybeSingle()
            : Promise.resolve({ data: null }),
        supabaseAdmin.from('organizations').select('name').eq('id', attempt.organization_id).maybeSingle(),
    ]);

    const questions = (test.questions || []) as ProctorQuestion[];
    const sections = resolveSections(test.sections, questions);
    const answers = (attempt.answers || {}) as Record<string, ProctorAnswer>;

    // Every question, what they picked, and whether it was right. picked/correct are lists, so a
    // multiple-answer question reads the same way as a single one.
    const review = questions.map((q, i) => {
        const given = answers[q.id];
        const picked = given === undefined ? null : Array.isArray(given) ? given : [given];
        return {
            number: i + 1,
            section: q.section || 'general',
            text: q.text,
            options: q.options,
            multi: !!q.multi,
            picked,
            correct: correctOptions(q),
            is_correct: isCorrectAnswer(q, given),
        };
    });

    // The proctoring log, with any kept frame embedded beside the flag it belongs to.
    const log: ReportEvent[] = [];
    let embedded = 0;
    for (const e of events || []) {
        if (e.kind === 'ai_ok') continue; // a clean check is not worth a line in a report
        const detail = (e.detail || {}) as Record<string, unknown>;
        const path = typeof detail.evidence_path === 'string' ? detail.evidence_path : null;
        let image: string | null = null;
        if (path && embedImages && embedded < MAX_EMBEDDED_FRAMES) {
            const { data: file } = await supabaseAdmin.storage.from(EVIDENCE_BUCKET).download(path);
            if (file) {
                image = `data:image/jpeg;base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
                embedded++;
            }
        }
        log.push({ kind: e.kind, detail, created_at: e.created_at, image });
    }

    const minutesTaken = attempt.ended_at
        ? Math.max(1, Math.round((new Date(attempt.ended_at).getTime() - new Date(attempt.started_at).getTime()) / 60_000))
        : null;

    return {
        organisation: org?.name || null,
        test: {
            id: test.id,
            organization_id: test.organization_id,
            title: test.title,
            duration_minutes: test.duration_minutes,
            max_attempts: test.max_attempts,
            look_away_strikes: test.look_away_strikes,
            ai_monitoring: test.ai_monitoring,
            sections,
        },
        candidate: {
            name: user?.full_name || attempt.candidate_name || user?.email || attempt.candidate_email || 'Unknown',
            email: user?.email || attempt.candidate_email || null,
            from_public_link: !attempt.user_id,
        },
        attempt: {
            id: attempt.id,
            attempt_no: attempt.attempt_no,
            status: attempt.status,
            started_at: attempt.started_at,
            ended_at: attempt.ended_at,
            minutes_taken: minutesTaken,
            termination_reason: attempt.termination_reason,
            score: attempt.score,
            total: attempt.total,
            section_scores: (attempt.section_scores || {}) as Record<string, { score: number; total: number }>,
            ai_checks: attempt.ai_checks,
            ai_flags: attempt.ai_flags,
        },
        review,
        log,
        frames_embedded: embedded,
    };
}

export type AttemptReport = NonNullable<Awaited<ReturnType<typeof buildAttemptReport>>>;
